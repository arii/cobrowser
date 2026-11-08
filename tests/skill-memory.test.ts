import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachSkillMemory } from '../apps/extension/skill-memory.js';
test('stores intent, reusable instructions and only matching demonstration screenshots',()=>{
  const event={id:'event',sessionId:'session',tabId:1,origin:'https://example.test',at:'2026-11-07T00:00:10Z'};
  const frame={...event,image:{mediaType:'image/jpeg',base64:'masked'}};
  const skill=attachSkillMemory({evidenceIds:['event'],outcome:'Preview report',context:{intent:'Prepare a report'},steps:[{kind:'change',target:{label:'Team'},parameter:'input_1'},{kind:'click',target:{label:'Preview report'}}]},[event],{frames:[{...frame,tabId:2},frame]});
  assert.equal(skill.instruction,'Prepare a report');
  assert.equal(skill.memory?.screenshots.length,1);
  assert.match(skill.memory!.howTo[0],/current instruction/);
  frame.image.base64='changed';assert.equal(skill.memory!.screenshots[0].image.base64,'masked');
});
test('works without captures and excludes stale or unrelated session evidence',()=>{
  const event={id:'event',sessionId:'session',tabId:1,origin:'https://example.test',at:'2026-11-07T00:00:10Z'};
  const skill={evidenceIds:['event'],outcome:'Search',steps:[{kind:'click',target:{label:'Search'}}],instruction:'Find current results'};
  const result=attachSkillMemory(skill,[event],{frames:[{...event,sessionId:'other',image:{mediaType:'image/jpeg',base64:'masked'}},{...event,at:'2026-11-06T00:00:10Z',image:{mediaType:'image/jpeg',base64:'masked'}}]});
  assert.equal(result.memory!.screenshots.length,0);assert.equal(result.instruction,'Find current results');
});

test('requires user intent before saving and uses it instead of inferred intent',async()=>{
  const {confirmSkillIntent}=await import('../apps/extension/skill-memory.js');
  const skill=attachSkillMemory({evidenceIds:[],outcome:'Preview',context:{intent:'Inferred goal'},steps:[]},[]);
  for(const invalid of [undefined,null,'   ',42,'x'.repeat(4001)])assert.throws(()=>confirmSkillIntent(skill,invalid),/Describe what/);
  const saved=confirmSkillIntent(skill,'  Prepare a weekly preview  ');
  assert.equal(saved.instruction,'Prepare a weekly preview');
  assert.equal(saved.memory?.intent,saved.instruction);
  assert.equal(skill.memory?.intent,'Inferred goal');
});
