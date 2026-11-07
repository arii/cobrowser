import { chromium } from 'playwright';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';
const fixture=await startFixture(false,0),profile=await mkdtemp(join(tmpdir(),'cobrowser-report-skill-'));
const extension=resolve(process.argv.includes('--raw')?'apps/extension':'apps/extension/.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker'),id=worker.url().split('/')[2];
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);
  const send=(kind:string,args={})=>popup.evaluate(message=>(globalThis as any).chrome.runtime.sendMessage(message),{kind,...args});
  await popup.getByRole('button',{name:'Start learning',exact:true}).click();
  assert.equal((await send('skills:list')).value.recordingEnabled,true);
  const source=await context.newPage();await source.goto(fixture.origin);await source.waitForTimeout(250);
  // Same page throughout: its success message changes only for the first export.
  for(let index=0;index<3;index++){
    await source.bringToFront();
    if(index===1){
      await source.getByLabel('Start inclusive').click();await source.getByLabel('Start inclusive').press('ControlOrMeta+A');
      await source.getByLabel('Start inclusive').press('Backspace');await source.getByLabel('Start inclusive').pressSequentially('2026-10-26');
      await source.getByLabel('Start inclusive').press('Tab');
    }
    const download=source.waitForEvent('download');await source.getByRole('button',{name:'Export CSV',exact:true}).click();
    const file=await download;assert.match(await readFile((await file.path())!,'utf8'),/^team,date,value\nred,/);
    let value:any;
    for(let attempt=0;attempt<60;attempt++){
      value=(await send('skills:list')).value;
      if(value.learning.some((item:any)=>item.title==='Export CSV' && item.observedExamples===index+1))break;
      await source.waitForTimeout(100);
    }
    assert.equal(value.learning.find((item:any)=>item.title==='Export CSV')?.observedExamples,index+1,JSON.stringify(value.learning));
    assert.equal(value.skills.filter((item:any)=>!item.needsExamples).length,1,'First attempt saves one skill; later attempts do not duplicate it.');
    assert.equal(value.candidates.length,0);
  }
  // A cancelled native submit must not be counted just because it fired an event.
  await source.bringToFront();
  await source.evaluate(()=>document.querySelector('form')!.addEventListener('submit',event=>event.preventDefault(),{once:true}));
  await source.getByRole('button',{name:'Export CSV',exact:true}).click();await source.waitForTimeout(500);
  assert.equal((await send('skills:list')).value.learning[0].observedExamples,3);
  const state=(await send('skills:list')).value,candidate=state.skills[0];
  assert.equal(candidate.title,'Export CSV');assert.equal(candidate.steps.length,4);
  assert.deepEqual(candidate.steps.slice(0,3).map((step:any)=>step.target.label),['Team','Start inclusive','End exclusive']);
  const events=(await send('recording:status')).value.events;
  assert.ok(events.some((event:any)=>event.effect==='form-submitted'));
  assert.equal(JSON.stringify(events).includes('2026-10-26'),false,'Input values must not enter evidence.');
  await popup.bringToFront();await popup.getByRole('button',{name:'Refresh examples',exact:true}).click();
  await popup.locator('#skills-library summary').click();await popup.getByRole('checkbox').check();await popup.getByRole('button',{name:'Activate skill',exact:true}).click();
  const card=popup.locator('#skills-library');
  await card.getByLabel('Team',{exact:true}).fill('blue');await card.getByLabel('Start inclusive',{exact:true}).fill('2026-10-26');await card.getByLabel('End exclusive',{exact:true}).fill('2026-11-02');
  await source.bringToFront();
  const opened=context.waitForEvent('page');await popup.evaluate(()=>{(document.querySelector('[data-run]') as HTMLButtonElement).click();});
  const replay=await opened,download=await replay.waitForEvent('download');
  const csv=await readFile((await download.path())!,'utf8');
  assert.match(csv,/^team,date,value\nblue,2026-10-26,226\n/);assert.equal(csv.includes('\nred,'),false);
  let run:any;
  for(let attempt=0;attempt<60;attempt++){run=(await send('skills:list')).value.run;if(run?.status!=='running')break;await popup.waitForTimeout(100);}
  assert.equal(run.status,'finished',JSON.stringify(run));assert.equal(run.completed,4);
  // The live recorder window can rotate without deleting the full local task history.
  const archived=(await send('recording:export')).value.events;assert.ok(archived.length>0);
  await popup.evaluate(async()=>{const chrome=(globalThis as any).chrome;const {fixtureRecording}=await chrome.storage.local.get('fixtureRecording');fixtureRecording.events=[];await chrome.storage.local.set({fixtureRecording});});
  assert.equal((await send('recording:export')).value.events.length,archived.length);
  assert.equal((await send('skills:list')).value.skills.filter((item:any)=>!item.needsExamples).length,1);
  await popup.bringToFront();await popup.getByRole('button',{name:'Refresh examples',exact:true}).click();
  await mkdir('.local/evidence',{recursive:true});await popup.locator('#skills').screenshot({path:'.local/evidence/report-skill.png'});
  await writeFile('.local/evidence/report-skill.json',JSON.stringify({mode:'isolated synthetic browser',samePageExports:3,fieldEditKeys:'normalized',learnedAfterFirstAttempt:true,repeatedAttemptsDeduplicated:true,savedTitle:candidate.title,parameters:['Team','Start inclusive','End exclusive'],replay:'finished',csv},null,2));
  console.log('Reporting skill verified: first-attempt automatic skill saving, repeated-export deduplication, editing keys, toolbar activation and parameterized replay with actual CSV bytes.');
}finally{await context.close();await fixture.close();await rm(profile,{recursive:true,force:true});}
