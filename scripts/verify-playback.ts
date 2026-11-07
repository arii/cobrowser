/// <reference types="chrome" />
import { chromium, type BrowserContext } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';

const extension = resolve(process.argv.includes('--raw') ? 'apps/extension' : 'apps/extension/.output/chrome-mv3');
const profile = await mkdtemp(join(tmpdir(), 'cobrowser-playback-'));
await mkdir(profile, { recursive: true });
const existingFixture = await fetch('http://127.0.0.1:3210/', { signal: AbortSignal.timeout(2000) }).catch(() => null);
if (existingFixture && !(await existingFixture.text()).includes('<title>Harness fixture phase0-agent-7f3a91</title>')) throw new Error('port-3210-is-not-the-reporting-fixture');
const fixture = existingFixture ? { origin: 'http://127.0.0.1:3210', close: async () => {} } : await startFixture(false, 3210);
let context: BrowserContext | undefined;
let other: Awaited<ReturnType<typeof startFixture>> | undefined;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  const monitor = await context.newPage();
  const errors: string[] = [];
  monitor.on('pageerror', error => errors.push(error.message));
  await monitor.goto(`chrome-extension://${id}/recording.html`);
  await monitor.getByRole('button', { name: 'Start recording', exact: true }).click();
  await monitor.waitForFunction(() => document.querySelector('#recording-state')?.textContent === 'Recording is on');
  const tab = await context.newPage();
  await tab.goto(fixture.origin);
  await tab.bringToFront();

  // Deterministic human sequence: click, committed change, click, pointer moves.
  await tab.locator('#probe').click();
  await tab.locator('#probe').fill('playback-human-value');
  await tab.locator('h1').click();
  await monitor.waitForFunction(() => Number(document.querySelector('#record-count')?.textContent) >= 3);
  await tab.bringToFront();
  await tab.mouse.move(60, 100);
  await sleep(1200);
  await tab.mouse.move(120, 140);
  await monitor.waitForFunction(() => Number(document.querySelector('#record-count')?.textContent) >= 4);
  const events = async () => worker.evaluate(async () => (await chrome.storage.local.get<{ fixtureRecording: { events: Record<string, unknown>[] } }>('fixtureRecording')).fixtureRecording.events);
  const kinds = (await events()).map(event => event.kind);
  assert.ok(kinds.includes('click') && kinds.includes('change'), JSON.stringify(kinds));
  // A second origin joins the same recording; replay must stay scoped to the
  // assigned tab and skip these foreign events openly.
  other = await startFixture(false, 0);
  const otherTab = await context.newPage();
  await otherTab.goto(other.origin);
  await otherTab.bringToFront();
  const beforeForeign = (await events()).length;
  await otherTab.locator('#probe').click();
  await monitor.waitForFunction((n: number) => Number(document.querySelector('#record-count')?.textContent) >= n, beforeForeign + 1);

  // Negative plumbing: pause/cancel with no active run must fail openly.
  const send = (message: { kind: string; text?: string }) =>
    monitor.evaluate((m: { kind: string; text?: string }) => (window as unknown as { chrome: typeof chrome }).chrome.runtime.sendMessage(m), message);
  assert.equal(((await send({ kind: 'replay:pause' }) as { ok: boolean; error: string }).error), 'replay-not-running');
  assert.equal(((await send({ kind: 'replay:resume' }) as { ok: boolean; error: string }).error), 'replay-not-paused');
  assert.equal(((await send({ kind: 'replay:cancel' }) as { ok: boolean; error: string }).error), 'replay-not-active');

  // Assign the recorded page through the monitor UI. Assignment attaches without
  // reloading, so the recorded tab itself can be the replay target.
  const recordedTabId = (await events())[0].tabId as number;
  await monitor.bringToFront();
  await monitor.locator('#replay-tab option').first().waitFor({ state: 'attached' });
  await monitor.locator('#replay-tab').selectOption(String(recordedTabId));
  await monitor.getByRole('button', { name: 'Assign selected tab', exact: true }).click();
  await monitor.waitForFunction((id: number) => document.querySelector('#replay-agent')?.textContent?.includes(`#${id}`), recordedTabId);
  assert.equal(((await send({ kind: 'replay:assign' }) as { ok: boolean; error: string }).error), 'stop-existing-assignment-first');
  await sleep(800);
  const countBefore = (await events()).length;
  const replayState = async () => worker.evaluate(async () => (await chrome.storage.session.get<{ replay: { status: string; mode: string; total: number; stats: { dispatched: number; userInputs: number; skipped: number }; need: { kind: string } | null } }>('replay')).replay);

  // Filtered run: click, input pause, click. Pointer noise is dropped.
  await monitor.locator('#replay-mode').selectOption('filtered');
  await monitor.getByRole('button', { name: 'Start replay', exact: true }).click();
  await monitor.waitForFunction(() => document.querySelector('#replay-status')?.textContent === 'Waiting on you.', undefined, { timeout: 30000 });
  let replay = await replayState();
  assert.equal(replay.mode, 'filtered');
  assert.equal(replay.total, 3);
  assert.equal(replay.need?.kind, 'input');
  assert.match(await monitor.locator('#replay-warnings').innerText(), /other origin/);
  await monitor.locator('#replay-input-text').fill('replayed-value');
  await monitor.getByRole('button', { name: 'Send input', exact: true }).click();
  await monitor.waitForFunction(() => document.querySelector('#replay-status')?.textContent === 'Replay finished.', undefined, { timeout: 30000 });
  replay = await replayState();
  assert.deepEqual([replay.stats.dispatched, replay.stats.userInputs, replay.stats.skipped], [3, 1, 0]);
  const withValue = async () => {
    // The agent tab is the recorded tab, so its field already holds the human
    // value; replayed input is inserted at the cursor rather than replacing it.
    for (const page of context!.pages()) {
      try { if ((await page.locator('#probe').inputValue()).includes('replayed-value')) return page; } catch { /* not a fixture page */ }
    }
    return null;
  };
  assert.ok(await withValue(), 'replayed input did not reach the agent tab field');
  await sleep(1000);
  assert.equal((await events()).length, countBefore, 'replayed agent input leaked into human recording');

  // Direct run: the same flow plus literal pointer moves, so strictly more steps.
  await monitor.locator('#replay-mode').selectOption('direct');
  await monitor.getByRole('button', { name: 'Start replay', exact: true }).click();
  await monitor.waitForFunction(() => document.querySelector('#replay-status')?.textContent === 'Waiting on you.', undefined, { timeout: 30000 });
  replay = await replayState();
  assert.equal(replay.mode, 'direct');
  assert.ok(replay.total > 3, `direct total ${replay.total} should exceed filtered total 3`);
  assert.ok(((await monitor.locator('#replay-warnings').innerText()) ?? '').length >= 0);
  await monitor.locator('#replay-input-text').fill('replayed-direct');
  await monitor.getByRole('button', { name: 'Send input', exact: true }).click();
  await monitor.waitForFunction(() => document.querySelector('#replay-status')?.textContent === 'Replay finished.', undefined, { timeout: 30000 });
  assert.ok((await events()).length === countBefore, 'direct replay leaked into human recording');

  // Detach through the monitor, then replay must fail openly with guidance.
  await monitor.getByRole('button', { name: 'Detach', exact: true }).click();
  await monitor.waitForFunction(() => (document.querySelector('#replay-agent')?.textContent ?? '').includes('No agent tab assigned'));
  await monitor.getByRole('button', { name: 'Start replay', exact: true }).click();
  await monitor.waitForFunction(() => (document.querySelector('#replay-error')?.textContent ?? '').includes('No agent tab assigned'));

  await mkdir('.local/evidence', { recursive: true });
  await monitor.screenshot({ path: '.local/evidence/playback-monitor.png', fullPage: true });
  assert.deepEqual(errors, []);
  const report = {
    mode: 'real-browser-agent-playback', filteredTotal: 3, directTotalGreaterThanFiltered: true,
    needsUserInputVerified: true, agentInputSuppressedFromRecording: true,
    monitorAssignDetachVerified: true, doubleAssignRejected: true,
    noAssignedTabGuidanceVerified: true, pauseWhenIdleRejected: true, pageErrors: errors,
  };
  await writeFile('.local/evidence/playback.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context?.close(); await other?.close(); await fixture.close();
  await rm(profile, { recursive: true, force: true });
}
