// Run after npm ci in front; uses Undici already installed with Angular tooling.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../front/package.json',import.meta.url));

const base=process.env.BASE_URL||'http://localhost:4200';
const env=Object.fromEntries(readFileSync('.env','utf8').split('\n').filter(l=>l.includes('=')&&!l.startsWith('#')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const admin={cookie:'',csrf:''}, buyer={cookie:'',csrf:''}, stranger={cookie:'',csrf:''};
const names=['chat_'+randomUUID().replaceAll('-',''),'chat_'+randomUUID().replaceAll('-','')];
let productId;
async function request(actor,path,method='GET',body,expected=200,extra={}){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:actor.cookie,'X-CSRF-Token':actor.csrf,...extra},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal(response.status,expected,`${method} ${path}: ${await (response.status===expected?Promise.resolve(''):response.text())}`);
 const cookie=response.headers.get('set-cookie');if(cookie)actor.cookie=cookie.split(';')[0];
 const data=response.status===204?null:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text();
 if(data?.csrf_token)actor.csrf=data.csrf_token;return data;
}

try{
 await request(admin,'/api/admin/login','POST',{username:env.ADMIN_USERNAME||'arzamas',password:env.ADMIN_PASSWORD});
 for(const [i,actor] of [buyer,stranger].entries()){const password=randomUUID();await request(actor,'/api/auth/register','POST',{username:names[i],password,password_confirmation:password},201);}
 const product=await request(admin,'/api/admin/products','POST',{name:'Temporary request test'},201);productId=product.id;
 const d={product_id:productId,last_name:'Тестов',first_name:'Тест',patronymic:'',contact:'test@example.invalid',city:'Тестовый город'};
 await request({cookie:'',csrf:''},'/api/auth/requests','POST',d,401);
 await request(buyer,'/api/auth/requests','POST',d,403,{'X-CSRF-Token':''});
 await request(buyer,'/api/auth/requests','POST',d,403,{Origin:'http://invalid.example'});
 await request(buyer,'/api/auth/requests','POST',{...d,first_name:'  '},400);
 const before=(await request(admin,'/api/admin/requests/events')).cursor;
 const row=await request(buyer,'/api/auth/requests','POST',d,201);
 assert.equal(row.status,'new');assert.equal(row.contact,d.contact);
 await request(buyer,'/api/auth/requests','POST',d,409);
 assert.equal((await request(buyer,'/api/auth/requests')).length,1);
 assert.equal((await request(stranger,'/api/auth/requests')).length,0);
 assert.equal((await request(stranger,'/api/auth/requests/events?after=0')).events.length,0);
 const notice=await request(admin,'/api/admin/requests/events?after='+before);
 assert.equal(notice.events.length,1);assert.equal(notice.events[0].request_id,row.id);
 await request(buyer,'/api/admin/requests', 'GET',undefined,401);
 await request(buyer,'/api/admin/requests/'+row.id+'/status','POST',{status:'in_progress'},401);
 await request(admin,'/api/admin/requests/'+row.id+'/status','POST',{status:'in_progress'},403,{'X-CSRF-Token':''});
 await request(admin,'/api/admin/requests/'+row.id+'/status','POST',{status:'completed'},409);
 await request(admin,'/api/admin/requests/'+row.id+'/status','POST',{status:'invalid'},400);
 const chat=await request(admin,'/api/admin/requests/'+row.id+'/chat');
 assert.equal(chat.id,row.chat_id);assert.equal(chat.username,names[0]);assert.equal(chat.product_id,productId);
 const accepted=await request(admin,'/api/admin/requests/'+row.id+'/status','POST',{status:'in_progress'});
 assert.equal(accepted.status,'in_progress');
 await request(admin,'/api/admin/requests/'+row.id+'/status','POST',{status:'in_progress'},409);
 assert.equal((await request(buyer,'/api/auth/requests'))[0].status,'in_progress');
 const done=await request(admin,'/api/admin/requests/'+row.id+'/status','POST',{status:'completed'});
 assert.equal(done.status,'completed');
 const buyerEvents=await request(buyer,'/api/auth/requests/events?after=0');
 assert.deepEqual(buyerEvents.events.map(e=>e.status),['in_progress','completed']);
 assert.equal((await request(buyer,'/api/auth/requests/events?after='+buyerEvents.cursor)).events.length,0);
 assert.equal((await request(stranger,'/api/auth/requests/events?after=0')).events.length,0);
 const reopened=await request(buyer,'/api/auth/requests','POST',d,201);assert.notEqual(reopened.id,row.id);assert.equal(reopened.chat_id,row.chat_id);
 await request(admin,'/api/admin/products/'+productId,'DELETE',undefined,204);productId=null;
 const saved=(await request(buyer,'/api/auth/requests')).find(r=>r.id===row.id);
 assert.equal(saved.product_exists,false);assert.equal(saved.product_name,'Temporary request test');assert.equal(saved.contact,d.contact);
 assert.equal((await request(admin,'/api/admin/requests/'+row.id+'/chat')).id,row.chat_id);
 console.log('PASS: create, validation, auth/CSRF/origin, customer isolation, active duplicates, status transitions, archive persistence, chat association, notification recipients/replay, deleted product snapshots');
}finally{
 if(productId)await request(admin,'/api/admin/products/'+productId,'DELETE',undefined,204);
 assert(names.every(n=>/^chat_[a-f0-9]{32}$/.test(n)));
 execFileSync('docker',['compose','exec','-T','postgres','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'],{input:`DELETE FROM customers WHERE username_key IN (${names.map(n=>"'"+n+"'").join(',')}); DELETE FROM customer_auth_throttle WHERE key IN (${names.map(n=>"'username:"+n+"'").join(',')});`,stdio:['pipe','ignore','inherit']});
 if(admin.csrf)await request(admin,'/api/admin/logout','POST',{},204);
 console.log('Temporary request test data removed.');
}
