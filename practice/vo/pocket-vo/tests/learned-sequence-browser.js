(async()=>{
 const reports={};
 for(const kind of ['motion','static','rotation']){
  const fixture=await (await fetch('tests/generated/'+kind+'.json')).json();
  const worker=new Worker('tests/learned-worker.js');
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test timeout '+kind)),90000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.onerror=reject;worker.postMessage({...fixture,type:'sequence',forceWasm:true});}).finally(()=>worker.terminate());
  if(!result.ok)throw Error(kind+': '+result.error);
  reports[kind]={backend:result.backend,trackingFrames:result.log.filter(r=>r.phase==='tracking').length,final:result.log.at(-1),stats:result.stats};
 }
 return JSON.stringify(reports);
})()
