const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const req=require('node:module').createRequire(require('node:path').resolve('front/package.json'));
const ts=req('typescript');
const source=fs.readFileSync('front/src/app/pages.ts','utf8').split('export class CatalogPage {')[1].split('\n@Component')[0];
const signal=v=>{const f=()=>v;f.set=n=>v=n;f.update=fn=>v=fn(v);return f;};
let reset,destroy,mobile=false;
const calls=[],category=signal('');
const api={page:(...args)=>({subscribe(observer){const call={args,observer,cancelled:false};calls.push(call);return {unsubscribe(){call.cancelled=true;}};}})};
const exportsObject={};
vm.runInNewContext(ts.transpileModule('export class CatalogPage {'+source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:exportsObject,signal,computed:f=>f,effect:f=>reset=f,untracked:f=>f(),DestroyRef:'destroy',ActivatedRoute:'route',CatalogService:'api',
 inject:t=>t==='api'?api:t==='route'?{paramMap:{pipe(){}},snapshot:{data:{}}}:{onDestroy:f=>destroy=f},
 toSignal:()=>category,map:()=>{},categories:[{slug:'hoodies',name:'Худи'}],categoryName:()=>'',window:{matchMedia:()=>({matches:mobile})}
});
const page=new exportsObject.CatalogPage();reset();
assert.equal(calls[0].args[3],8);page.loadMore();assert.equal(calls.length,1);
calls[0].observer.next({items:Array.from({length:8},(_,i)=>({id:i+1})),total:12});
page.loadMore();assert.equal(calls[1].args[4],8);
calls[1].observer.error();assert.equal(page.items().length,8);assert.ok(page.error());
page.loadMore();assert.equal(calls[2].args[4],8);calls[2].observer.next({items:[9,10,11,12].map(id=>({id})),total:12});
assert.equal(page.items().map(p=>p.id).join(','),'1,2,3,4,5,6,7,8,9,10,11,12');assert.equal(page.hasMore(),false);
page.loadMore();assert.equal(calls.length,3);
mobile=true;category.set('hoodies');reset();assert.equal(page.items().length,0);assert.equal(calls[3].args.slice(0,5).join('|'),'hoodies|false|default|4|0');
page.toggleBrand('Brand A');page.toggleBrand('Brand B');
assert.equal(page.selectedBrands().join(','),'Brand A,Brand B');
page.sort.set('price-desc');reset();assert.equal(calls[3].cancelled,true);assert.equal(calls[4].args[2],'price-desc');assert.equal(calls[4].args[4],0);
destroy();assert.equal(calls[4].cancelled,true);
console.log('PASS: append order, 8/4 page sizes, concurrent-load guard, retry without losing cards, filter/sort reset and cancellation');
