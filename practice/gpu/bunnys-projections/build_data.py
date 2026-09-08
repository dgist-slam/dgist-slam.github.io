"""Rebuild data/: Python + numpy + plyfile; downloads original Stanford archives."""
from pathlib import Path
import hashlib, io, json, tarfile, urllib.request
import numpy as np
from plyfile import PlyData

ROOT=Path(__file__).resolve().parent
MODELS={
 'Bunny':('bunny','https://graphics.stanford.edu/pub/3Dscanrep/bunny.tar.gz','bun_zipper.ply'),
 'Dragon':('dragon','https://graphics.stanford.edu/pub/3Dscanrep/dragon/dragon_recon.tar.gz','dragon_vrip.ply'),
 'Happy Buddha':('buddha','https://graphics.stanford.edu/pub/3Dscanrep/happy/happy_recon.tar.gz','happy_vrip.ply'),
 'Drill':('drill','https://graphics.stanford.edu/pub/3Dscanrep/drill.tar.gz','drill_shaft_vrip.ply')}

def main():
 out=ROOT/'data';out.mkdir(exist_ok=True);cache=ROOT/'.model-cache';cache.mkdir(exist_ok=True);manifest={}
 for name,(slug,url,suffix) in MODELS.items():
  archive=cache/url.split('/')[-1]
  if not archive.exists():urllib.request.urlretrieve(url,archive)
  with tarfile.open(archive,'r:gz') as tf:
   member=next(m for m in tf.getmembers() if m.name.endswith(suffix))
   v=PlyData.read(io.BytesIO(tf.extractfile(member).read()))['vertex']
  p=np.column_stack([v[k] for k in ['x','y','z']]).astype(np.float32);count=len(p)
  p-=np.array([(p[:,0].min()+p[:,0].max())/2,p[:,1].min(),(p[:,2].min()+p[:,2].max())/2],np.float32);p/=np.ptp(p[:,1])
  if count>100000:p=p[np.sort(np.random.default_rng(616).choice(count,100000,replace=False))]
  p=p[np.random.default_rng(616).permutation(len(p))].astype('<f4');blob=p.tobytes();(out/(slug+'.bin')).write_bytes(blob)
  manifest[name]=dict(model=name,source=url,original_points=count,points_per_instance=len(p),sample_seed=616,sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),file=slug+'.bin',count=len(p),format='little-endian float32 XYZ',sha256_points=hashlib.sha256(blob).hexdigest(),spacing=max(1.5,float(np.ptp(p[:,0]))*1.15,float(np.ptp(p[:,2]))*1.15))
 (out/'models.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')

if __name__=='__main__':main()
