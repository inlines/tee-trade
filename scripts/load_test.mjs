// Local-only closed-loop load test. No accounts, orders or chat messages are created.
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
const base=process.env.BASE_URL||'http://localhost:4200';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local targets only');
const seconds=Number(process.env.DURATION||10),think=Number(process.env.THINK_MS||0);
const products=await (await fetch(base+'/api/products')).json();
const paths=['/api/products/page?limit=8','/api/products/page?limit=4&category=t-shirts','/api/storefront',...(products.slice(0,4).map(p=>'/api/products/'+p.id))];
for(const path of paths)await (await fetch(base+path)).arrayBuffer();
const results=[];
for(const users of (process.env.USERS||'10,50,100,200').split(',').map(Number)){
 const times=[],statuses={};let bytes=0;
 const start=performance.now(),end=start+seconds*1000;
 await Promise.all(Array.from({length:users},async(_,i)=>{
  let n=i;
  while(performance.now()<end){
   const t=performance.now();
   try{const r=await fetch(base+paths[n++%paths.length],{signal:AbortSignal.timeout(10000)});const length=(await r.arrayBuffer()).byteLength;bytes+=length;statuses[r.status]=(statuses[r.status]||0)+1;}
   catch{statuses.error=(statuses.error||0)+1;}
   times.push(performance.now()-t);
   if(think)await new Promise(r=>setTimeout(r,think));
  }
 }));
 times.sort((a,b)=>a-b);
 const duration=(performance.now()-start)/1000;
 const row={users,think_ms:think,seconds:duration,requests:times.length,rps:times.length/duration,p50_ms:times[Math.floor(times.length*.5)],p95_ms:times[Math.floor(times.length*.95)],p99_ms:times[Math.floor(times.length*.99)],statuses,bytes};
 results.push(row);console.log(JSON.stringify(row));
}
writeFileSync(process.env.REPORT||'/tmp/futba-load.json',JSON.stringify({base,date:new Date().toISOString(),scenario:'Warm public JSON API, closed loop, no writes or images',products:products.length,paths,results},null,2));
