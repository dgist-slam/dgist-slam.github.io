const assert=require('node:assert/strict');
global.VOGeometry=require('../geometry.js');
const G=VOGeometry,{Tracker}=require('../tracker.js'),{render,trajectory,metrics,K}=require('./fixtures.cjs');
require('../vendor/opencv.js').then(cv=>{try{
 let seed=7341;Math.random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296);let report={};
 for(let kind of ['motion','static','rotation','occlusion','turn','long-loss']){
  let tracker=new Tracker(cv),log=[],turnPositions=[],turnStart=null,frames=['turn','long-loss'].includes(kind)?300:180;
  for(let i=0;i<frames;i++){
   let {R,C}=trajectory(i,kind);
   if(kind==='turn'&&i>=105){C=trajectory(105,'motion').C;let angle=(i-105)*.001;R=[[Math.cos(angle),0,Math.sin(angle)],[0,1,0],[-Math.sin(angle),0,Math.cos(angle)]];}
   let blank=(kind==='occlusion'&&i>=112&&i<118)||(kind==='long-loss'&&i>=112&&i<148),gray=render(cv,R,C,blank),r=tracker.process(gray,K);gray.delete();
   assert(r.referenceFrames<=6);assert(r.retainedPoints<=1800);assert(r.mapPoints<=300);assert(r.tracks.length<=300);if(r.pose)assert(r.pose.position.every(Number.isFinite));
   if(kind==='long-loss'&&blank){assert.equal(r.pose,null);assert(r.referenceFrames>0);assert(r.retainedPoints>0);}
   if(kind==='turn'&&i>=115&&r.pose){turnStart??=r.pose.position;turnPositions.push(G.norm(r.pose.position.map((v,j)=>v-turnStart[j])));}
   log.push({...r,i,C});
  }
  let m=metrics(log);report[kind]={poses:m.poses,rmse:m.rmse,segments:new Set(log.map(v=>v.segment)).size,recoveries:log.at(-1).recoveries,lastPhase:log.at(-1).phase};
  console.log(kind,report[kind]);
  if(kind==='static'||kind==='rotation')assert.equal(m.poses,0,kind+' must not initialize translation');
  if(kind==='motion'||kind==='occlusion'){assert(m.poses>100);assert(m.rmse<.12);assert.equal(m.stopDrift,0);}
  if(kind==='occlusion')assert(report[kind].recoveries>=1);
  if(kind==='turn'){report[kind].turnDrift=Math.max(...turnPositions);assert(report[kind].turnDrift<.03);assert.equal(report[kind].segments,1);}
  if(kind==='long-loss'){assert.equal(report[kind].segments,1);assert(report[kind].recoveries>=1);}
  if(!['static','rotation'].includes(kind))assert.equal(log.at(-1).phase,'tracking');
  tracker.reset();
 }
 console.log(JSON.stringify(report,null,2));console.log('PASS: sparse VO image-sequence regressions');process.exit(0);
}catch(e){console.error(e.message);process.exit(1);}});
