const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('node:module').createRequire(require('node:path').resolve('front/package.json'))('typescript');
const signal=value=>{const f=()=>value;f.set=v=>value=v;f.update=fn=>value=fn(value);return f;};
let mobile=false;const calls=[];
const api={session:()=>({}),page(...args){return new Promise((resolve,reject)=>calls.push({args,resolve,reject}));}};
const exported={};
const source='export class AdminPage {'+fs.readFileSync('front/src/app/admin-page.ts','utf8').split('export class AdminPage {')[1];
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
 exports:exported,HostListener:()=>()=>{},cancelAnimationFrame:()=>{},signal,effect:()=>{},untracked:f=>f(),toSignal:()=>()=>null,categories:[],
 AdminService:'api',ChatService:'chat',ActivatedRoute:'route',Router:'router',DestroyRef:'destroy',
 inject:t=>t==='api'?api:t==='destroy'?{onDestroy(){}}:t==='route'?{snapshot:{queryParamMap:{get:()=>null}}}:{},
 window:{matchMedia:()=>({matches:mobile})}
});
exported.AdminPage.prototype.initialize=async()=>{};
(async()=>{
 const page=new exported.AdminPage();let load=page.resetProducts();assert.equal(calls[0].args[2],8);
 calls[0].resolve({items:Array.from({length:8},(_,i)=>({id:i+1,name:''})),total:12});await load;
 load=page.loadMore();await page.loadMore();assert.equal(calls.length,2);assert.equal(calls[1].args[3],8);
 calls[1].reject(Error());await load;assert.equal(page.products().length,8);assert.ok(page.listError());
 load=page.loadMore();calls[2].resolve({items:[9,10,11,12].map(id=>({id,name:''})),total:12});await load;
 assert.equal(page.products().map(p=>p.id).join(','),'1,2,3,4,5,6,7,8,9,10,11,12');assert.equal(page.hasMore(),false);
 page.moveProduct(0,9);assert.equal(page.products()[9].id,1);assert.equal(page.orderDirty(),true);
 page.moveProduct(9,0);assert.equal(page.orderDirty(),false);
 page.search.set('filter');page.moveProduct(0,1);assert.equal(page.products()[0].id,1);page.search.set('');
 mobile=true;page.tab.set('archive');load=page.resetProducts();assert.equal(calls[3].args[1],true);assert.equal(calls[3].args[2],4);
 page.search.set('different');const newer=page.resetProducts();calls[4].resolve({items:[{id:99,name:'new'}],total:1});await newer;
 calls[3].resolve({items:[{id:98,name:'stale'}],total:1});await load;assert.equal(page.products()[0].id,99);
 page.tab.set('products');page.incomplete.set(true);load=page.resetProducts();
 assert.equal(calls[5].args[4],true);calls[5].resolve({items:[],total:0});await load;
 assert.equal(page.missing({name:'',category:'',brands:[],sizes:[],description:'',theme:'',price_cents:null,images:[]}), 'название, категория, бренды, размеры, описание, тематика, цена, фотографии');
 assert.equal(page.missing({name:'Item',category:'hoodies',brands:['A','B'],sizes:['L'],description:'Text',theme:'Sport',price_cents:0,images:[{}]}),'');
 console.log('PASS: admin append, 8/4 sizes, retry, no parallel duplicates, server search/archive reset and stale response isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
