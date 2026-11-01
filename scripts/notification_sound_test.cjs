// Verify sound lifecycle without requiring speakers or browser autoplay permissions.
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createRequire} = require('node:module');
const vm = require('node:vm');
const requireFront = createRequire(require('node:path').resolve('front/package.json'));
const ts = requireFront('typescript');
const source = ts.transpileModule(readFileSync('front/src/app/notification-sound.service.ts', 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true},
}).outputText;
function setup(saved = null) {
  const events = {}, calls = [], storage = new Map(saved ? [['chat-sound',saved]] : []);
  let audio;
  class Audio {
    constructor() { audio=this; this.muted=false; this.block=false; this.defer=null; }
    play() { calls.push({muted:this.muted}); return this.defer || (this.block ? Promise.reject(Error('NotAllowedError')) : Promise.resolve()); }
    pause() {}
  }
  const exports = {};
  vm.runInNewContext(source, {exports, Audio, Date,
    require:()=>({Injectable:()=>()=>{}, signal:value=>{const fn=()=>value;fn.set=v=>value=v;return fn;}}),
    document:{addEventListener:(event,fn)=>events[event]=fn},
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
  });
  return {service:new exports.NotificationSound(), audio, events, calls, storage};
}
const flush = ()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  const t=setup();
  t.events.touchend({target:{closest:()=>null}});await flush();
  assert.equal(t.calls[0].muted,true);assert.equal(t.audio.muted,false);assert.equal(t.service.ready(),true);
  await t.service.play();assert.equal(t.calls.at(-1).muted,false);assert.equal(t.audio.volume,1);
  await t.service.toggle();assert.equal(t.storage.get('chat-sound'),'off');
  const count=t.calls.length;await t.service.play(true);assert.equal(t.calls.length,count);
  t.audio.block=true;await t.service.toggle();assert.equal(t.service.ready(),false);
  t.audio.block=false;await t.service.toggle();assert.equal(t.service.ready(),true);assert.equal(t.storage.get('chat-sound'),'on');
  const disabled=setup('off');disabled.events.click({target:{closest:()=>null}});assert.equal(disabled.calls.length,0);
  const pending=setup();let release;pending.audio.defer=new Promise(resolve=>release=resolve);
  pending.events.click({target:{closest:()=>null}});await pending.service.play();assert.equal(pending.calls.length,1);
  pending.audio.defer=null;release();await flush();assert.equal(pending.calls.length,2);assert.equal(pending.calls[1].muted,false);
  console.log('PASS: touch activation, audible playback, blocked playback retry, mute persistence, incoming message during activation');
})().catch(error=>{console.error(error);process.exitCode=1;});
