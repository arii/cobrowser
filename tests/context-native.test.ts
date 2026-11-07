import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeFrame, nativeDecoder } from '../packages/context-brain/native-protocol.js';
import { nativeBrainHandler } from '../packages/context-brain/native-handler.js';
import { syntheticContextProviders } from '../packages/context-brain/replay.js';
const now=()=>new Date().toISOString();
const dom=()=>({documentId:'document-1',at:now(),origin:'http://example.test',title:'Reports',headings:['Reports'],excerpt:'Report settings',viewport:{width:900,height:600,scrollX:0,scrollY:0},nodes:[{tag:'BUTTON',role:'',text:'Export'}]});
function batch(){
  const snapshot=dom();
  return {v:1,kind:'observe',seq:1,sessionId:'session-1',enabled:true,tabs:[{tabId:1,origin:snapshot.origin,title:'Reports',headings:['Reports'],excerpt:'Report settings',active:true,observedAt:now(),readStatus:'ready'}],events:[],observation:{id:'interval-1',tabId:1,at:now(),reason:'interval',before:snapshot,after:{...snapshot,excerpt:'Export completed'},motion:{samples:[{at:now(),x:.2,y:.3}],distance:.2,clicks:1,scrolls:0,keys:0},imageHashes:['synthetic-image-hash'],visualSummary:null,frames:[{image:{mediaType:'image/png',base64:'iVBORw0KGgo='},at:now(),sessionId:'session-1',origin:snapshot.origin,tabId:1}]}};
}
test('native framing handles fragmentation and rejects oversized messages',()=>{
  const values:unknown[]=[];let errors=0;const decode=nativeDecoder(value=>values.push(value),()=>errors++);
  const a=nativeFrame({v:1,message:'hello'});decode(a.subarray(0,2));decode(a.subarray(2));assert.equal(values.length,1);
  decode(Buffer.from([255,255,255,255]));assert.equal(errors,1);decode(a);assert.equal(values.length,1);
});
test('native intervals carry images, DOM pairs and movement into a visible assumption without retaining pixels',async()=>{
  const providers=syntheticContextProviders();let visionCalls=0,contextCalls=0;
  const vision=providers.vision!,context=providers.context;
  providers.vision=async frames=>{visionCalls++;return vision(frames);};
  providers.context=async input=>{contextCalls++;assert(input.observation?.before);assert.equal(input.observation.after.excerpt,'Export completed');assert.equal(input.observation.motion.clicks,1);return context(input);};
  const progress:unknown[]=[];const handle=nativeBrainHandler(providers,value=>progress.push(value));
  const first=await handle(batch());assert.equal(first.state.source,'main-chrome-native');assert.equal(first.state.assumptions.length,1);assert.equal(visionCalls,1);assert.equal(contextCalls,1);
  assert(first.state.assumptions[0].observation?.visualSummary?.summary.includes('Synthetic'));
  assert(!JSON.stringify(first.state).includes('iVBORw0KGgo='));assert(progress.length>=2);
  await handle({...batch(),seq:2});assert.equal(visionCalls,1);assert.equal(contextCalls,1);
  const cleared=await handle({...batch(),seq:3,sessionId:null,enabled:false,tabs:[],events:[],observation:undefined});assert.equal(cleared.state.assumptions.length,0);
});
test('native image evidence with another session or tab is rejected before any model call',async()=>{
  const handle=nativeBrainHandler(syntheticContextProviders());const message=batch();message.observation.frames[0].sessionId='other-session';
  await assert.rejects(handle(message),/observation-scope-invalid/);
  message.observation.frames[0].sessionId='session-1';message.observation.frames[0].tabId=999;
  await assert.rejects(handle(message),/observation-scope-invalid/);
});
