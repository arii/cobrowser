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
const llamaEnv={HARNESS_CLOUD_ENABLED:'1',SUBQ_API_KEY:'synthetic-subq-key',LLAMA_SCHEMA:'openai-chat',LLAMA_ENDPOINT:'https://llama.example/v1/chat/completions',LLAMA_MODEL:'meta-llama/vision-revision',LLAMA_API_KEY:'synthetic-meta-key'};
const completion=(value:unknown)=>({model:llamaEnv.LLAMA_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:30,completion_tokens:20,total_tokens:50}});
test('Meta Llama is the default context provider with separate credentials and strict structured output',async()=>{
  const saved=globalThis.fetch;let sent:any;
  globalThis.fetch=async(url,options)=>{
    sent={url:String(url),headers:options!.headers,body:JSON.parse(options!.body as string)};
    return Response.json(completion(decision));
  };
  try {
    const providers=liveContextProviders(llamaEnv);
    assert.equal(providers.contextModel,llamaEnv.LLAMA_MODEL);
    const result=await providers.context(input);
    assert.equal(result.value.intent,decision.intent);
    assert.equal(sent.url,llamaEnv.LLAMA_ENDPOINT);
    assert.equal(sent.headers.Authorization,'Bearer synthetic-meta-key');
    assert.equal(sent.body.response_format.json_schema.strict,true);
    assert(!JSON.stringify(result).includes('synthetic-meta-key'));
    for(const name of ['LLAMA_ENDPOINT','LLAMA_MODEL','LLAMA_API_KEY','LLAMA_SCHEMA'])assert.throws(()=>liveContextProviders({...llamaEnv,[name]:''}),new RegExp(`missing-${name}`));
    assert.throws(()=>liveContextProviders({...llamaEnv,LLAMA_MODEL:'other-model'}),/not-declared-llama/);
    assert.throws(()=>liveContextProviders({...llamaEnv,LLAMA_SCHEMA:'other'}),/unsupported-LLAMA_SCHEMA/);
    for(const endpoint of ['http://llama.example','https://user:secret@llama.example','invalid'])assert.throws(()=>liveContextProviders({...llamaEnv,LLAMA_ENDPOINT:endpoint}),/unsafe-LLAMA_ENDPOINT/);
    assert.throws(()=>liveContextProviders({...llamaEnv,CONTEXT_PROVIDER:'gemini'}),/invalid-CONTEXT_PROVIDER/);
    for (const response of [
      {...completion(decision),model:'other-llama'},
      {...completion(decision),choices:[{finish_reason:'length',message:{content:JSON.stringify(decision)}}]},
      {...completion(decision),choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision),refusal:'Declined'}}]},
    ]) {globalThis.fetch=async()=>Response.json(response);await assert.rejects(providers.context(input),/invalid-envelope/);}
    globalThis.fetch=async()=>Response.json(completion({intent:'invalid'}));
    await assert.rejects(providers.context(input),/invalid-output/);
    globalThis.fetch=async()=>Response.json({...completion(decision),choices:[{finish_reason:'stop',message:{content:'not JSON'}}]});
    await assert.rejects(providers.context(input),/invalid-content/);
  } finally {globalThis.fetch=saved;}
});

test('Meta Llama summarizes chronological screenshots separately from rolling context and rejects incomplete captions',async()=>{
  const saved=globalThis.fetch;const requests:any[]=[];let finish='stop';
  const summary={summary:'A report form is visible.',changes:['The result panel appeared.'],confidence:.8};
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options!.body as string);requests.push(body);
    const value=Array.isArray(body.messages[1].content)?summary:decision;
    return Response.json({...completion(value),choices:[{finish_reason:finish,message:{content:JSON.stringify(value),reasoning_content:'private reasoning excluded'}}]});
  };
  try{
    const providers=liveContextProviders(llamaEnv);
    const frame={at:event.at,origin:event.origin,tabId:1,sessionId:event.sessionId,image:{mediaType:'image/png' as const,base64:'iVBORw0KGgo='}};
    const caption=await providers.vision!([frame,frame]);assert.deepEqual(caption.value,summary);
    const parts=requests[0].messages[1].content;
    assert.equal(parts.filter((part:any)=>part.type==='image_url').length,2);
    assert.equal(parts[0].text,`Screenshot captured at ${frame.at}`);
    assert.equal(parts[1].image_url.url,'data:image/png;base64,iVBORw0KGgo=');
    assert(!JSON.stringify(caption).includes('private reasoning excluded'));
    await providers.context(input);assert(!JSON.stringify(requests[1]).includes('iVBORw0KGgo='));
    finish='length';await assert.rejects(providers.vision!([frame]),/invalid-envelope/);
    finish='stop';globalThis.fetch=async()=>Response.json(completion({summary:123}));
    await assert.rejects(providers.vision!([frame]),/invalid-output/);
  }finally{globalThis.fetch=saved;}
});
