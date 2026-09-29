const G=require('../geometry.js');global.VOGeometry=G;const {Tracker,project}=require('../tracker.js');
let state=321;const rand=()=>((state=(1664525*state+1013904223)>>>0)/4294967296);const scene=Array.from({length:550},()=>({X:[(rand()-.5)*11,(rand()-.5)*8,3+rand()*10],level:100+rand()*150,style:Math.floor(rand()*4)})).sort((a,b)=>b.X[2]-a.X[2]);
const K={fx:310,fy:307,cx:189,cy:141,skew:0},W=384,H=288;
function render(cv,R,C,occlusion=false){let gray=new cv.Mat(H,W,cv.CV_8UC1,new cv.Scalar(25)),buf=gray.data,t=G.mv(R,C).map(v=>-v);if(occlusion)return gray;
 for(let {X,level,style} of scene){let p=project(X,R,t,K);if(!p||p[0]<5||p[1]<5||p[0]>W-5||p[1]>H-5)continue;let x0=Math.floor(p[0]),y0=Math.floor(p[1]),dx=p[0]-x0,dy=p[1]-y0;
  for(let j=-3;j<=3;j++)for(let i=-3;i<=3;i++){let c=((i<0)===(j<0))?level:level*.27;if(style&1)c=255-c;if(Math.abs(i)===3||Math.abs(j)===3)c=25;
   // Bilinear shift of independently textured feature patches.
   for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){let idx=(y0+j+yy)*W+x0+i+xx,weight=(xx?dx:1-dx)*(yy?dy:1-dy);buf[idx]=Math.max(buf[idx],25+(c-25)*weight);}
  }
 }return gray;}
function trajectory(i,kind){let x,z,yaw;if(kind==='rotation'){x=z=0;yaw=.12*Math.sin(i/50);}else if(kind==='static'){x=z=yaw=0;}else{const u=i/40;let progress=i<75?i/75:i<105?1:1+(i-105)/75;x=.9*progress;z=.18*Math.sin(progress*2);yaw=.03*Math.sin(progress*2);}const R=[[Math.cos(yaw),0,Math.sin(yaw)],[0,1,0],[-Math.sin(yaw),0,Math.cos(yaw)]];return {R,C:[x,0,z]};}
function metrics(log){let tracked=log.filter(v=>v.pose),start=tracked[0];if(!start)return {poses:0};let pairs=tracked.map(v=>({p:v.pose.position,c:v.C}));let numerator=0,den=0;for(let v of pairs){numerator+=G.dot(v.p,v.c);den+=G.dot(v.p,v.p);}let s=numerator/den,rmse=Math.sqrt(pairs.reduce((sum,v)=>sum+G.norm(v.p.map((x,i)=>x*s-v.c[i]))**2,0)/pairs.length),stopped=tracked.filter(v=>v.i>=80&&v.i<=100),stopDrift=stopped.length>1?G.norm(stopped.at(-1).pose.position.map((x,i)=>s*(x-stopped[0].pose.position[i]))):null;return {poses:tracked.length,first:start.i,scale:s,rmse,stopDrift,last:tracked.at(-1).i,segments:new Set(log.map(l=>l.segment)).size};}
module.exports={render,trajectory,metrics,K,W,H};
