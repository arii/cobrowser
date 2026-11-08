import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillInputHandler, validateInputDecision, type SkillInputRequest } from '../packages/skill-runtime/input-planner.js';
// @ts-expect-error Extension JavaScript is exercised directly.
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
