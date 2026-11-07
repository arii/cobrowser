/// <reference types="chrome" />
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root=await mkdtemp(join(tmpdir(),'cobrowser-visual-'));
const server=createServer((_req,res)=>res.end('<!doctype html><title>Visual context test</title><main><h1>First screen</h1><p>Visible report information</p><input value="PRIVATE-INPUT"><textarea>PRIVATE-TEXTAREA</textarea><div data-sensitive>PRIVATE-MARKED</div><button onclick="document.querySelector(\'h1\').textContent=\'After click\'">Change screen</button></main>'));
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const quote=(s:string)=>`'${s.replaceAll("'","'\\''")}'`;
await build({entryPoints:['scripts/context-brain-host.ts'],outfile:join(root,'host.cjs'),platform:'node',format:'cjs',bundle:true,target:'node24'});
const launcher=join(root,'host');await writeFile(launcher,`#!/bin/sh\nexport COBROWSER_CONTEXT_REPLAY=1\nexec ${quote(process.execPath)} ${quote(join(root,'host.cjs'))} "$@"\n`,{mode:0o700});
const profile=join(root,'profile');await mkdir(join(profile,'NativeMessagingHosts'),{recursive:true});
await writeFile(join(profile,'NativeMessagingHosts/com.cobrowser.context.json'),JSON.stringify({name:'com.cobrowser.context',description:'Synthetic visual test only',path:launcher,type:'stdio',allowed_origins:['chrome-extension://afchllcepipgheklaapddihncbpmfocl/']}));
const extension=resolve('apps/extension/.output/chrome-mv3');
const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1000,height:700},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try{
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=worker.url().split('/')[2];
  const page=await context.newPage();await page.goto(origin);
  const monitor=await context.newPage();await monitor.goto(`chrome-extension://${id}/recording.html`);
  const errors:string[]=[];monitor.on('pageerror',error=>errors.push(error.message));
  await monitor.getByRole('button',{name:'Start recording',exact:true}).click();await page.bringToFront();
  const stateNow=async()=>monitor.evaluate(async()=>(await chrome.storage.local.get('contextBrain')).contextBrain as any);
  const until=async(predicate:(state:any)=>boolean)=>{
    const deadline=Date.now()+35000;
    while(Date.now()<deadline){const value=await stateNow();if(value&&predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,250));}
    const info=await monitor.evaluate(async()=>{const all=await chrome.storage.local.get(null);return {keys:Object.keys(all),connection:all.brainConnection,capture:(all.fixtureRecording as any)?.visualCapture,brainActivity:all.brainActivity};});
    throw new Error('native-observation-timeout: '+JSON.stringify(info));
  };
  await until(state=>state.assumptions.some((item:any)=>item.observation?.imageHashes.length===1));
  await page.mouse.move(100,100);await page.mouse.move(300,180);await page.getByRole('button',{name:'Change screen'}).click();
  const state=await until(state=>state.assumptions.some((item:any)=>item.observation?.imageHashes.length===2 && item.observation.before?.excerpt!==item.observation.after.excerpt));
  assert.equal(state.source,'main-chrome-native');assert.equal(state.mode,'replay');assert(state.assumptions.some((item:any)=>item.observation?.visualSummary));
  assert(!JSON.stringify(state).includes('PRIVATE-'));assert(!JSON.stringify(state).includes('base64'));
  await monitor.bringToFront();await monitor.getByText('Context assumptions over time',{exact:true}).waitFor({state:'visible'});
  await monitor.waitForFunction(()=>document.querySelectorAll('.assumption').length>=2);
  await mkdir('.local/evidence',{recursive:true});await monitor.screenshot({path:'.local/evidence/visual-context.png',fullPage:true});
  assert.deepEqual(errors,[]);
  const report={mode:'real-browser-native-bridge-with-synthetic-models',screenshotsReceived:true,beforeAfterDom:true,imageSummary:true,movementContext:true,assumptionTimeline:true,privateFieldsExcluded:true,rawImagesNotPersisted:true,pageErrors:errors};
  await writeFile('.local/evidence/visual-context.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await context.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
