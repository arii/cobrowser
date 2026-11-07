import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Legacy extension JavaScript has no declaration file.
import { discoverSkills, skillIssues, defaultSkillName } from '../apps/extension/skill-learning.js';
const target=(label:string)=>({tag:'BUTTON',label,type:'button'});
function examples(labels=['Open report','Preview report']){
  return Array.from({length:3},(_,session)=>labels.map((label,index)=>({id:`${session}-${index}`,sessionId:`session-${session}`,tabId:1,origin:'https://example.test',at:new Date(Date.UTC(2026,10,7,0,session,index)).toISOString(),provenance:'human',kind:'click',tag:'BUTTON',target:target(label),...(index===labels.length-1?{effect:'content-changed'}:{})}))).flat();
}
test('suggests complete repeated workflows with observed outcomes and useful default names',()=>{
  assert.equal(discoverSkills(examples().slice(0,4)).length,0);
  const events=examples();events.splice(1,0,{...events[0],kind:'pointer',id:'noise'});
  const [skill]=discoverSkills(events);
  assert.equal(skill.exampleCount,3);assert.equal(skill.steps.length,2);assert.equal(skill.blockers.length,0);
  assert.equal(skill.evidenceIds.includes('noise'),false);assert.equal(skill.title,'Preview report');
  assert.equal(defaultSkillName([{target:{label:'Export'}}]),'Export report');
});
test('rejects no-op clicks, missing targets, incomplete tasks, unsupported steps and empty workflows',()=>{
  assert.deepEqual(discoverSkills(examples().map(({effect:_effect,...event})=>event)),[]);
  assert.deepEqual(discoverSkills(examples(['Open menu','Close menu'])),[]);
  assert.deepEqual(discoverSkills(examples().map(({target:_target,...event})=>event)),[]);
  assert.deepEqual(discoverSkills(examples(['Delete report','Preview report'])),[]);
  assert.ok(skillIssues({steps:[]}).length);
  assert.ok(skillIssues({steps:[{kind:'click',target:{tag:'BUTTON',label:' ',type:''}}]}).length);
  const unsupported=examples(['Open report','Unsupported key','Preview report']).map(event=>event.target.label==='Unsupported key'?{...event,kind:'key'}:event);
  assert.deepEqual(discoverSkills(unsupported),[]);
});
test('does not generate sliding fragments or multiple suggestions for the same result',()=>{
  const events=examples(['Open report','Choose layout','Preview report']);
  assert.equal(discoverSkills(events).length,1);assert.equal(discoverSkills(events)[0].steps.length,3);
  const variants=examples(['Choose layout','Preview report']).map(event=>({...event,id:`variant-${event.id}`,sessionId:`variant-${event.sessionId}`}));
  assert.equal(discoverSkills([...events,...variants]).length,1);
  assert.equal(discoverSkills([...events,...events.map(event=>({...event,origin:'https://different.test',id:`other-${event.id}`}))]).length,2);
});
test('caps suggestions at three concrete outcomes',()=>{
  const events=Array.from({length:6},(_,index)=>examples(['Open report',`Preview report ${index}`]).map(event=>({...event,id:`${index}-${event.id}`,sessionId:`${index}-${event.sessionId}`}))).flat();
  assert.equal(discoverSkills(events).length,3);
});
test('does not combine tabs or scopes or use guesses as actions or default names',()=>{
  const split=discoverSkills(examples().map((event,index)=>({...event,tabId:index%2})));
  assert.equal(split[0].steps.length,1);assert.equal(split[0].steps[0].target.label,'Preview report');
  const [skill]=discoverSkills(examples(),{assumptions:[{decision:{intent:'Maybe doing something',confidence:.9,status:'continuing',explanation:'Observed controls.',evidenceIds:['0-0'],nextAction:{description:'Delete report'}}}]});
  assert.equal(skill.title,'Preview report');assert.equal(skill.context.confidence,.9);assert.equal(skill.steps.length,2);
});
