const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..')+'/';const {render,trajectory,K,W,H}=require(root+'tests/fixtures.cjs');
require(root+'vendor/opencv.js').then(cv=>{try{
const dir=process.argv[2]||path.join(__dirname,'generated');fs.mkdirSync(dir,{recursive:true});
for(const kind of ['motion','static','rotation']){
 const frames=[];
 for(let i=0;i<180;i+=6){const {R,C}=trajectory(i,kind),gray=render(cv,R,C);frames.push(Array.from(gray.data));gray.delete();}
 fs.writeFileSync(dir+'/'+kind+'.json',JSON.stringify({width:W,height:H,K,frames,expectNoInitialization:kind!=='motion',...(kind==='motion'?{forceRecoveryAt:25}:{})}));
}
const {R,C}=trajectory(90,'motion'),gray=render(cv,R,C);fs.writeFileSync(dir+'/image.bin',gray.data);gray.delete();process.exit(0);
}catch(e){console.error(e);process.exit(1);}});
