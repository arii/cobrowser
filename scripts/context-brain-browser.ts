/// <reference types="chrome" />
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { startFixture } from '../apps/fixture-site/server.js';
import { ContextBrain, type BrainView } from '../packages/context-brain/engine.js';
import { BrainEvent, type ContextFrame } from '../packages/context-brain/contracts.js';

export async function runBrowserBrain(brain:ContextBrain,persist:(view:BrainView)=>Promise<void>) {
  let fixture:Awaited<ReturnType<typeof startFixture>>|undefined;
  const existing=await fetch('http://127.0.0.1:3210/',{signal:AbortSignal.timeout(2000)}).catch(()=>null);
  if (existing) {
    if (!(await existing.text()).includes('<title>Harness fixture phase0-agent-7f3a91</title>')) throw new Error('port-3210-is-not-the-reporting-fixture');
  } else fixture=await startFixture(false,3210);
  const origin='http://127.0.0.1:3210';
  const extension=resolve('apps/extension/.output/chrome-mv3');
  const context=await chromium.launchPersistentContext(resolve('.local/context-brain-profile'),{
    channel:'chromium',headless:process.argv.includes('--headless'),args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  let closed=false;context.on('close',()=>{closed=true;});
  const seen=new Set<string>();let previousFrame:ContextFrame|undefined;
  let observedSession:string|null=null,lastCaptureAt=0,lastFrameHash='',smokeChanged=false;
  try {
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
    const id=worker.url().split('/')[2];
    const monitor=await context.newPage();await monitor.goto(`chrome-extension://${id}/recording.html`);
    await monitor.getByRole('button',{name:'Start recording',exact:true}).click();
    const page=await context.newPage();await page.goto(`${origin}/`);await page.bringToFront();
    console.log(`Context brain: ${brain.view().mode.toUpperCase()}${brain.view().mode==='replay'?' — synthetic model responses; no provider calls':''}.\nBrowse any HTTP/HTTPS tab in this browser, then open the Cobrowser recording monitor tab.\nLogs: ${resolve('.local/context-brain')}\nClose this browser to stop.`);
    await page.evaluate(mode=>{
      const note=document.createElement('p');
      note.textContent=mode==='replay'?'Context brain preview: real interactions, simulated analysis. Switch to the Cobrowser recording monitor tab to inspect the current task and decision log.':'Context brain is live. Masked screenshots from the active browser tab go to Snap; action metadata and context go to the configured context model (shown in the monitor). Inspect or pause it in the Cobrowser recording monitor tab.';
      note.style.cssText='padding:16px;background:#dcefe5;max-width:700px';document.body.prepend(note);
    },brain.view().mode);
    const beganAt=Date.now();
    const deadline=process.argv.includes('--smoke')?Date.now()+10_000:Infinity;
    if (process.argv.includes('--smoke')) {
      await page.locator('#probe').click();await page.locator('#probe').fill('masked-synthetic-test');await page.locator('#probe').press('Tab');await page.locator('h1').click();
    }
    while (!closed && Date.now()<deadline) {
      const {fixtureRecording:recording,recordingEnabled}=await worker.evaluate(async()=>({
        ...(await chrome.storage.local.get<{fixtureRecording?:{sessionId:string|null;events:unknown[];tabs?:unknown[]}}>('fixtureRecording')),
        ...(await chrome.storage.session.get<{recordingEnabled?:boolean}>('recordingEnabled')),
      }));
      if ((recording?.sessionId??null)!==observedSession || !recording?.sessionId) {
        brain.clear();seen.clear();previousFrame=undefined;lastFrameHash='';lastCaptureAt=0;observedSession=recording?.sessionId??null;
      }
      if (process.argv.includes('--smoke') && !smokeChanged && Date.now()-beganAt>3000) {
        await page.locator('h1').evaluate(element=>{element.textContent='Reporting fixture: asynchronous screen update';});smokeChanged=true;
      }
      if (!recordingEnabled) previousFrame=undefined;
      brain.setTabs(recording?.tabs??[]);
      const inputs=recordingEnabled?(recording?.events??[]).map(event=>BrainEvent.parse(event)).filter(event=>event.sessionId===recording?.sessionId && !seen.has(event.id)):[];
      // Bounded backlog; old records stay in the recorder but are not replayed forever.
      const pending=inputs.slice(-64);
      for (const event of inputs) seen.add(event.id);
      if (seen.size>4000) {seen.clear();for (const event of recording?.events??[]) seen.add(BrainEvent.parse(event).id);}
      if (recordingEnabled && recording?.sessionId) {
        // Capture only the focused HTTP(S) tab. Background tabs contribute text summaries.
        const tabs=await worker.evaluate(()=>chrome.tabs.query({active:true,lastFocusedWindow:true}));
        const active=tabs[0];const focused=active?await worker.evaluate(id=>chrome.windows.get(id),active.windowId):null;const latest=pending.at(-1);
        let frame:ContextFrame|undefined;
        const significant=pending.some(event=>!['pointer','scroll','page-visible'].includes(event.kind));
        const activeOrigin=active?.url && /^https?:/.test(active.url)?new URL(active.url).origin:null;
        const matchingPages=context.pages().filter(candidate=>candidate.url()===active?.url);
        // Duplicate URLs are ambiguous; skip pixels while retaining tab summaries.
        const sourcePage=matchingPages.length===1?matchingPages[0]:undefined;
        if ((significant || Date.now()-lastCaptureAt>=4000) && focused?.focused && activeOrigin && sourcePage && !active?.incognito && (!latest || active?.id===latest.tabId)) {
          // Mask editable/sensitive surfaces and frames before creating the screenshot.
          const bytes=await sourcePage.screenshot({type:'png',mask:[sourcePage.locator('input,textarea,select,[contenteditable],[data-sensitive],iframe')],maskColor:'#000000'});
          lastCaptureAt=Date.now();
          const after=await worker.evaluate(()=>chrome.tabs.query({active:true,lastFocusedWindow:true}));
          const afterWindow=after[0]?await worker.evaluate(id=>chrome.windows.get(id),after[0].windowId):null;
          if (afterWindow?.focused && after[0]?.id===active.id && after[0]?.url===active.url && sourcePage.url()===active.url) {
            const imageHash=createHash('sha256').update(bytes).digest('hex');
            frame={image:{mediaType:'image/png',base64:bytes.toString('base64')},at:new Date().toISOString(),sessionId:recording.sessionId,origin:activeOrigin,tabId:active.id!};
            if (imageHash!==lastFrameHash) {
              if (pending.length>=64) pending.shift();
              pending.push({id:`screen-${randomUUID()}`,at:frame.at,sessionId:frame.sessionId,origin:frame.origin,tabId:frame.tabId,kind:'screen-change',tag:'PAGE',provenance:'human'});
              lastFrameHash=imageHash;
            }
          }
        }
        let group:BrainEvent[]=[];
        const flush=async()=>{
          if (!group.length) return;
          const last=group.at(-1)!;
          const working=brain.view().working;
          const previousAllowed=working && working.scope===last.sessionId && working.status!=='completed';
          const frames=frame && last.tabId===frame.tabId && last.sessionId===frame.sessionId && last.origin===frame.origin
            ? [previousAllowed?previousFrame:undefined,frame].filter((item):item is ContextFrame=>Boolean(item && item.sessionId===last.sessionId && item.tabId===last.tabId && Date.now()-Date.parse(item.at)<90_000)) : [];
          while(group.length){await brain.observe(group.slice(0,64),frames);group=group.slice(64);}
        };
        for (const event of pending) {
          if (group.length && (event.tabId!==group[0].tabId || event.sessionId!==group[0].sessionId || event.origin!==group[0].origin)) await flush();
          group.push(event);
        }
        await flush();previousFrame=frame??previousFrame;
      }
      const currentSession=await worker.evaluate(async()=>(await chrome.storage.local.get<{fixtureRecording?:{sessionId:string|null}}>('fixtureRecording')).fixtureRecording?.sessionId);
      if (currentSession!==recording?.sessionId) {brain.clear();seen.clear();previousFrame=undefined;lastFrameHash='';}
      const view=brain.view();await persist(view);
      await worker.evaluate(value=>chrome.storage.local.set({contextBrain:{...value,connectedAt:new Date().toISOString()}}),view);
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    if (process.argv.includes('--smoke')) {
      const view=brain.view();
      if (!view.recent.some(event=>event.kind==='key' && event.key==='Tab') || JSON.stringify(view).includes('masked-synthetic-test')) throw new Error('brain-keyboard-privacy-smoke-failed');
      if (!view.recent.some(event=>event.kind==='screen-change') || view.providers.snap.calls<2) throw new Error('brain-screen-change-smoke-failed');
      if (!view.working || !view.journal.some(entry=>entry.kind==='snap-signals')) throw new Error('brain-browser-smoke-failed');
      await monitor.bringToFront();
      await monitor.waitForFunction(()=>document.querySelector('#brain-intent')?.textContent?.includes('reporting'));
      await monitor.screenshot({path:resolve('.local/context-brain/monitor.png'),fullPage:true});
      console.log(JSON.stringify({mode:view.mode,browserFeed:true,snapCalls:view.providers.snap.calls,contextCalls:view.providers.context.calls,workingIntent:view.working.intent,monitorVerified:true,screenChangesWithoutClicksVerified:smokeChanged}));
    }
  } finally {await context.close();await fixture?.close();}
}
