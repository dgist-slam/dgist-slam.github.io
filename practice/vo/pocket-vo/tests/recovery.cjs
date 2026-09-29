const assert=require('node:assert/strict');global.VOGeometry=require('../geometry.js');const G=VOGeometry,{Tracker}=require('../tracker.js'),{render,trajectory,K,W,H}=require('./fixtures.cjs');
require('../vendor/opencv.js').then(cv=>{try{
 let seed=7341;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);
 const tracker=new Tracker(cv);let last;
 for(let i=0;i<=120;i++){const {R,C}=trajectory(i,'motion'),gray=render(cv,R,C);last=tracker.process(gray,K);gray.delete();}
 assert.equal(last.phase,'tracking');const original=last.pose.position,segment=last.segment;
 for(let i=0;i<180;i++){const gray=new cv.Mat(H,W,cv.CV_8UC1,new cv.Scalar(25));last=tracker.process(gray,K);gray.delete();assert.equal(last.segment,segment);assert.equal(last.pose,null);assert(last.referenceFrames>0);assert(last.retainedPoints>0);assert.deepEqual(tracker.pose().position,original);}
 let recoveredAt=null;for(let i=0;i<18;i++){const {R,C}=trajectory(120,'motion'),gray=render(cv,R,C);last=tracker.process(gray,K);gray.delete();if(last.pose){recoveredAt=i;break;}}
 assert.notEqual(recoveredAt,null);assert.equal(last.segment,segment);assert(G.norm(last.pose.position.map((x,i)=>x-original[i]))<.01);
 console.log('180 lost frames: same map retained, position frozen; recovery after',recoveredAt,'frames');tracker.reset();assert.equal(tracker.keys.length,0);
 const t=new Tracker(cv);t.w=W;t.h=H;const source=new cv.Mat(H,W,cv.CV_8UC1),shifted=new cv.Mat(H,W,cv.CV_8UC1,new cv.Scalar(0));for(let i=0;i<source.data.length;i++)source.data[i]=Math.floor(Math.random()*256);cv.GaussianBlur(source,source,new cv.Size(3,3),.7);
 const dx=75,dy=-6;for(let y=0;y<H;y++)for(let x=0;x<W;x++){let u=x+dx,v=y+dy;if(u>=0&&v>=0&&u<W&&v<H)shifted.data[v*W+u]=source.data[y*W+x];}
 t.detect(source,K);const key={gray:source,orb:t.describe(source),features:t.features};const matched=t.guidedRecovery(key,shifted),error=G.med(matched.map(f=>Math.hypot(f.p[0]-f.previous[0]-dx,f.p[1]-f.previous[1]-dy)));assert(matched.length>30);assert(error<.5);console.log('Descriptor-guided recovery:',matched.length,'tracks; median error',error,'px for 75 px displacement');source.delete();shifted.delete();key.orb.keypoints.delete();key.orb.descriptors.delete();t.reset();
 console.log('PASS: map preservation and large-displacement feature reacquisition');process.exit(0);
}catch(e){console.error(e.message);process.exit(1);}});
