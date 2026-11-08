import { resolveSkillInput } from '../packages/model-adapters/skill-input.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillInputHandler, validateInputDecision, type SkillInputRequest } from '../packages/skill-runtime/input-planner.js';
import { configureWorkflow, workflowSites } from '../apps/extension/skill-workflow.js';
const input:SkillInputRequest={v:1,kind:'skill-input',seq:1,instruction:'Use the team from the source report.',at:'2026-11-07T23:00:00.000Z',timezone:'America/Los_Angeles',skill:{title:'Report',step:0,total:2},target:{tag:'SELECT',label:'Team',type:''},options:['Red','Blue'],pages:[{siteId:'source',origin:'https://source.test',title:'Source',text:'Team: Blue'}],answers:[]};
const resolved={status:'resolved',value:'Blue',explanation:'The source report specifies Blue.',question:null,sourceSiteIds:['source']};
test('input resolver receives instruction, source data, options and clarification answers',async()=>{
  const handle=skillInputHandler(async request=>{assert.equal(request.instruction,input.instruction);assert.equal(request.pages[0].text,'Team: Blue');return resolved;});
  const result=await handle(input);assert.equal(result.decision.value,'Blue');assert.equal(result.seq,1);
});
test('input decisions reject invented sources, invalid selections and missing clarifications',()=>{
  assert.throws(()=>validateInputDecision({...resolved,sourceSiteIds:['invented']},input),/unknown-source/);
  assert.throws(()=>validateInputDecision({...resolved,value:'Green'},input),/invalid-option/);
  assert.throws(()=>validateInputDecision({...resolved,status:'needs_input',value:null,question:null},input),/invalid-question/);
  assert.equal(validateInputDecision({...resolved,status:'needs_input',value:null,question:'Which team?'},input).status,'needs_input');
});
test('provider failure stays explicit; the resolver does not invent fallback data',async()=>{
  await assert.rejects(skillInputHandler(async()=>{throw new Error('offline');})(input),/offline/);
});
const skill={id:'a',origin:'https://first.test',steps:[{kind:'change',parameter:'input_1',target:{tag:'INPUT',label:'Query',type:'text'}},{kind:'click',parameter:null,target:{tag:'BUTTON',label:'Search',type:'button'}}]};
test('workflows open configured paths and compose steps on multiple websites',()=>{
  const next=configureWorkflow(skill,['https://first.test/reports','https://source.test/data'],'Use the source data.',{...skill,id:'b',origin:'https://second.test'});
  assert.deepEqual(workflowSites(next).map((site:{url:string})=>site.url),['https://first.test/reports','https://source.test/data','https://second.test/']);
  assert.deepEqual(next.steps.map((step:{siteId:string})=>step.siteId),['main','main','part_2','part_2']);
  assert.equal(new Set(next.steps.filter((step:{parameter:string|null})=>step.parameter).map((step:{parameter:string})=>step.parameter)).size,2);
  assert.equal(next.active,false);
});
test('website configurations reject scripts, credentials and removed step sites',()=>{
  for(const url of ['javascript:alert(1)','file:///tmp/private','https://user:secret@example.test'])assert.throws(()=>configureWorkflow(skill,[url]));
  assert.throws(()=>configureWorkflow({...skill,sites:[{id:'main',url:'https://first.test'},{id:'second',url:'https://second.test'}],steps:[{...skill.steps[0],siteId:'second'}]},['https://first.test']),/Keep websites/);
});

test('skill inputs use the configured Meta model by default and reject incomplete output',async()=>{
  const saved=globalThis.fetch;
  const env={HARNESS_CLOUD_ENABLED:'1',LLAMA_SCHEMA:'openai-chat',LLAMA_ENDPOINT:'https://llama.example/v1/chat/completions',LLAMA_MODEL:'meta-llama/vision-revision',LLAMA_API_KEY:'synthetic-meta-key'};
  let finish='stop';
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options!.body as string);
    assert.equal(String(url),env.LLAMA_ENDPOINT);
    assert.equal((options!.headers as Record<string,string>).Authorization,'Bearer synthetic-meta-key');
    assert.equal(body.response_format.json_schema.name,'skill_input');
    assert.equal(body.model,env.LLAMA_MODEL);
    assert.deepEqual(JSON.parse(body.messages[1].content),input);
    return Response.json({model:env.LLAMA_MODEL,choices:[{finish_reason:finish,message:{content:JSON.stringify(resolved)}}]});
  };
  try{
    assert.deepEqual(await resolveSkillInput(input,env),resolved);
    finish='length';await assert.rejects(resolveSkillInput(input,env),/invalid-envelope/);
    await assert.rejects(resolveSkillInput(input,{...env,LLAMA_API_KEY:''}),/missing-LLAMA_API_KEY/);
    await assert.rejects(resolveSkillInput(input,{...env,HARNESS_CLOUD_ENABLED:'0'}),/cloud-processing-disabled/);
  }finally{globalThis.fetch=saved;}
});


test('routine ambiguity gets one autonomous reconsideration with the same starting context',async()=>{
  const saved=globalThis.fetch;
  const env={HARNESS_CLOUD_ENABLED:'1',LLAMA_SCHEMA:'openai-chat',LLAMA_ENDPOINT:'https://llama.example/v1/chat/completions',LLAMA_MODEL:'meta-llama/vision-revision',LLAMA_API_KEY:'synthetic-meta-key'};
  const request={...input,previousInputs:[{label:'Report title',value:'Blue team report'}]};
  let calls=0;
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options!.body as string);calls++;
    assert.deepEqual(JSON.parse(body.messages[1].content),request);
    assert.match(body.messages[0].content,/Choose reasonable, conservative defaults/);
    if(calls===2)assert.match(body.messages[0].content,/Before interrupting the user/);
    return Response.json({model:env.LLAMA_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(calls===1?{...resolved,status:'needs_input',value:null,question:'Which team?'}:resolved)}}]});
  };
  try{assert.equal((await resolveSkillInput(request,env)).value,'Blue');assert.equal(calls,2);}
  finally{globalThis.fetch=saved;}
});

test('unavailable essential information still asks for help after bounded reconsideration',async()=>{
  const saved=globalThis.fetch;
  const env={HARNESS_CLOUD_ENABLED:'1',LLAMA_SCHEMA:'openai-chat',LLAMA_ENDPOINT:'https://llama.example/v1/chat/completions',LLAMA_MODEL:'meta-llama/vision-revision',LLAMA_API_KEY:'synthetic-meta-key'};
  const blocked={...resolved,status:'needs_input',value:null,question:'Which account should receive the report?'};
  let calls=0;
  globalThis.fetch=async()=>{calls++;return Response.json({model:env.LLAMA_MODEL,choices:[{finish_reason:'stop',message:{content:JSON.stringify(blocked)}}]});};
  try{assert.deepEqual(await resolveSkillInput(input,env),blocked);assert.equal(calls,2);}
  finally{globalThis.fetch=saved;}
});
