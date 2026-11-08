// Local idle-notification connection capacity. One disposable account, not 200 real users.
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../front/package.json',import.meta.url));
const {WebSocket}=require('undici');
const base='http://localhost:4200',name='load_'+randomUUID().replaceAll('-',''),password=randomUUID(),sockets=[];
let cookie,csrf;
try{
 const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({username:name,password,password_confirmation:password})});
 assert.equal(r.status,201);cookie=r.headers.get('set-cookie').split(';')[0];csrf=(await r.json()).csrf_token;
 const times=[];let errors=0,messages=0;
 for(let batch=0;batch<10;batch++){
  await Promise.all(Array.from({length:20},()=>new Promise((resolve,reject)=>{
   const start=performance.now(),ws=new WebSocket(base.replace('http','ws')+'/api/auth/chats/events',{headers:{Cookie:cookie,Origin:base}});sockets.push(ws);
   const timer=setTimeout(()=>reject(Error('Handshake timeout')),10000);
   ws.addEventListener('error',()=>{errors++;clearTimeout(timer);reject(Error('Socket error'));});
   ws.addEventListener('message',()=>messages++);
   ws.addEventListener('open',()=>{clearTimeout(timer);times.push(performance.now()-start);resolve();},{once:true});
  })));
 }
 await new Promise(r=>setTimeout(r,20000));
 const open=sockets.filter(s=>s.readyState===WebSocket.OPEN).length;
 assert.equal(open,200);assert.equal(errors,0);
 times.sort((a,b)=>a-b);
 const result={connections:200,open_after_20s:open,errors,received_frames:messages,p95_handshake_ms:times[Math.floor(times.length*.95)],scope:'One disposable customer, idle notification streams; not message throughput or 200 distinct accounts'};
 writeFileSync('/tmp/futba-websocket-load.json',JSON.stringify(result,null,2));console.log(result);
 await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,Origin:base}});
}finally{
 for(const ws of sockets)ws.close();
 assert(/^load_[a-f0-9]{32}$/.test(name));
 execFileSync('docker',['compose','exec','-T','postgres','sh','-c','psql -Xq -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],{input:"DELETE FROM customers WHERE username_key='"+name+"'; DELETE FROM customer_auth_throttle WHERE key='username:"+name+"';"});
}
