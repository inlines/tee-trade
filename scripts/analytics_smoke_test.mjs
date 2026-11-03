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

const guest={cookie:'',csrf:''};
async function view(actor,id,origin){
 const response=await fetch(base+'/api/auth/product-views/'+id,{method:'POST',headers:{Cookie:actor.cookie,...(origin?{Origin:origin}:{})}});
 if(response.status===204){const cookie=response.headers.get('set-cookie');if(cookie){assert(cookie.includes('HttpOnly'));assert(cookie.includes('Path=/api/auth'));actor.cookie=actor.cookie.split(';').filter(c=>!c.trim().startsWith('tt_visitor=')).filter(Boolean).concat(cookie.split(';')[0]).join('; ');}}
 return response.status;
}
function sql(query){return execFileSync('docker',['compose','exec','-T','postgres','sh','-c','psql -X -qAt -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'],{input:query,encoding:'utf8'}).trim();}
try{
 await request(admin,'/api/admin/login','POST',{username:env.ADMIN_USERNAME||'arzamas',password:env.ADMIN_PASSWORD});
 const password=randomUUID();await request(buyer,'/api/auth/register','POST',{username:names[0],password,password_confirmation:password},201);
 const product=await request(admin,'/api/admin/products','POST',{name:'Temporary analytics test'},201);productId=product.id;
 assert(Number.isSafeInteger(productId));
 assert.equal(await view(guest,productId,'http://invalid.example'),403);
 assert.equal(await view(guest,productId),204);assert.equal(await view(guest,productId),204);
 assert.equal(await view(buyer,productId),204);assert.equal(await view(buyer,productId),204);
 assert.equal(sql('SELECT count(*) FROM product_views WHERE product_id='+productId),'2');
 assert.equal(sql('SELECT count(*) FROM product_views WHERE product_id='+productId+' AND customer_id IS NOT NULL'),'1');
 assert.equal(sql('SELECT count(*) FROM product_views WHERE product_id='+productId+' AND length(visitor_hash)=64'),'2');
 assert.equal((await request(buyer,'/api/auth/session')).username,names[0]);
 await request(admin,'/api/admin/products/'+productId,'DELETE',undefined,204);
 assert.equal(await view(guest,productId),204);
 assert.equal(sql('SELECT count(*) FROM product_views WHERE product_id='+productId),'2');
 sql('DELETE FROM product_views WHERE product_id='+productId);productId=null;
 const metrics=await (await fetch('http://localhost:8080/metrics')).text();
 assert(metrics.includes('http_request_duration_seconds_bucket'));assert(metrics.includes('tee_business_collection_success 1'));
 assert(metrics.includes('tee_dependency_up{dependency="postgres"} 1'));assert(metrics.includes('tee_websocket_connections'));
 console.log('PASS: guest/authenticated view attribution, 30-minute deduplication, origin check, retained view history, customer cookie preserved, health metrics');
}finally{
 if(productId){sql('DELETE FROM product_views WHERE product_id='+productId);await request(admin,'/api/admin/products/'+productId,'DELETE',undefined,204);}
 assert(names.every(n=>/^chat_[a-f0-9]{32}$/.test(n)));
 execFileSync('docker',['compose','exec','-T','postgres','sh','-c','psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'],{input:`DELETE FROM customers WHERE username_key IN (${names.map(n=>"'"+n+"'").join(',')}); DELETE FROM customer_auth_throttle WHERE key IN (${names.map(n=>"'username:"+n+"'").join(',')});`,stdio:['pipe','ignore','inherit']});
 if(admin.csrf)await request(admin,'/api/admin/logout','POST',{},204);
 console.log('Temporary analytics test data removed.');
}
