import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
let noOpPreview=false;
const server=createServer((_req,res)=>res.end(`<!doctype html><html><head><title>Skill test</title></head><body>
<h1>Reports</h1><label>Team <select><option>Red</option><option>Blue</option></select></label><button type="button" onclick="document.querySelector('#editor').hidden=false">Open report</button>
<section id="editor" hidden><label>Report title <input id="title" type="text"></label>
<button type="button" onclick="${noOpPreview?'':`document.querySelector('output').textContent='Preview: '+document.querySelector('input').value`}">Preview report</button></section><output></output>
</body></html>`));
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const profile=await mkdtemp(join(tmpdir(),'cobrowser-skills-'));
const extension=resolve(process.argv.includes('--raw')?'apps/extension':'apps/extension/.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const id=worker.url().split('/')[2],errors:string[]=[];
  const popup=await context.newPage();popup.on('pageerror',error=>errors.push(error.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const send=(kind:string,args={})=>popup.evaluate(message=>(globalThis as any).chrome.runtime.sendMessage(message),{kind,...args});
  assert.equal((await send('recording:start')).ok,true);
  const source=await context.newPage();
  noOpPreview=true;
  for(let i=0;i<3;i++){
    await source.goto(origin);await source.bringToFront();await source.waitForTimeout(200);
    await source.getByRole('button',{name:'Open report',exact:true}).click();
    await source.getByLabel('Report title').fill('Synthetic private input');
    await source.getByRole('button',{name:'Preview report',exact:true}).click();await source.waitForTimeout(650);
  }
  assert.equal((await send('skills:list')).value.candidates.length,0,'No-op demonstrations must not become skills.');
  noOpPreview=false;
  for(let i=0;i<3;i++){
    await source.goto(origin);await source.bringToFront();
    await source.waitForTimeout(200);
    await source.getByRole('button',{name:'Open report',exact:true}).click();
    await source.getByLabel('Report title').fill('Synthetic private input');
    await source.getByRole('button',{name:'Preview report',exact:true}).click();
    await source.waitForTimeout(650);
  }
  const recording=await send('recording:status');
  assert.equal(JSON.stringify(recording.value.events).includes('Synthetic private input'),false);
  let listing=await send('skills:list');
  assert.equal(listing.ok,true);
  const candidate=listing.value.candidates.find((item:any)=>item.steps.length===3 && item.steps[1].kind==='change');
  assert.ok(candidate,JSON.stringify(listing.value.candidates));assert.equal(candidate.blockers.length,0);assert.equal(candidate.title,'Preview report');assert.equal(listing.value.candidates.length,1);
  await popup.bringToFront();
  await popup.getByRole('button',{name:'Refresh examples'}).click();
  await popup.locator('#skills-candidates details').first().locator('summary').click();
  await popup.getByRole('button',{name:'Save to skills',exact:true}).first().click();
  await popup.locator('#skills-library details summary').click();
  assert.equal(await popup.getByRole('button',{name:'Activate skill',exact:true}).isDisabled(),true);
  await popup.getByRole('button',{name:'Rename',exact:true}).click();
  await popup.locator('#skills-library').getByLabel('Skill name',{exact:true}).fill('Weekly report preview');
  await popup.getByRole('button',{name:'Save name',exact:true}).click();
  listing=await send('skills:list');assert.equal(listing.value.skills[0].title,'Weekly report preview');
  assert.equal((await send('skills:rename',{id:listing.value.skills[0].id,title:'   '})).ok,false);
  await popup.getByRole('checkbox').check();await popup.getByRole('button',{name:'Activate skill',exact:true}).click();
  await popup.getByPlaceholder('Value for this run').fill('Repeated through skill');
  listing=await send('skills:list');const skill=listing.value.skills[0];assert.equal(skill.active,true);
  await source.goto(origin);await source.bringToFront();
  // Invoke the toolbar control without making an extension test tab the active source.
  await popup.evaluate(()=>{(document.querySelector('[data-run]') as HTMLButtonElement).click();});
  let run:any;
  for(let i=0;i<100;i++){
    await popup.waitForTimeout(100);run=(await send('skills:list')).value.run;
    if(run && run.status!=='running')break;
  }
  assert.equal(run?.status,'finished',JSON.stringify(run));assert.equal(run.completed,3);
  const replay=context.pages().find(page=>page!==source && page.url().startsWith(origin));assert.ok(replay);
  assert.equal(await replay.locator('output').innerText(),'Preview: Repeated through skill');
  // Own execution must not become another human demonstration.
  const recordedAfter=(await send('recording:status')).value.events;
  assert.equal(recordedAfter.some((event:any)=>event.tabId===run.tabId && ['click','change'].includes(event.kind)),false);
  await popup.bringToFront();await popup.getByRole('button',{name:'Refresh examples'}).click();
  await mkdir('.local/evidence',{recursive:true});await popup.locator('#skills').screenshot({path:'.local/evidence/skills.png'});
  // Missing controls stop before dispatch, without claiming success or retrying effects.
  await source.goto(origin);await source.getByRole('button',{name:'Open report',exact:true}).evaluate(node=>node.remove());await source.bringToFront();
  // A separate tab starts from the original page, so test missing target via a saved descriptor mutation in this isolated test profile.
  await popup.evaluate(async()=>{const chrome=(globalThis as any).chrome;const {skillLibrary}=await chrome.storage.local.get('skillLibrary');skillLibrary[0].steps[0].target.label='Missing control';await chrome.storage.local.set({skillLibrary});});
  const failedStart=await send('skills:run',{id:skill.id,parameters:{input_2:'Synthetic'}});assert.equal(failedStart.ok,true);
  for(let i=0;i<100;i++){await popup.waitForTimeout(100);run=(await send('skills:list')).value.run;if(run?.status!=='running')break;}
  assert.equal(run.status,'failed');assert.equal(run.completed,0);
  assert.equal(errors.length,0,errors.join('\n'));
  // A saved empty legacy skill stays unavailable even if its old active flag was true.
  await popup.evaluate(async()=>{const chrome=(globalThis as any).chrome;const {skillLibrary}=await chrome.storage.local.get('skillLibrary');skillLibrary.push({id:'empty',title:'Empty old skill',steps:[],active:true,blockers:[],examples:[]});await chrome.storage.local.set({skillLibrary});});
  assert.equal((await send('skills:run',{id:'empty'})).ok,false);
  assert.equal((await send('skills:activate',{id:'empty',active:true,reviewed:true})).ok,false);
  // Exercise select parameters with a labeled synthetic runtime fixture.

  await popup.evaluate(async()=>{const chrome=(globalThis as any).chrome;const {skillLibrary}=await chrome.storage.local.get('skillLibrary');skillLibrary[0].steps=[{kind:'change',target:{tag:'SELECT',label:'Team',type:''},parameter:'input_1'},{kind:'click',target:{tag:'BUTTON',label:'Open report',type:'button'},parameter:null},{kind:'click',target:{tag:'BUTTON',label:'Preview report',type:'button'},parameter:null}];await chrome.storage.local.set({skillLibrary});});
  await source.goto(origin);await source.bringToFront();
  assert.equal((await send('skills:run',{id:skill.id,parameters:{input_1:'Blue'}})).ok,true);
  for(let i=0;i<100;i++){await popup.waitForTimeout(100);run=(await send('skills:list')).value.run;if(run?.status!=='running')break;}
  assert.equal(run.status,'finished',JSON.stringify(run));
  // Inspect by Chrome tab ID, avoiding ambiguous duplicate page URLs.
  const selection=await worker.evaluate(`chrome.scripting.executeScript({target:{tabId:${Number(run.tabId)}},func:()=>document.querySelector('select')?.value})`);
  assert.ok(Array.isArray(selection));assert.equal(selection[0].result,'Blue');
  noOpPreview=true;
  await source.bringToFront();
  assert.equal((await send('skills:run',{id:skill.id,parameters:{input_1:'Blue'}})).ok,true);
  for(let i=0;i<100;i++){await popup.waitForTimeout(100);run=(await send('skills:list')).value.run;if(run?.status!=='running')break;}
  assert.equal(run.status,'failed');assert.match(run.message,/no observed page change/);
  noOpPreview=false;
  await source.bringToFront();
  assert.equal((await send('skills:run',{id:skill.id,parameters:{input_1:'Red'}})).ok,true);
  assert.equal((await send('skills:cancel')).ok,true);
  for(let i=0;i<50;i++){await popup.waitForTimeout(100);run=(await send('skills:list')).value.run;if(run?.finishedAt)break;}
  assert.equal(run.status,'cancelled');
  // Dismissal survives reopening and refresh; no overlapping alternative reappears.
  await send('skills:delete',{id:skill.id});
  listing=await send('skills:list');assert.equal(listing.value.candidates.length,1);
  assert.equal((await send('skills:dismiss',{key:listing.value.candidates[0].key})).ok,true);
  assert.equal((await send('skills:list')).value.candidates.length,0);
  await mkdir('.local/evidence',{recursive:true});
  await writeFile('.local/evidence/skills.json',JSON.stringify({mode:'synthetic isolated browser',exampleCount:candidate.exampleCount,steps:3,result:'Preview: Repeated through skill',missingTarget:'failed before dispatch',selectParameter:'Blue applied and checked',cancellation:'cancelled',renaming:'saved and blank rejected',emptySkills:'blocked',noOpResult:'failed',dismissal:'persisted',errors},null,2));
  console.log('Skills verified: real demonstrations, privacy, toolbar save/review/activation, parameterized CDP replay, agent exclusion, missing-target failure, select parameters, cancellation, rename persistence, no-op rejection and dismissal.');
}finally{await context.close();await rm(profile,{recursive:true,force:true});await new Promise<void>(resolve=>server.close(()=>resolve()));}
