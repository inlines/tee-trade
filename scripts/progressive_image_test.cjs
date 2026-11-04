const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const req=require('node:module').createRequire(require('node:path').resolve('front/package.json'));
const ts=req('typescript');
const exported={};let run,cleanup;
const images=[];
class ImageMock{constructor(){images.push(this);}decode(){return new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});}}
const signal=v=>{const f=()=>v;f.set=n=>v=n;return f;};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('front/src/app/progressive-image.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText,{exports:exported,Image:ImageMock,require:n=>n==='@angular/core'?{Directive:()=>()=>{},signal,computed:f=>f,input:{required:()=>signal('')},effect:f=>run=()=>{cleanup?.();f(fn=>cleanup=fn);}}:{previewUrl:u=>u+'/preview'}});
(async()=>{
 const d=new exported.ProgressiveImage();d.source.set('/one');run();assert.equal(images.length,0);assert.equal(d.displaySource(),'/one/preview');
 d.loaded();run();assert.equal(images[0].src,'/one');images[0].onload();assert.equal(d.displaySource(),'/one/preview');
 images[0].resolve();await Promise.resolve();assert.equal(d.displaySource(),'/one');
 d.source.set('/two');run();d.loaded();run();const second=images.at(-1);second.onload();d.source.set('/three');run();second.resolve();await Promise.resolve();assert.equal(d.displaySource(),'/three/preview');assert.equal(second.src,'');
 d.loaded();run();images.at(-1).onload();images.at(-1).reject(Error('decode failed'));await Promise.resolve();await Promise.resolve();assert.equal(d.displaySource(),'/three/preview');
 console.log('PASS: preview first, full image only after decode, cancellation on navigation, preview retained on decode failure');
})().catch(e=>{console.error(e);process.exitCode=1;});
