/// <reference types="chrome" />
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const server=createServer((_request,response)=>response.end(`<!doctype html><title>Cross-tab test</title><h1>Compare reports</h1><p>Public report information</p><input id="field" value="PRIVATE-INPUT"><textarea>PRIVATE-TEXTAREA</textarea><div data-sensitive>PRIVATE-MARKED</div><input type="password" id="secret"><button id="button">Continue</button>`));
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=(server.address() as {port:number}).port;
const profile=await mkdtemp(join(tmpdir(),'cobrowser-all-tabs-'));
const extension=resolve(process.argv.includes('--raw')?'apps/extension':'apps/extension/.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const id=worker.url().split('/')[2];
  const first=await context.newPage();await first.goto(`http://127.0.0.1:${port}/`);
  const second=await context.newPage();await second.goto(`http://localhost:${port}/`);
  const monitor=await context.newPage();await monitor.goto(`chrome-extension://${id}/recording.html`);
  const errors:string[]=[];monitor.on('pageerror',error=>errors.push(error.message));
  await monitor.getByRole('button',{name:'Start recording',exact:true}).click();
  await monitor.waitForFunction(()=>document.querySelectorAll('#open-tabs tr').length===2);
  const read=()=>worker.evaluate(async()=>(await chrome.storage.local.get<{fixtureRecording:{events:{origin:string;kind:string;id:string;at:string}[];tabs:{origin:string;title:string;excerpt:string;readStatus:string}[];dropped:number}}>('fixtureRecording')).fixtureRecording);
  const initial=await read();
  assert.equal(initial.tabs.length,2);
  assert(initial.tabs.every(tab=>tab.readStatus==='ready'));
  assert(initial.tabs.every(tab=>tab.excerpt.includes('Public report information')));
  assert(!JSON.stringify(initial.tabs).includes('PRIVATE-'));
  await first.bringToFront();await first.locator('#button').click();
  await monitor.waitForFunction(()=>document.querySelector('#record-count')!.textContent!=='0');
  await second.bringToFront();await second.locator('#field').click();await second.locator('#field').fill('PRIVATE-TYPED');await second.locator('#button').click();
  await monitor.waitForFunction(async()=>{
    const {fixtureRecording:state}=await chrome.storage.local.get<{fixtureRecording:{events:{kind:string;origin:string}[]}}>('fixtureRecording');
    return new Set(state.events.filter(event=>event.kind==='click').map(event=>event.origin)).size===2;
  });
  let state=await read();assert(!JSON.stringify(state).includes('PRIVATE-TYPED'));
  const count=state.events.length;
  await second.evaluate(()=>document.querySelector('#button')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await monitor.getByRole('button',{name:'Pause',exact:true}).click();
  await second.bringToFront();await second.locator('#button').click();
  await monitor.waitForFunction(()=>document.querySelector('#recording-state')!.textContent==='Recording is paused');
  assert.equal((await read()).events.length,count);
  // Continuous recording rotates old evidence rather than stopping at the cap.
  await worker.evaluate(async()=>{
    const {fixtureRecording:state}=await chrome.storage.local.get<{fixtureRecording:{events:Record<string,unknown>[]}}>('fixtureRecording');
    const sample=state.events.at(-1)!;
    state.events=Array.from({length:2000},(_,index)=>({...sample,id:`synthetic-${index}`}));await chrome.storage.local.set({fixtureRecording:state});
  });
  await monitor.getByRole('button',{name:'Start recording',exact:true}).click();
  await first.bringToFront();await first.locator('#button').click();
  await monitor.waitForFunction(async()=>(await chrome.storage.local.get<{fixtureRecording:{dropped:number}}>('fixtureRecording')).fixtureRecording.dropped>0);
  state=await read();assert.equal(state.events.length,2000);
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.session.get('recordingEnabled')).recordingEnabled),true);
  await monitor.bringToFront();await monitor.getByRole('button',{name:'Clear saved data',exact:true}).click();
  await monitor.waitForFunction(()=>document.querySelector('#record-count')!.textContent==='0');
  state=await read();assert.equal(state.tabs.length,0);assert.deepEqual(errors,[]);
  const report={mode:'real-browser-offline',origins:[`http://127.0.0.1:${port}`,`http://localhost:${port}`],backgroundTabsRead:true,fieldsExcluded:true,crossOriginEvents:true,pauseVerified:true,rollingQuotaVerified:true,clearVerified:true,pageErrors:errors};
  await mkdir('.local/evidence',{recursive:true});await writeFile('.local/evidence/all-tabs.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await context.close();await rm(profile,{recursive:true,force:true});await new Promise<void>(resolve=>server.close(()=>resolve()));}
