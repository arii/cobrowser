import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverNetworking, guestKey, matchGuest, networkingBinding, networkingIssues, profileUrl } from '../apps/extension/networking.js';
const at='2026-11-07T20:00:00Z';
const events=[{id:'guest',sessionId:'s',at,tabId:1,origin:'https://event.test',provenance:'human',kind:'page-visible'},
  {id:'connect',sessionId:'s',at,tabId:2,origin:'https://www.linkedin.com',provenance:'human',kind:'click',target:{label:'Connect'}},
  {id:'send',sessionId:'s',at,tabId:2,origin:'https://www.linkedin.com',provenance:'human',kind:'click',target:{label:'Send without a note'},effect:'content-changed'}];
const starts={'s:1:https://event.test':'https://event.test/guests'};
const tabs=[{id:1,url:'https://event.test/guests',title:'Hackathon guests'}];
test('learns one bounded cross-tab networking recipe without recorded field values',()=>{
  const [skill]=discoverNetworking(events,starts,tabs);assert.ok(skill);assert.deepEqual(networkingIssues(skill),[]);assert.equal(skill.sites[0].url,starts['s:1:https://event.test']);assert.deepEqual(skill.evidenceIds,['guest','connect','send']);assert.equal(skill.steps.length,0);
});
test('does not learn from agent actions, unobserved sends, another session or unrelated pages',()=>{
  for(const changed of [events.map(e=>({...e,provenance:'agent'})),events.map(e=>({...e,effect:undefined})),events.map(e=>({...e,sessionId:e.id==='guest'?'other':'s'})),events.filter(e=>e.id!=='connect')])assert.equal(discoverNetworking(changed,starts,tabs).length,0);
  assert.equal(discoverNetworking(events,starts,[{id:1,url:'https://event.test/',title:'Home'}]).length,0);
  assert.equal(discoverNetworking(events,{},tabs).length,0);
});
test('requires unique full name plus affiliation, or an exact source profile link',()=>{
  const guest={name:'Maya Chen',company:'Acme'},one={name:'Maya Chen',detail:'Engineer at Acme',url:'https://www.linkedin.com/in/maya'};
  assert.equal(matchGuest(guest,[one])?.url,one.url);
  assert.equal(matchGuest({...guest,company:''},[one]),null);
  assert.equal(matchGuest(guest,[one,{...one,url:'https://www.linkedin.com/in/other'}]),null);
  assert.equal(matchGuest(guest,[{...one,detail:'Acmeology'}]),null);
  assert.equal(matchGuest(guest,[{...one,name:'Other Person'}]),null);
  assert.equal(matchGuest({...guest,profileUrl:one.url},[one,{...one,url:'https://www.linkedin.com/in/other'}])?.url,one.url);
  assert.equal(matchGuest(guest,[one,one])?.url,one.url);
});
test('profile URLs are restricted and recipe review binds execution configuration',async()=>{
  for(const url of ['https://evil.test/in/a','https://www.linkedin.com.evil.test/in/a','javascript:alert(1)','https://www.linkedin.com/search','http://www.linkedin.com/in/a','https://x@www.linkedin.com/in/a'])assert.equal(profileUrl(url),null);
  assert.equal(profileUrl('https://www.linkedin.com/in/a/?tracking=secret'),'https://www.linkedin.com/in/a');
  const [skill]=discoverNetworking(events,starts,tabs),hash=await networkingBinding(skill);
  assert.notEqual(await networkingBinding({...skill,instruction:'Different task'}),hash);
  assert.notEqual(await networkingBinding({...skill,networking:{version:1,maxGuests:100}}),hash);
  assert.equal(await networkingBinding({...skill,title:'Renamed'}),hash);
  assert.equal(guestKey({name:' Maya  Chen ',company:'ACME'}),guestKey({name:'maya chen',company:'Acme'}));
});
