"""Generate official PyTorch comparison: python parity_reference.py UPSTREAM FIXTURE_DIR."""
import sys,json
from pathlib import Path
import numpy as np
import torch
import cv2
sys.path.insert(0,sys.argv[1])
from modules.xfeat import XFeat
from modules.lighterglue import LighterGlue
torch.set_num_threads(2)
xfeat=XFeat().eval();matcher=LighterGlue().eval();matcher.net.conf.width_confidence=-1
root=Path(sys.argv[2])
a=np.frombuffer((root/'image.bin').read_bytes(),np.uint8).reshape(288,384).copy()
b=cv2.warpAffine(a,np.float32([[1,0,40],[0,1,6]]),(384,288),borderValue=25)
features=[]
with torch.inference_mode():
 for img in [a,b]:
  f=xfeat.detectAndCompute(torch.from_numpy(img.copy()).float()[None,None]/255,top_k=4096)[0]
  p=f['keypoints'];valid=(p[:,0]>=8)&(p[:,1]>=8)&(p[:,0]<376)&(p[:,1]<280)
  f={k:v[valid][:512] for k,v in f.items()};features.append(f)
 d={**{f'keypoints{i}':f['keypoints'][None] for i,f in enumerate(features)},**{f'descriptors{i}':f['descriptors'][None] for i,f in enumerate(features)},'image_size0':torch.tensor([[384,288]]),'image_size1':torch.tensor([[384,288]])}
 out=matcher(d)['matches'][0]
 result={'frames':[a.flatten().tolist(),b.flatten().tolist()],'height':288,'width':384,'features':[{k:v.tolist() for k,v in f.items()} for f in features],'matches':out.tolist()}
 (root/'parity.json').write_text(json.dumps(result))
 print('PyTorch reference:',[len(f['keypoints']) for f in features],len(out),'matches')
