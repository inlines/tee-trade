const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const req=require('node:module').createRequire(require('node:path').resolve('front/package.json'));
const ts=req('typescript'), rx=req('rxjs');
class HttpErrorResponse extends Error {}
function load(path,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,{exports,require:name=>deps[name]||{},Error,FormData:class{append(){}},setTimeout});return exports;}
const core={Component:()=>()=>{},Injectable:()=>()=>{}};
const {AdminPage}=load('front/src/app/admin-page.ts',{'@angular/core':core,'@angular/common/http':{HttpErrorResponse}});
const signal=value=>{const fn=()=>value;fn.set=v=>value=v;fn.update=f=>value=f(value);return fn;};
(async()=>{
 const page=Object.create(AdminPage.prototype);for(const [k,v] of Object.entries({busy:false,uploading:false,error:'',failedUploads:[],uploadProgress:'',images:[],dirtyProduct:false}))page[k]=signal(v);
 page.draft={name:'Test'};
 const files=Array.from({length:6},(_,i)=>({name:`photo-${i}.jpg`,size:3300000,type:'image/jpeg'}));
 let inFlight=0,max=0;const attempts=[];
 page.api={upload:async file=>{attempts.push(file.name);max=Math.max(max,++inFlight);await new Promise(r=>setTimeout(r,5));inFlight--;if(file===files[0]){const error=new Error();error.name='TimeoutError';throw error;}return {url:file.name};}};
 await page.uploadFiles(files);
 assert.equal(attempts.length,6);assert.equal(max,1);assert.equal(page.uploading(),false);assert.equal(page.images().length,5);assert.equal(page.failedUploads()[0],files[0]);assert.match(page.error(),/45 секунд/);
 page.api.upload=async file=>({url:file.name});await page.uploadFiles(page.failedUploads());assert.equal(page.images().length,6);assert.equal(page.failedUploads().length,0);
 assert.equal(page.images().filter(i=>i.kind==='front').length,1);
 const {AdminService}=load('front/src/app/admin.service.ts',{'@angular/core':core,'@angular/common/http':{HttpEventType:{Response:4,UploadProgress:1}},rxjs:{...rx,timeout:options=>{assert.equal(options.each,45000);return rx.timeout(20);}}});
 const service=Object.create(AdminService.prototype);service.session=()=>({csrf_token:'test'});service.http={post:()=>rx.NEVER};
 await assert.rejects(service.upload(files[0]),e=>e.name==='TimeoutError');
 console.log('PASS: six-file serial queue, first-file timeout does not block others, retry without duplicates, actual stalled HTTP timeout');
})().catch(e=>{console.error(e);process.exitCode=1;});
