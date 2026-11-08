import { statSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { startFixture } from '../../apps/fixture-site/server.js';
import { executeProcedure } from '../../packages/skill-runtime/index.js';
import { type SkillRevision, type TaskContract, type VerificationSuite, type VerificationAuthority } from '../../packages/contracts/src/index.js';
import { type GateWorkflow, type ReportingTask } from '../../packages/contracts/src/extension-gate.js';
import { previousWeek } from './oracle.js';
import { evaluateReportingSuite, type ReportingObservation } from './reporting.js';

export function reportingEnvironment(){
  const executable=chromium.executablePath();
  try{const stat=statSync(executable);return {browserExecutable:executable,binaryBytes:stat.size,binaryModifiedAt:stat.mtimeMs};}
  catch{return {browserExecutable:executable,installed:false};}
}
// Execute descriptors rather than a substitute happy-path script. No candidate JS.
async function control(page:Page,target:GateWorkflow['steps'][number]['target']) {
  const locator=target.tag==='BUTTON'?page.getByRole('button',{name:target.label,exact:true}):page.getByLabel(target.label,{exact:true});
  if(await locator.count()!==1)throw new Error('candidate-target-missing-or-ambiguous');
  const metadata=await locator.evaluate(element=>({tag:element.tagName,type:element.getAttribute('type')??(element.tagName==='BUTTON'&&(element as HTMLButtonElement).form?'submit':'')}));
  if(metadata.tag!==target.tag||metadata.type.toLowerCase()!==target.type)throw new Error('candidate-target-descriptor-mismatch');
  const box=await locator.boundingBox();if(!box)throw new Error('candidate-target-invisible');
  return {locator,x:box.x+box.width/2,y:box.y+box.height/2};
}
export async function verifyExtensionWorkflow(workflow:GateWorkflow,task:ReportingTask,revision:SkillRevision,contract:TaskContract,suite:VerificationSuite,authority:VerificationAuthority) {
  const fixture=await startFixture();
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  const observations:ReportingObservation[]=[];
  try{
    browser=await chromium.launch();
    for(const seed of suite.scenarioSeeds){
      const context=await browser.newContext({acceptDownloads:true,timezoneId:task.timezone,serviceWorkers:'block'});
      const effects:ReportingObservation['effects']=[];
      const firstAudit=fixture.audit.length;
      let bytes:Buffer|undefined,unavailable=false;
      try{
        const approvedOrigin=new URL(workflow.sites[0].url).origin;
        await context.route('**/*',async route=>{
          const url=new URL(route.request().url());
          if(url.origin!==approvedOrigin||!['/','/export'].includes(url.pathname)){await route.abort();return;}
          // Supervisor provisions the trusted fixture behind the reviewed origin.
          const response=await route.fetch({url:fixture.origin+url.pathname+url.search});await route.fulfill({response});
        });
        const page=await context.newPage();await page.goto(workflow.sites[0].url);
        effects.push({origin:approvedOrigin,kind:'navigate'});
        const range=previousWeek(task);
        const values:Record<string,string>={Team:task.team,'Start inclusive':range.start,'End exclusive':range.end};
        const parameters=Object.fromEntries(workflow.steps.filter(step=>step.kind==='change').map(step=>[step.parameter!,values[step.target.label]]));
        await executeProcedure(revision,contract,parameters,{
          observe:async()=>({origin:new URL(page.url()).origin}),
          perform:async(step,value)=>{
            if(step.kind!=='type'&&step.kind!=='download')throw new Error('candidate-step-not-supported');
            const descriptor=workflow.steps[Number(step.target)];
            if(!descriptor)throw new Error('candidate-step-missing');
            const point=await control(page,descriptor.target);
            if(step.kind==='type'){
              await page.mouse.click(point.x,point.y);
              if(descriptor.target.tag==='SELECT'){
                await page.keyboard.press('Escape');await page.keyboard.press(value==='blue'?'b':'r');await page.keyboard.press('Tab');
              }else{await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(value!);await page.keyboard.press('Tab');}
              if(await point.locator.inputValue()!==value)throw new Error('candidate-input-not-retained');
              effects.push({origin:approvedOrigin,kind:'input'});
            }else if(step.kind==='download'){
              const pending=page.waitForEvent('download',{timeout:10000});await page.mouse.click(point.x,point.y);
              const download=await pending,stream=await download.createReadStream();const chunks:Buffer[]=[];let length=0;
              for await(const chunk of stream){length+=chunk.length;if(length>contract.limits.maxArtifactBytes)throw new Error('candidate-artifact-too-large');chunks.push(Buffer.from(chunk));}bytes=Buffer.concat(chunks);
              effects.push({origin:approvedOrigin,kind:'download'});
            }else throw new Error('candidate-step-not-supported');
          },detach:async()=>{await page.close();},
        },{authorize:()=>true});
        if(!bytes)bytes=Buffer.from('CANDIDATE_DID_NOT_COMPLETE_REQUIRED_DOWNLOAD');
      }catch(error){
        // Candidate structural failures are deterministic blocks; infrastructure
        // failure/missing download remains inconclusive, never a fabricated pass.
        if(error instanceof Error&&/^candidate-(target|step|input)/.test(error.message))bytes=Buffer.from('CANDIDATE_FAILED_REQUIRED_NORMAL_WORKFLOW');
        else unavailable=true;
      }finally{await context.close();}
      observations.push({seed,mutation:'none',task,bytes,effects,exportAudit:fixture.audit.slice(firstAudit),unavailable});
      if(unavailable)break;
    }
  }catch{
    // Browser unavailable is an integration failure, not approval.
  }finally{await browser?.close();await fixture.close();}
  return evaluateReportingSuite(revision,contract,suite,observations,authority);
}
