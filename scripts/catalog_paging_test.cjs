const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const req=require('node:module').createRequire(require('node:path').resolve('front/package.json'));
const ts=req('typescript');
const source=fs.readFileSync('front/src/app/pages.ts','utf8').split('export class CatalogPage {')[1].split('\n@Component')[0];
const signal=v=>{const f=()=>v;f.set=n=>v=n;f.update=fn=>v=fn(v);return f;};
let reset,destroy,mobile=false,events;
class NavigationStart {}
class NavigationEnd {constructor(id){this.id=id;}}
class Scroll {}
let navigation={id:1};
const router={url:'/',getCurrentNavigation:()=>navigation,events:{subscribe:f=>{events=f;return{unsubscribe(){}};}}};
const snapshots=new Map();
const history={save:(id,s)=>snapshots.set(id,s),get:(id,url)=>snapshots.get(id)?.url===url?snapshots.get(id):undefined,latest:url=>[...snapshots.values()].reverse().find(s=>s.url===url)};
let scroll=0;const browserHistory={state:{}};

const calls=[],category=signal('');
const api={page:(...args)=>({subscribe(observer){const call={args,observer,cancelled:false};calls.push(call);return {unsubscribe(){call.cancelled=true;}};}})};
const exportsObject={};
vm.runInNewContext(ts.transpileModule('export class CatalogPage {'+source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:exportsObject,signal,computed:f=>f,effect:f=>reset=f,untracked:f=>f(),DestroyRef:'destroy',ActivatedRoute:'route',CatalogService:'api',Router:'router',CatalogHistory:'history',NavigationStart,NavigationEnd,Scroll,requestAnimationFrame:f=>{f();return 1;},cancelAnimationFrame:()=>{},
 inject:t=>t==='router'?router:t==='history'?history:t==='api'?api:t==='route'?{paramMap:{pipe(){}},snapshot:{data:{}}}:{onDestroy:f=>destroy=f},
 toSignal:()=>category,map:()=>{},categories:[{slug:'hoodies',name:'Худи'}],categoryName:()=>'',window:{history:browserHistory,scrollY:1234,scrollTo:options=>scroll=options.top,matchMedia:()=>({matches:mobile})}
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
page.toggleSize('US 9');page.toggleSize('EU 42');page.sizesOpen.set(true);
page.toggleBrand('Brand A');page.toggleBrand('Brand B');
assert.equal(page.selectedBrands().join(','),'Brand A,Brand B');
page.sort.set('price-desc');reset();assert.equal(calls[3].cancelled,true);assert.equal(calls[4].args[2],'price-desc');assert.equal(calls[4].args[4],0);
calls[4].observer.next({items:[{id:42},{id:43},{id:44},{id:45}],brands:['Brand A','Brand B'],sizes:['US 9','EU 42'],total:20});
assert.equal(calls[4].args[6].join(','),'US 9,EU 42');
page.brandsOpen.set(true);
events(new NavigationStart());destroy();assert.equal(calls[4].cancelled,true);
navigation={id:3,trigger:'popstate'};history.restoredId=1;router.url='/product/42';
const restored=new exportsObject.CatalogPage();reset();
assert.equal(calls.length,5,'Back must restore loaded cards without refetching page 1');
assert.equal(restored.items().length,4);assert.equal(restored.sort(),'price-desc');
assert.equal(restored.selectedBrands().join(','),'Brand A,Brand B');assert.equal(restored.brandsOpen(),true);
assert.equal(restored.selectedSizes().join(','),'US 9,EU 42');assert.equal(restored.sizesOpen(),true);
events(new Scroll());assert.equal(scroll,1234);assert.equal(restored.restoring(),false);
restored.loadMore();assert.equal(calls[5].args[4],4);assert.equal(calls[5].args[3],4);
destroy();
mobile=false;
history.save(20,{...snapshots.get(1),url:'/catalog/hoodies',pageSize:8,offset:16,items:Array.from({length:16},(_,i)=>({id:i+1})),y:2500});
navigation={id:21,trigger:'popstate'};history.restoredId=20;router.url='/product/12';
const desktop=new exportsObject.CatalogPage();reset();events(new Scroll());
assert.equal(desktop.items().length,16);assert.equal(scroll,2500);
desktop.loadMore();assert.equal(calls[6].args[3],8);assert.equal(calls[6].args[4],16);destroy();
console.log('PASS: desktop/mobile back restores all cards, filters, scroll and next offset; append order, 8/4 page sizes, concurrent-load guard, retry without losing cards, filter/sort reset and cancellation');
