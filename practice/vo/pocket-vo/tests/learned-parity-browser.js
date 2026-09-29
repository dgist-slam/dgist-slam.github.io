(async()=>{
 const fixture=await (await fetch('tests/generated/parity.json')).json();
 const worker=new Worker('tests/learned-worker.js');
 const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test timeout')),90000);worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};worker.onerror=reject;worker.postMessage({...fixture,type:'pair',forceWasm:globalThis.POCKET_TEST_WASM!==false});}).finally(()=>worker.terminate());
 if(!result.ok)throw Error(result.error);
 let error=0,shared=0;const expected=new Set(fixture.matches.map(([i,j])=>[...fixture.features[0].keypoints[i],...fixture.features[1].keypoints[j]].join(',')));
 for(let b=0;b<2;b++){
  if(result.features[b].points.length!==fixture.features[b].keypoints.length)throw Error('Keypoint count mismatch');
  const ref=new Map(fixture.features[b].keypoints.map((p,i)=>[p.join(','),i]));
  for(let i=0;i<result.features[b].points.length;i++){
   const j=ref.get(result.features[b].points[i].join(','));if(j===undefined)throw Error('Keypoint coordinates mismatch');
   for(let c=0;c<64;c++)error=Math.max(error,Math.abs(result.features[b].descriptors[i*64+c]-fixture.features[b].descriptors[j][c]));
  }
 }
 for(const [i,j] of result.matches)if(expected.has([...result.features[0].points[i],...result.features[1].points[j]].join(',')))shared++;
 if(error>.002||shared<fixture.matches.length*.98)throw Error(JSON.stringify({error,shared,expected:fixture.matches.length}));
 const dx=result.matches.map(([i,j])=>result.features[1].points[j][0]-result.features[0].points[i][0]).sort((a,b)=>a-b);
 return JSON.stringify({backend:result.backend,keypoints:result.features.map(f=>f.points.length),matches:result.matches.length,referenceMatches:fixture.matches.length,shared,maxDescriptorError:error,medianDisplacement:dx[Math.floor(dx.length/2)],...result.stats});
})()
