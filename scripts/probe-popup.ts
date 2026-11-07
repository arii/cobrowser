import { chromium, type Page } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';

const profile = await mkdtemp(join(tmpdir(), 'harness-popup-'));
const existingFixture=await fetch('http://127.0.0.1:3210/',{signal:AbortSignal.timeout(2000)}).catch(()=>null);
if(existingFixture && !(await existingFixture.text()).includes('<title>Harness fixture phase0-agent-7f3a91</title>'))throw new Error('port-3210-is-not-the-reporting-fixture');
const fixture=existingFixture?{origin:'http://127.0.0.1:3210',close:async()=>{}}:await startFixture(false,3210);
const extension = resolve(process.argv.includes('--built') ? 'apps/extension/.output/chrome-mv3' : 'apps/extension');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const pageErrors: string[] = [];
let other: Awaited<ReturnType<typeof startFixture>> | undefined;
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(pathToFileURL(resolve('apps/extension/popup.html')).href);
  assert.equal(await page.locator('#setup').isVisible(), true);
  assert.equal(await page.locator('button:disabled').count(), 6);
  assert.match(await page.locator('#status').innerText(), /Extension APIs are unavailable/);

  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Ready.'));
  const probes=page.getByText('Developer probes',{exact:true});
  if(await probes.count())await probes.click();
  const results = [];
  for (const name of ['Detach', 'Create agent tab', 'Screenshot/context', 'Click and type']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.waitForFunction(() => {
      const text = document.getElementById('status')!.textContent!;
      return text.startsWith('{') || text.startsWith('Unable');
    });
    const result = JSON.parse(await page.locator('#status').innerText());
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
    results.push({ button: name, ok: result.ok });
  }
  const agent = context.pages().find(p => p.url() === `${fixture.origin}/`)!;
  assert.equal(await agent.locator('#probe').inputValue(), 'manual-CDP-probe');

  // This profile intentionally has no native registration. Verify visible progress
  // and an actionable failure, without pretending that the relay is connected.
  await page.getByRole('button', { name: 'Relay ping', exact: true }).click();
  assert.match(await page.locator('#status').innerText(), /Running Relay ping/);
  await page.waitForFunction(() => document.getElementById('status')!.textContent!.includes('native-timeout'), undefined, { timeout: 15000 });
  assert.match(await page.locator('#status').innerText(), /Check native host registration/);
  await page.getByRole('button', { name: 'Detach', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('status')!.textContent!.includes('"ok": true'));

  // Adopt-active-tab flow on a second origin. The popup page cannot be the
  // adoption target, so assignment runs through runtime messages: clicking
  // the popup tab would activate it and adoption would reject it.
  const send = (message: {kind:string; args?:unknown}) =>
    page.evaluate((m: {kind:string; args?:unknown}) => (window as any).chrome.runtime.sendMessage(m), message);
  other = await startFixture(false, 0);
  const adoptedOrigin = other.origin;
  let target: Page | undefined;
  try {
    await page.bringToFront();
    const rejected = await send({kind:'assign', args:{adopt:true}});
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, 'adopt-requires-http-tab');
    target = await context.newPage();
    await target.goto(`${other.origin}/`);
    await target.bringToFront();
    const adopted = await send({kind:'assign', args:{adopt:true}});
    assert.equal(adopted.ok, true, JSON.stringify(adopted));
    assert.equal(adopted.value.adopted, true);
    assert.equal(adopted.value.origin, other.origin);
    const busy = await send({kind:'assign', args:{adopt:true}});
    assert.equal(busy.ok, false);
    assert.equal(busy.error, 'stop-existing-assignment-first');
    const shot = await send({kind:'screenshot'});
    assert.equal(shot.ok, true, JSON.stringify(shot));
    const started = await send({kind:'recording:start'});
    assert.equal(started.ok, true, JSON.stringify(started));
    await target.bringToFront();
    await target.locator('#probe').click();
    await target.locator('select[name="team"]').click();
    let recorded: any = {ok:true, value:{events:[]}};
    for (let i = 0; i < 25 && recorded.value.events.length < 2; i++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      recorded = await send({kind:'recording:status'});
    }
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    assert.ok(recorded.value.events.length >= 2, JSON.stringify(recorded.value));
    assert.ok(recorded.value.events.every((event: any) => event.origin === adoptedOrigin && event.provenance === 'human' && event.sessionId === recorded.value.sessionId),
      JSON.stringify(recorded.value.events));
    const shot2 = await send({kind:'screenshot'});
    assert.equal(shot2.ok, true, JSON.stringify(shot2));
    const typed = await send({kind:'clickType', args:{observationId:shot2.value.observation.id, x:65, y:425, text:'adopt-probe'}});
    assert.equal(typed.ok, true, JSON.stringify(typed));
    assert.equal(await target.locator('#probe').inputValue(), 'adopt-probe');
    await new Promise(resolve => setTimeout(resolve, 500));
    const afterAgent = await send({kind:'recording:status'});
    assert.equal(afterAgent.value.events.length, recorded.value.events.length, JSON.stringify(afterAgent.value.events));
    const paused = await send({kind:'recording:pause'});
    assert.equal(paused.ok, true, JSON.stringify(paused));
    const released = await send({kind:'stop'});
    assert.equal(released.ok, true, JSON.stringify(released));
    results.push({button:'Adopt active tab', ok:true});
  } finally {
    await target?.close();
    // `other` closes after the browser context below: pooled sockets outlive pages.
  }
  assert.deepEqual(pageErrors, []);
  let inputValue = 'unavailable';
  try { inputValue = await agent.locator('#probe').inputValue(); } catch { /* asserted mid-run; the report tolerates a dead page */ }
  const report = { mode: 'live-extension-popup-UI', directFile: 'setup instructions visible; all six controls disabled', results,
    inputValue, missingNativeHost: 'visible progress then native-timeout with setup guidance', pageErrors };
  await mkdir('.local/evidence', { recursive: true });
  await writeFile('.local/evidence/popup-ui.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await context.close(); await other?.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }); }
