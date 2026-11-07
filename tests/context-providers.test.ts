import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveContextProviders } from '../packages/model-adapters/context.js';

const env={HARNESS_CLOUD_ENABLED:'1',SUBQ_API_KEY:'synthetic-subq-key',CONTEXT_PROVIDER:'subq'};
const event={id:'event-a',at:new Date().toISOString(),sessionId:'session-a',origin:'http://127.0.0.1:3210',tabId:1,kind:'change' as const,tag:'INPUT' as const,provenance:'human' as const};
const input={previous:null,events:[event],signals:null};
const decision={intent:'Edit report',summary:'Field change observed; exact goal unknown',status:'uncertain',confidence:.4,evidenceIds:['event-a'],explanation:'Only metadata is available',nextAction:{kind:'unknown',description:'Not enough evidence',targetTabId:null,confidence:0,evidenceIds:['event-a']}};
const snapResponse={model:'subq-snap-1.1',answers:{relation:{type:'choice',choice:'uncertain',probabilities:{same:0,different:0,uncertain:1},confidence:1},scene:{type:'choice',choice:'report_export',probabilities:{report_export:1,search:0,editing:0,communication:0,checkout:0,settings:0,other:0,unknown:0},confidence:1},progress:{type:'choice',choice:'form_entry',probabilities:{form_entry:1,result_ready:0,download_confirmation:0,error:0,unknown:0},confidence:1},changed:{type:'noul',noul:.5},action:{type:'choice',choice:'editing',probabilities:{editing:1,navigation:0,submission:0,inspection:0,uncertain:0},confidence:1}},usage:{input_tokens:40,output_tokens:0}};
test('live split uses correct endpoints, isolates image data to Snap, authenticates with headers and validates structured decisions',async()=>{
  const saved=globalThis.fetch;const requests:{url:string;body:any;headers:any}[]=[];
  globalThis.fetch=async(url,options)=>{
    requests.push({url:String(url),body:JSON.parse(options!.body as string),headers:options!.headers});
    return Response.json(String(url).endsWith('/systemone')?snapResponse:{model:'subq-preview',choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision)}}],usage:{prompt_tokens:40,completion_tokens:20,total_tokens:60}});
  };
  try {
    const providers=liveContextProviders(env);
    const snap=await providers.snap({previous:null,events:[event],images:[{mediaType:'image/png',base64:'iVBORw0KGgo='}],frameTimes:[event.at]});
    const context=await providers.context({...input,signals:snap.value});
    assert.equal(context.value.intent,'Edit report');assert.equal(context.mode,'live');
    assert(requests[0].url.endsWith('/v1/systemone'));assert(requests[1].url==='https://api.subq.ai/v1/chat/completions');
    assert.equal(requests[1].headers.Authorization,'Bearer synthetic-subq-key');
    assert(!JSON.stringify(requests[1].body).includes('iVBORw0KGgo='));
    assert(requests[1].body.response_format.json_schema.strict);
    assert.equal(snap.value.visualTask,'report_export');
    assert.equal(snap.value.screenChanged,null); // One frame cannot establish change.
    assert.equal(requests[1].body.model,'subq-preview');
    assert.equal(requests[1].body.store,false);
    assert.equal(requests[1].body.reasoning_effort,'none');
    assert(!requests.some(request=>request.url.includes('google')));
    assert(!JSON.stringify(context).includes('synthetic-subq-key'));
  } finally {globalThis.fetch=saved;}
});
test('missing configuration never silently selects another provider or a replay response',()=>{
  assert.throws(()=>liveContextProviders({}),/cloud-processing-disabled/);
  assert.throws(()=>liveContextProviders({...env,SUBQ_API_KEY:''}),/missing-SUBQ/);
  assert.equal(liveContextProviders(env).mode,'live');
});
test('malformed, incomplete and error responses fail without logging provider content',async()=>{
  const saved=globalThis.fetch;
  try {
    const providers=liveContextProviders(env);
    globalThis.fetch=async()=>new Response('secret body',{status:429});
    await assert.rejects(providers.context(input),/^Error: context-provider-http-429$/);
    globalThis.fetch=async()=>Response.json({...snapResponse,answers:{...snapResponse.answers,relation:{type:'choice',choice:'invented',probabilities:{invented:1},confidence:1}}});
    await assert.rejects(providers.snap({previous:null,events:[event],images:[],frameTimes:[]}),/choice-mismatch/);
    globalThis.fetch=async()=>Response.json({model:'subq-preview',choices:[{finish_reason:'length',message:{content:JSON.stringify(decision)}}],usage:{}});
    await assert.rejects(providers.context(input),/invalid-envelope/);
    for (const response of [
      {model:'unexpected-model',choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision)}}],usage:{}},
      {model:'subq-preview',choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision),refusal:'Declined'}}],usage:{}},
    ]) {globalThis.fetch=async()=>Response.json(response);await assert.rejects(providers.context(input),/invalid-envelope/);}
  } finally {globalThis.fetch=saved;}
});
test('Gemini is the default context provider and uses a separate key with structured output',async()=>{
  const saved=globalThis.fetch;
  const geminiEnv={HARNESS_CLOUD_ENABLED:'1',SUBQ_API_KEY:'synthetic-subq-key',GEMINI_API_KEY:'synthetic-google-key',GEMINI_MODEL:'gemini-3.8-flash'};
  let sent:any;
  globalThis.fetch=async(url,options)=>{
    sent={url:String(url),headers:options!.headers,body:JSON.parse(options!.body as string)};
    return Response.json({modelVersion:'gemini-3.8-flash',candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'not an observable conclusion'},{text:JSON.stringify(decision)}]}}],usageMetadata:{promptTokenCount:30,candidatesTokenCount:20,totalTokenCount:50}});
  };
  try {
    const providers=liveContextProviders(geminiEnv);
    assert.equal(providers.contextModel,'gemini-3.8-flash');
    const result=await providers.context(input);
    assert.equal(result.value.intent,decision.intent);
    assert.equal(sent.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(sent.headers['x-goog-api-key'],'synthetic-google-key');
    assert(sent.body.generationConfig.responseJsonSchema);
    assert(!JSON.stringify(result).includes('synthetic-google-key'));
    assert(!JSON.stringify(result).includes('not an observable conclusion'));
    assert.throws(()=>liveContextProviders({...geminiEnv,GEMINI_API_KEY:''}),/missing-GEMINI_API_KEY/);
    assert.throws(()=>liveContextProviders({...geminiEnv,GEMINI_MODEL:'other-model'}),/must-name-a-flash-model/);
    assert.throws(()=>liveContextProviders({...geminiEnv,CONTEXT_PROVIDER:'other'}),/invalid-CONTEXT_PROVIDER/);
    for (const response of [
      {modelVersion:'gemini-3.8-flash',candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:JSON.stringify(decision)}]}}]},
      {modelVersion:'gemini-other-flash',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(decision)}]}}]},
    ]) {globalThis.fetch=async()=>Response.json(response);await assert.rejects(providers.context(input),/invalid-envelope/);}
  } finally {globalThis.fetch=saved;}
});
