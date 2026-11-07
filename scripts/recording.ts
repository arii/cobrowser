/// <reference types="chrome" />
import { chromium, type BrowserContext } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';

const demo = process.argv.includes('--demo');
const extension = resolve(process.argv.includes('--raw') ? 'apps/extension' : 'apps/extension/.output/chrome-mv3');
const profile = demo ? resolve('.local/recording-profile') : await mkdtemp(join(tmpdir(),'cobrowser-recording-'));
await mkdir(profile,{recursive:true});
const fixture = await startFixture(false,3210);
let context: BrowserContext | undefined;
const launch = () => chromium.launchPersistentContext(profile,{
  channel:'chromium',headless:!demo,acceptDownloads:true,
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
});
try {
  context = await launch();
  let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  const monitor = await context.newPage();
  const errors: string[] = [];
  monitor.on('pageerror',error => errors.push(error.message));
  await monitor.goto(`chrome-extension://${id}/recording.html`);
  await monitor.getByRole('button',{name:'Start recording',exact:true}).click();
  await monitor.waitForFunction(() => document.querySelector('#recording-state')?.textContent === 'Recording is on');
  const tab = await context.newPage();
  await tab.goto(fixture.origin);
  await tab.bringToFront();
  const events = async () => worker.evaluate(async () => (await chrome.storage.local.get<{fixtureRecording:{events:Record<string,unknown>[]}}>('fixtureRecording')).fixtureRecording.events);
  await tab.locator('#probe').click();
  await tab.locator('#probe').fill('PRIVATE-VALUE-MUST-NOT-BE-SAVED');
  await tab.locator('h1').click(); // Commit the change using trusted physical input.
  await monitor.waitForFunction(() => Number(document.querySelector('#record-count')?.textContent) >= 3);
  let saved = await events();
  assert(saved.some(event => event.kind === 'click'));
  assert(saved.some(event => event.kind === 'change'));
  assert(!JSON.stringify(saved).includes('PRIVATE-VALUE'));
  if (demo) {
    console.log(`Recording is ON. Fixture: ${fixture.origin}/\nMonitor: chrome-extension://${id}/recording.html\nProfile: ${profile}\nThe initial events are labeled setup interactions from this script. Your subsequent fixture interactions are recorded too. Close this browser to stop.`);
    await tab.evaluate(() => {
      const note = document.createElement('p');
      note.textContent = 'Cobrowser recording is ON. Click controls or change fields, then switch to the Cobrowser recording monitor tab to see saved events. The initial interactions were an automated setup check.';
      note.style.cssText = 'padding:16px;background:#dcefe5;max-width:650px';
      document.body.prepend(note);
    });
    await context.waitForEvent('close',{timeout:0});
  } else {
    // A tab assigned to automation must never enter the human recording stream.
    await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({url:'http://127.0.0.1:3210/'});
      await chrome.storage.session.set({assigned:{tabId:tab.id,windowId:tab.windowId}});
    });
    const beforeAgent = (await events()).length;
    await tab.locator('#probe').click();
    await new Promise(resolve => setTimeout(resolve,300));
    assert.equal((await events()).length,beforeAgent);
    await worker.evaluate(() => chrome.storage.session.remove('assigned'));
    // Sensitive targets and synthetic DOM-dispatched events are excluded.
    await tab.evaluate(() => {
      const secret = document.createElement('input');secret.type='password';secret.id='secret';document.body.prepend(secret);
    });
    const beforeSecret = (await events()).length;
    await tab.locator('#secret').click();
    await tab.locator('#secret').fill('SECRET');
    await tab.locator('#secret').press('Tab');
    await tab.evaluate(() => document.querySelector('#probe')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    await new Promise(resolve => setTimeout(resolve,300));
    assert.equal((await events()).length,beforeSecret);
    // Ordinary page JavaScript has no extension messaging privileges.
    const invalid = await tab.evaluate(async () => {
      // Page context does not have extension messaging privileges.
      return typeof globalThis.chrome?.runtime?.sendMessage;
    });
    assert.notEqual(invalid,'function');
    await monitor.bringToFront();
    await monitor.getByRole('button',{name:'Pause',exact:true}).click();
    await monitor.waitForFunction(() => document.querySelector('#recording-state')?.textContent === 'Recording is paused');
    const pausedCount = (await events()).length;
    await tab.bringToFront();await tab.locator('#probe').click();
    await new Promise(resolve => setTimeout(resolve,300));
    assert.equal((await events()).length,pausedCount);
    await monitor.bringToFront();
    await monitor.getByRole('button',{name:'Start recording',exact:true}).click();
    await tab.goto(`${fixture.origin}/?excluded=PRIVATE-QUERY`);
    await tab.bringToFront();await tab.locator('#probe').click();
    await new Promise(resolve => setTimeout(resolve,300));
    assert.equal((await events()).length,pausedCount);
    await monitor.bringToFront();
    const download = monitor.waitForEvent('download');
    await monitor.getByRole('button',{name:'Export JSON',exact:true}).click();
    const file = await download;
    await mkdir('.local/evidence',{recursive:true});
    await file.saveAs(resolve('.local/evidence/recording-export.json'));
    await monitor.screenshot({path:'.local/evidence/recording-monitor.png',fullPage:true});
    saved = await events();
    const exported = JSON.parse(await readFile('.local/evidence/recording-export.json','utf8'));
    assert.deepEqual(exported.events,saved);
    assert(!JSON.stringify(exported).includes('PRIVATE-VALUE'));
    await context.close();
    context = await launch();
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${id}/recording.html`);
    await reopened.waitForFunction(() => document.querySelector('#recording-state')?.textContent === 'Recording is paused');
    assert.deepEqual(await events(),saved);
    // Raw retention is enforced even before the periodic sweep.
    await worker.evaluate(async () => {
      const {fixtureRecording:state} = await chrome.storage.local.get<{fixtureRecording:{events:{at:string}[]}}>('fixtureRecording');
      state.events[0].at = new Date(Date.now()-25*3600000).toISOString();
      await chrome.storage.local.set({fixtureRecording:state});
    });
    await reopened.waitForFunction(expected => Number(document.querySelector('#record-count')?.textContent) === expected,saved.length-1);
    await reopened.getByRole('button',{name:'Clear saved data',exact:true}).click();
    await reopened.waitForFunction(() => document.querySelector('#record-count')?.textContent === '0');
    assert.equal((await events()).length,0);
    assert.deepEqual(errors,[]);
    const report = {mode:'real-browser-fixture-recording',eventsSaved:saved.length,typedValuesExcluded:true,passwordTargetsExcluded:true,
      syntheticDOMEventsExcluded:true,assignedAgentTabExcluded:true,pauseVerified:true,queryNavigationExcluded:true,persistedAcrossBrowserRestart:true,
      restartPaused:true,retentionVerified:true,clearVerified:true,export:'.local/evidence/recording-export.json',pageErrors:errors};
    await writeFile('.local/evidence/recording.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }
} finally {
  await context?.close();await fixture.close();
  if (!demo) await rm(profile,{recursive:true,force:true});
}
