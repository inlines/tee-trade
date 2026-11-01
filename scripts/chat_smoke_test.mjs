// Run after npm ci in front; uses Undici already installed with Angular tooling.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../front/package.json',import.meta.url));
const {WebSocket}=require('undici');
const base=process.env.BASE_URL||'http://localhost:4200';
const env=Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const admin={cookie:'',csrf:''}, buyer={cookie:'',csrf:''}, stranger={cookie:'',csrf:''};
const names=['chat_'+randomUUID().replaceAll('-',''),'chat_'+randomUUID().replaceAll('-','')];
let productId; const sockets=[];
async function request(actor,path,method='GET',body,expected=200,extra={}){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:actor.cookie,'X-CSRF-Token':actor.csrf,...extra},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal(response.status,expected,`${method} ${path}: ${await (response.status===expected?Promise.resolve(''):response.text())}`);
 const cookie=response.headers.get('set-cookie');if(cookie)actor.cookie=cookie.split(';')[0];
 const data=response.status===204?null:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();
 if(data?.csrf_token)actor.csrf=data.csrf_token;return data;
}
async function connect(actor,id,adminSide=false,origin=base,events=false,after){
 const ws=new WebSocket(base.replace(/^http/,'ws')+(events?`/api/${adminSide?'admin':'auth'}/chats/events${after===undefined?'':'?after='+after}`:`/api/${adminSide?'admin':'auth'}/chats/ws?chat_id=${id}`),{headers:{Cookie:actor.cookie,Origin:origin}});
 const queue=[];let notify;ws.addEventListener('message',e=>{queue.push(JSON.parse(e.data));notify?.();});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{ws.close();reject(Error('WebSocket handshake timeout'));},5000);ws.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timeout);reject(Error('WebSocket rejected'));},{once:true});});
 const item={ws,send:value=>ws.send(JSON.stringify(value)),async wait(predicate){const deadline=Date.now()+5000;while(Date.now()<deadline){const index=queue.findIndex(predicate);if(index>=0)return queue.splice(index,1)[0];await new Promise(resolve=>{const timer=setTimeout(resolve,100);notify=()=>{clearTimeout(timer);resolve();};});}throw Error('Missing WebSocket event');}};sockets.push(item);return item;
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,200));
try{
 await request(admin,'/api/admin/login','POST',{username:env.ADMIN_USERNAME||'arzamas',password:env.ADMIN_PASSWORD});
 for(const [i,actor] of [buyer,stranger].entries()){const password=randomUUID();await request(actor,'/api/auth/register','POST',{username:names[i],password,password_confirmation:password},201);}
 const product=await request(admin,'/api/admin/products','POST',{name:'Temporary chat test'},201);productId=product.id;
 await request(buyer,'/api/auth/chats','POST',{product_id:productId},403,{'X-CSRF-Token':''});
 const chat=await request(buyer,'/api/auth/chats','POST',{product_id:productId});
 assert.equal((await request(buyer,'/api/auth/chats','POST',{product_id:productId})).id,chat.id);
 await request(stranger,`/api/auth/chats/${chat.id}/messages`,'GET',undefined,404);
 await request(buyer,'/api/admin/chats','GET',undefined,401);
 await assert.rejects(()=>connect(stranger,chat.id));
 await assert.rejects(()=>connect(buyer,chat.id,false,'https://untrusted.invalid'));
 await assert.rejects(()=>connect({cookie:''},chat.id));
 await assert.rejects(()=>connect(buyer,chat.id,true,base,true));
 const notifications=await connect(admin,chat.id,true,base,true);await notifications.wait(e=>e.type==='ready');
 const buyerEvents=await connect(buyer,chat.id,false,base,true);await buyerEvents.wait(e=>e.type==='ready');
 const otherEvents=await connect(stranger,chat.id,false,base,true);await otherEvents.wait(e=>e.type==='ready');
 await assert.rejects(()=>connect({cookie:''},chat.id,false,base,true));
 await assert.rejects(()=>connect(buyer,chat.id,false,'https://untrusted.invalid',true));
 const b=await connect(buyer,chat.id), a=await connect(admin,chat.id,true);
 assert.deepEqual((await b.wait(e=>e.type==='history')).messages,[]);await a.wait(e=>e.type==='history');
 b.send({type:'typing',active:true});assert.equal((await a.wait(e=>e.type==='typing'&&!e.is_admin)).active,true);
 const outgoing={type:'message',client_id:randomUUID(),body:'Здравствуйте, какой размер?'};b.send(outgoing);
 const saved=(await b.wait(e=>e.type==='message')).message;
 assert.equal((await a.wait(e=>e.type==='message')).message.id,saved.id);
 const notice=await notifications.wait(e=>e.type==='notification');assert.equal(notice.chat.id,chat.id);assert.equal(notice.message.id,saved.id);assert.equal(notice.chat.username,names[0]);
 const resumedNotifications=await connect(admin,chat.id,true,base,true,saved.id-1);assert.equal((await resumedNotifications.wait(e=>e.type==='notification')).message.id,saved.id);await resumedNotifications.wait(e=>e.type==='ready');resumedNotifications.ws.close();
 await pause();b.send(outgoing);assert.equal((await b.wait(e=>e.type==='message')).message.id,saved.id);
 assert.equal((await request(buyer,`/api/auth/chats/${chat.id}/messages`)).messages.length,1);
 a.send({type:'typing',active:true});assert.equal((await b.wait(e=>e.type==='typing'&&e.is_admin&&e.active)).active,true);
 a.send({type:'message',client_id:randomUUID(),body:'Здравствуйте! Размер L.'});
 assert.equal((await b.wait(e=>e.type==='message'&&e.message.is_admin)).message.body,'Здравствуйте! Размер L.');
 const reply=(await a.wait(e=>e.type==='message'&&e.message.is_admin)).message;
 const buyerNotice=await buyerEvents.wait(e=>e.type==='notification');assert.equal(buyerNotice.chat.id,chat.id);assert.equal(buyerNotice.message.id,reply.id);
 const buyerReplay=await connect(buyer,chat.id,false,base,true,reply.id-1);assert.equal((await buyerReplay.wait(e=>e.type==='notification')).message.id,reply.id);await buyerReplay.wait(e=>e.type==='ready');buyerReplay.ws.close();
 const strangerReplay=await connect(stranger,chat.id,false,base,true,0);assert.equal((await strangerReplay.wait(e=>e.type==='ready')).cursor,0);
 await assert.rejects(()=>strangerReplay.wait(e=>e.type==='notification'));
 await assert.rejects(()=>otherEvents.wait(e=>e.type==='notification'));
 await assert.rejects(()=>buyerEvents.wait(e=>e.type==='notification'&&!e.message.is_admin));
 strangerReplay.ws.close();otherEvents.ws.close();
 b.ws.close();const reopened=await connect(buyer,chat.id);assert.equal((await reopened.wait(e=>e.type==='history')).messages.length,2);
 assert.equal((await request(admin,'/api/admin/chats')).find(c=>c.id===chat.id).last_message,'Здравствуйте! Размер L.');
 await pause();a.send({type:'message',client_id:randomUUID(),body:' '});await a.wait(e=>e.type==='error');
 assert.equal((await request(buyer,`/api/auth/chats/${chat.id}/messages`)).messages.length,2);
 // Populate only this disposable chat to verify history pagination.
 assert(Number.isSafeInteger(chat.id));
 execFileSync('docker',['compose','exec','-T','postgres','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'],{input:`INSERT INTO chat_messages (chat_id,is_admin,client_id,body) SELECT ${chat.id}, false, 'fixture-' || i, 'History ' || i FROM generate_series(1,105) i;`,stdio:['pipe','ignore','inherit']});
 const latest=await request(buyer,`/api/auth/chats/${chat.id}/messages`);assert.equal(latest.messages.length,100);assert.equal(latest.has_more,true);
 const older=await request(buyer,`/api/auth/chats/${chat.id}/messages?before=${latest.messages[0].id}`);assert.equal(older.messages.length,7);assert.equal(older.has_more,false);
 await request(admin,`/api/admin/products/${productId}`,'DELETE',undefined,204);productId=null;
 const afterDelete=(await request(buyer,'/api/auth/chats')).find(c=>c.id===chat.id);assert.equal(afterDelete.product_exists,false);assert.equal(afterDelete.product_name,'Temporary chat test');
 assert.equal((await request(buyer,`/api/auth/chats/${chat.id}/messages`)).messages.length,100);
 await request(buyer,'/api/auth/logout','POST',{},204);
 reopened.send({type:'typing',active:true});await reopened.wait(e=>e.type==='unauthorized');
 console.log('PASS: admin and customer notifications, replay and isolation, WebSocket delivery both ways, typing, ownership, origin, history, pagination, deduplication, product deletion and logout revocation');
}finally{
 for(const item of sockets)item.ws.close();
 if(productId)await request(admin,`/api/admin/products/${productId}`,'DELETE',undefined,204);
 assert(names.every(n=>/^chat_[a-f0-9]{32}$/.test(n)));
 execFileSync('docker',['compose','exec','-T','postgres','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'],{input:`DELETE FROM customers WHERE username_key IN (${names.map(n=>"'"+n+"'").join(',')}); DELETE FROM customer_auth_throttle WHERE key IN (${names.map(n=>"'username:"+n+"'").join(',')});`,stdio:['pipe','ignore','inherit']});
 if(admin.csrf)await request(admin,'/api/admin/logout','POST',{},204);
 console.log('Temporary products, customers, chats and messages removed.');
}
