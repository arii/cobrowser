import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error Extension JavaScript is exercised directly.
import { requestInputWithRetries, exactInputValue } from '../apps/extension/skills.js';
import { providerFailureCode } from '../packages/model-adapters/context.js';
const message={seq:1};
const success={kind:'skill-input-result',seq:1};
test('transient planning outages have bounded retries and visible attempt status, then recover',async()=>{
  let calls=0;const statuses:unknown[]=[],delays:number[]=[];
  const response=await requestInputWithRetries(message,{send:async()=>++calls<3?{code:'context-provider-network-or-timeout'}:success,onRetry:async(value:unknown)=>statuses.push(value),wait:async(ms:number)=>delays.push(ms)});
  assert.equal(response,success);assert.equal(calls,3);assert.deepEqual(delays,[500,1000]);
  assert.deepEqual(statuses,[{attempt:2,total:3,code:'context-provider-network-or-timeout'},{attempt:3,total:3,code:'context-provider-network-or-timeout'}]);
});
test('exhausted and permanent provider failures stay distinct from missing user information',async()=>{
  for(const [code,expected] of [['context-provider-network-or-timeout',3],['context-provider-http-429',3],['context-provider-http-503',3],['context-provider-http-401',1],['skill-provider-configuration-unavailable',1]] as const){
    let calls=0;
    await assert.rejects(requestInputWithRetries(message,{send:async()=>{calls++;return {code};},onRetry:async()=>{},wait:async()=>{}}),(error:any)=>error.providerFailure===true && error.message===code && error.attempts===expected);
    assert.equal(calls,expected);
  }
  assert.equal(providerFailureCode(new Error('context-provider-http-429')),'context-provider-http-429');
  assert.equal(providerFailureCode(new Error('secret credential message')),'skill-input-provider-unavailable');
});
test('stopping during retry prevents another provider call',async()=>{
  let calls=0,stopped=false;
  await assert.rejects(requestInputWithRetries(message,{send:async()=>{calls++;return {code:'context-provider-network-or-timeout'};},onRetry:async()=>{},wait:async()=>{stopped=true;},check:async()=>{if(stopped)throw new Error('Run stopped.');}}),/Run stopped/);
  assert.equal(calls,1);
});
test('direct values preserve exact text and validate selects without model access',()=>{
  assert.equal(exactInputValue('  Exact value  ',{tag:'INPUT'}),'  Exact value  ');
  assert.equal(exactInputValue('',{tag:'INPUT'}),'');
  assert.equal(exactInputValue('Blue',{tag:'SELECT',options:['Red','Blue']}),'Blue');
  assert.throws(()=>exactInputValue('blue',{tag:'SELECT',options:['Red','Blue']}),/exact available option/);
  assert.throws(()=>exactInputValue('x'.repeat(2001),{tag:'INPUT'}),/2,000/);
});

test('fixture CSV verifier compares complete contents with explicit requested parameters',async()=>{
  // @ts-expect-error Extension JavaScript is exercised directly.
  const {expectedFixtureCsv}=await import('../apps/extension/export-verification.js');
  assert.equal(expectedFixtureCsv({Team:'blue','Start inclusive':'2026-10-26','End exclusive':'2026-10-28'}),'team,date,value\nblue,2026-10-26,226\nblue,2026-10-27,227\n');
  assert.equal(expectedFixtureCsv({Team:'blue'}),null);
  assert.equal(expectedFixtureCsv({Team:'blue','Start inclusive':'2026-11-02','End exclusive':'2026-10-26'}),null);
});

test('malformed model decisions pause as invalid output instead of page problems',async()=>{
  let calls=0;
  await assert.rejects(requestInputWithRetries({seq:1,target:{tag:'SELECT'},options:['blue'],pages:[{siteId:'main'}]},{send:async()=>{calls++;return {...success,decision:{status:'resolved',value:'invented',sourceSiteIds:[]}};},onRetry:async()=>{}}),(error:any)=>error.issueKind==='invalid-output' && error.attempts===1);
  assert.equal(calls,1);
});
