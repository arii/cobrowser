import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startFixture } from '../apps/fixture-site/server.js';
import { HarnessStore } from '../packages/storage/src/index.js';
import { SkillRegistry } from '../services/registry/index.js';
import { executeProcedure } from '../packages/skill-runtime/index.js';
import { evaluateReportingSuite, type ReportingObservation } from '../services/verifier/reporting.js';
import { previousWeek, type Task } from '../services/verifier/oracle.js';
import { contentHash, newId, seal, SkillRevision, TaskContract, VerificationSuite } from '../packages/contracts/src/index.js';
import { synthetic } from '../tests/fixtures/synthetic.js';

const root=await mkdtemp(join(tmpdir(),'cobrowser-promotion-'));
const correct=await startFixture(), wrong=await startFixture(true);
const browser=await chromium.launch();
const store=await HarnessStore.openUnencrypted(root);
const task:Task={team:'red',asOf:'2026-11-07T20:00:00Z',timezone:'America/Los_Angeles'};
const data=synthetic(new Date(Date.now()-1000).toISOString());
const {contentHash:_contractHash,...contractBody}=data.contract;
const contract=TaskContract.parse(seal({...contractBody,allowedOrigins:[correct.origin,wrong.origin],allowedEffects:['navigate','input','download']}));
const suite=VerificationSuite.parse(seal({schemaVersion:1,id:newId(),version:1,contractHash:contract.contentHash,frozenAt:new Date().toISOString(),scenarioSeeds:Array.from({length:10},(_,i)=>i+1),mutations:['none'],oracleIds:['independent-csv-v1'],requiredAssertions:['csv-exact-rows','permitted-effects','scenario-coverage']}));
const authority={keyId:'ephemeral-synthetic-supervisor',key:randomBytes(32),environmentHash:contentHash({browser:browser.version(),scope:'local-fixture-no-container'}),runtimeHash:contentHash({runtime:await readFile('packages/skill-runtime/index.ts','utf8'),adapter:await readFile('scripts/verify-promotion.ts','utf8')})};
const reports=[];
const registry=new SkillRegistry(store,authority);
try{
  store.putFrame(data.frame,data.bytes);store.putEvent(data.event);store.putDemonstration(data.demonstration);store.putTaskContract(contract);store.putVerificationSuite(suite);
  function candidate(parentHash:string|null, mutation='none'){
    const {contentHash:_hash,...body}=data.revision;
    const revision=SkillRevision.parse(seal({...body,id:newId(),parentHash,contractHash:contract.contentHash,createdAt:new Date().toISOString(),requestedCapabilities:['observe-approved-tab','input-assigned-tab','download-approved-artifact'],procedure:[{kind:'type',target:'Team',parameter:mutation==='wrong-team'?'wrongTeam':'team'},{kind:'type',target:'Start inclusive',parameter:'start'},{kind:'type',target:'End exclusive',parameter:'end'},{kind:'download',target:'Export CSV'}]}));
    store.putRevision(revision);store.transitionRevision(revision.id,'draft','queued',0);store.transitionRevision(revision.id,'queued','verifying',1);return revision;
  }
  async function run(revision:SkillRevision, fixture=correct, count=10,approved=false){
    const observations:ReportingObservation[]=[];
    for(let seed=1;seed<=count;seed++){
      const context=await browser.newContext({acceptDownloads:true,timezoneId:task.timezone});
      try{
        await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
        const page=await context.newPage();await page.goto(fixture.origin);
        let bytes:Buffer|undefined;
        const startAudit=fixture.audit.length;
        const effects:ReportingObservation['effects']=[{origin:fixture.origin,kind:'navigate'}];
        const range=previousWeek(task);
        const parameters={team:task.team,wrongTeam:'blue',start:range.start,end:range.end};
        const transport: Parameters<typeof executeProcedure>[3]={
          observe:async()=>({origin:new URL(page.url()).origin}),
          perform:async(step,value)=>{
            if(step.kind==='type'){
              const control=page.getByLabel(step.target,{exact:true});const box=await control.boundingBox();if(!box)throw new Error('Control missing');
              await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
              const tag=await control.evaluate(element=>element.tagName);
              if(tag==='SELECT'){await page.keyboard.press('Escape');await page.keyboard.press(value==='blue'?'b':'r');await page.keyboard.press('Tab');assert.equal(await control.inputValue(),value);}
              else{await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(value!);await page.keyboard.press('Tab');}
              effects.push({origin:fixture.origin,kind:'input'});
            }else if(step.kind==='download'){
              const control=page.getByRole('button',{name:step.target,exact:true});const box=await control.boundingBox();if(!box)throw new Error('Export missing');
              const downloading=page.waitForEvent('download',{timeout:10000});await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
              const download=await downloading,stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));bytes=Buffer.concat(chunks);
              effects.push({origin:fixture.origin,kind:'download'});
            }else throw new Error('Unsupported fixture transport step');
          },detach:async()=>{await page.close();},
        };
        const result=approved?await registry.execute(revision.skillId,suite.id,parameters,transport,{userConfirmed:true}):await executeProcedure(revision,contract,parameters,transport,{authorize:()=>true});
        assert.equal(result.status,'completed');
        observations.push({seed,mutation:'none',task,bytes,effects,exportAudit:fixture.audit.slice(startAudit)});
      }finally{await context.close();}
    }
    const report=evaluateReportingSuite(revision,contract,suite,observations,authority);
    return report;
  }
  function apply(report:ReturnType<typeof evaluateReportingSuite>,revision:SkillRevision,activeGeneration:number){reports.push(report);return store.applyVerification(report,{revisionId:revision.id,suiteId:suite.id,revisionGeneration:2,activeGeneration,userConfirmed:true},authority);}
  const v1=candidate(null);assert.equal(apply(await run(v1),v1,0).revision?.id,v1.id);
  const liveExecutionReport=await run(v1,correct,10,true);reports.push(liveExecutionReport);assert.equal(liveExecutionReport.verdict,'approved');
  console.log('PASS: v1 verified and approved; 10/10 approved browser executions passed');
  const v2=candidate(v1.contentHash);assert.equal(apply(await run(v2,wrong,1),v2,1).revision?.id,v1.id);assert.equal(store.getRevision(v2.id)?.state,'blocked');
  console.log('PASS: wrong-week CSV behind success toast blocked; v1 remains active');
  const badTeam=candidate(v1.contentHash,'wrong-team');assert.equal(apply(await run(badTeam,correct,1),badTeam,1).revision?.id,v1.id);assert.equal(store.getRevision(badTeam.id)?.state,'blocked');
  console.log('PASS: wrong-team candidate blocked; v1 remains active');
  const v3=candidate(v1.contentHash);assert.equal(apply(await run(v3),v3,1).revision?.id,v3.id);
  const regression=await run(v3,wrong,1);reports.push(regression);
  assert.equal(store.quarantineAndRollback(regression,{revisionId:v3.id,suiteId:suite.id,activeGeneration:2},authority).revision?.id,v1.id);
  console.log('PASS: corrected v3 approved 10/10; subsequent trusted regression rolls back to v1');
  await mkdir('.local/evidence',{recursive:true});
  await writeFile('.local/evidence/promotion.json',JSON.stringify({mode:'live-browser-synthetic-fixture',generation:'hand-authored replay candidate; no live Llama or Snap call',isolation:'same-process supervisor, fresh browser contexts, fixture-only page routing; no hostile-candidate sandbox',reports,audit:store.getRegistryAudit(v1.skillId),activeHash:store.getActiveSkill(v1.skillId).revision?.contentHash},null,2));
  console.log('Evidence: .local/evidence/promotion.json');
}finally{store.close();authority.key.fill(0);await browser.close();await correct.close();await wrong.close();await rm(root,{recursive:true,force:true});}
