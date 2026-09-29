"""Export official XFeat/LighterGlue weights for Pocket VO.
Usage: python export_models.py /path/to/accelerated_features /path/to/models
Requires torch, kornia, onnx, onnxruntime, numpy. Upstream revision in manifest.json.
No training, quantization, or arbitrary descriptor/weight substitution.
"""
import sys, json, hashlib, subprocess
from pathlib import Path
import torch
import torch.nn.functional as F
import numpy as np
import onnxruntime as ort
upstream, output = map(Path, sys.argv[1:3])
sys.path.insert(0, str(upstream.resolve()))
from modules.model import XFeatModel
from modules.lighterglue import LighterGlue

torch.set_num_threads(2)
torch.manual_seed(42)
output.mkdir(parents=True, exist_ok=True)

class Extractor(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.net = XFeatModel().eval()
        # Equivalent block rearrangement, exportable with dynamic image dimensions.
        self.net._unfold2d = lambda x, ws=8: F.pixel_unshuffle(x, ws)
        self.net.load_state_dict(torch.load(upstream/'weights/xfeat.pt', map_location='cpu', weights_only=True))
    def forward(self, image):
        desc, logits, reliability = self.net(image)
        desc = F.normalize(desc, dim=1)
        scores = F.softmax(logits, dim=1)[:, :64]
        b, _, h, w = scores.shape
        heatmap = scores.permute(0,2,3,1).reshape(b,h,w,8,8).permute(0,1,3,2,4).reshape(b,1,h*8,w*8)
        return desc, heatmap, reliability

class Matcher(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.net = LighterGlue(str(upstream/'weights/xfeat-lighterglue.pt')).net.eval()
        state = torch.load(upstream/'weights/xfeat-lighterglue.pt', map_location='cpu', weights_only=True)
        for i in range(6):
            state = {k.replace(f'self_attn.{i}', f'transformers.{i}.self_attn').replace(f'cross_attn.{i}', f'transformers.{i}.cross_attn').replace('matcher.', ''): v for k,v in state.items()}
        assert not (set(dict(self.net.named_parameters())) - set(state)), 'Missing trained matcher parameters'
        self.net.conf.width_confidence = -1
        self.net.conf.depth_confidence = -1
        # Export all six trained layers. No data-dependent pruning / early stopping.
    def forward(self, keypoints0, keypoints1, descriptors0, descriptors1):
        # Coordinates already normalized by max(width,height)/2, as in LightGlue.
        d0, d1 = self.net.input_proj(descriptors0), self.net.input_proj(descriptors1)
        def encoding(k):
            p = self.net.posenc.Wr(k)
            return [v.unsqueeze(-1).expand(-1,-1,-1,2).reshape(1,-1,96) for v in (torch.cos(p),torch.sin(p))]
        def rotary(x,e):
            paired=x.reshape(1,-1,48,2)
            rotated=torch.stack((-paired[:,:,:,1],paired[:,:,:,0]),dim=-1).reshape(1,-1,96)
            return x*e[0]+rotated*e[1]
        def self_attention(block,x,e):
            qkv=block.Wqkv(x).reshape(1,-1,96,3)
            q,k,v=rotary(qkv[:,:,:,0],e),rotary(qkv[:,:,:,1],e),qkv[:,:,:,2]
            message=block.out_proj(F.softmax((q@k.transpose(1,2))/96**.5,dim=-1)@v)
            return x+block.ffn(torch.cat((x,message),dim=-1))
        e0,e1=encoding(keypoints0),encoding(keypoints1)
        for layer in self.net.transformers:
            d0,d1=self_attention(layer.self_attn,d0,e0),self_attention(layer.self_attn,d1,e1)
            block=layer.cross_attn
            q0,q1=block.to_qk(d0)/96**.25,block.to_qk(d1)/96**.25
            sim=q0@q1.transpose(1,2)
            m0=block.to_out(F.softmax(sim,dim=-1)@block.to_v(d1))
            m1=block.to_out(F.softmax(sim.transpose(1,2),dim=-1)@block.to_v(d0))
            d0,d1=d0+block.ffn(torch.cat((d0,m0),-1)),d1+block.ffn(torch.cat((d1,m1),-1))
        head = self.net.log_assignment[-1]
        a, b = head.final_proj(d0) / 96**.25, head.final_proj(d1) / 96**.25
        sim = a @ b.transpose(-1,-2)
        # Non-dustbin part of official assignment; mutual/confidence filter runs in JS.
        return F.log_softmax(sim, -1) + F.log_softmax(sim, -2) + F.logsigmoid(head.matchability(d0)) + F.logsigmoid(head.matchability(d1)).transpose(-1,-2)

extractor, matcher = Extractor().eval(), Matcher().eval()
image = torch.rand(1,1,288,384)
args = (torch.rand(1,128,2)*2-1,torch.rand(1,96,2)*2-1,F.normalize(torch.randn(1,128,64),dim=-1),F.normalize(torch.randn(1,96,64),dim=-1))
with torch.inference_mode():
    torch.onnx.export(extractor, (image,), str(output/'xfeat.onnx'), input_names=['image'], output_names=['descriptors','heatmap','reliability'], dynamic_axes={'image':{2:'height',3:'width'},'descriptors':{2:'h8',3:'w8'},'heatmap':{2:'height',3:'width'},'reliability':{2:'h8',3:'w8'}},opset_version=17,dynamo=False)
    names=['keypoints0','keypoints1','descriptors0','descriptors1']
    torch.onnx.export(matcher,args,str(output/'lighterglue.onnx'),input_names=names,output_names=['log_scores'],dynamic_axes={**{n:{1:'n0' if n.endswith('0') else 'n1'} for n in names},'log_scores':{1:'n0',2:'n1'}},opset_version=17,dynamo=False)
    errors={}
    opts=ort.SessionOptions();opts.intra_op_num_threads=2
    for model, inputs, names, file in [(extractor,(image,),['image'],'xfeat.onnx'),(matcher,args,names,'lighterglue.onnx')]:
        session=ort.InferenceSession(str(output/file),sess_options=opts,providers=['CPUExecutionProvider'])
        reference=model(*inputs); reference=(reference,) if isinstance(reference,torch.Tensor) else reference
        actual=session.run(None,{n:x.numpy() for n,x in zip(names,inputs)})
        errors[file]=[float(np.max(np.abs(a-r.numpy()))) for a,r in zip(actual,reference)]
        for a,r in zip(actual,reference):np.testing.assert_allclose(a,r.numpy(),rtol=2e-3,atol=2e-4)
    # Validate raw matcher scores against official full LightGlue, not just wrapper.
    size=torch.tensor([[384,288]])
    official=matcher.net({'image0':{'keypoints':args[0]*192+size[:,None]/2,'descriptors':args[2],'image_size':size},'image1':{'keypoints':args[1]*192+size[:,None]/2,'descriptors':args[3],'image_size':size}})['log_assignment'][:,:-1,:-1]
    torch.testing.assert_close(matcher(*args),official,rtol=2e-4,atol=1e-4)
manifest={'upstream':'https://github.com/verlab/accelerated_features','revision':subprocess.check_output(['git','-C',str(upstream),'rev-parse','HEAD'],text=True).strip(),'models':{},'parity_max_abs_error':errors,'matcher':'XFeat-trained LighterGlue, 6 layers, 96D internal, 64D descriptors; no pruning','torch':torch.__version__,'onnxruntime':ort.__version__}
for name in ['xfeat.onnx','lighterglue.onnx']:
    b=(output/name).read_bytes();manifest['models'][name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
(output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
