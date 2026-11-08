/// <reference types="chrome" />
// Real-browser check of the monitor's dataset toggle: load a converted recording, confirm it replaces the live state
// without live capture writing into it, reject a bad file, restore the live state on toggle-off and on Start recording.
import { chromium, type BrowserContext } from 'playwright';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';

const extension = resolve(process.argv.includes('--raw') ? 'apps/extension' : 'apps/extension/.output/chrome-mv3');
const samplePath = resolve(process.argv.find((arg, index, all) => all[index - 1] === '--sample') ?? 'dailySkills/data/recordings/psai-merged.json');
const profile = await mkdtemp(join(tmpdir(), 'cobrowser-dataset-'));
await mkdir(profile, { recursive: true });
const existingFixture = await fetch('http://127.0.0.1:3210/', { signal: AbortSignal.timeout(2000) }).catch(() => null);
if (existingFixture && !(await existingFixture.text()).includes('<title>Harness fixture phase0-agent-7f3a91</title>')) throw new Error('port-3210-is-not-the-reporting-fixture');
const fixture = existingFixture ? { origin: 'http://127.0.0.1:3210', close: async () => {} } : await startFixture(false, 3210);
let context: BrowserContext | undefined;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  const monitor = await context.newPage();
  const errors: string[] = [];
  monitor.on('pageerror', error => errors.push(error.message));
  await monitor.goto(`chrome-extension://${id}/recording.html`);
  const stored = () => worker.evaluate(async () => {
    const saved = await chrome.storage.local.get(['fixtureRecording', 'datasetRecording', 'fixtureRecordingLiveStash']) as Record<string, any>;
    return { live: saved.fixtureRecording, dataset: saved.datasetRecording, stash: saved.fixtureRecordingLiveStash };
  });
  const historyCount = () => worker.evaluate(() => new Promise<number>((done, fail) => {
    const request = indexedDB.open('cobrowser-action-history');
    request.onsuccess = () => { const db = request.result; if (!db.objectStoreNames.contains('events')) { done(0); return; } const count = db.transaction('events').objectStore('events').count(); count.onsuccess = () => done(count.result); count.onerror = () => fail(count.error); };
    request.onerror = () => fail(request.error);
  }));
  const countShown = (expected: number) => monitor.waitForFunction(count => Number(document.querySelector('#record-count')?.textContent) === count, expected);
  const toggleChecked = (expected: boolean) => monitor.waitForFunction(value => (document.querySelector('#dataset-toggle') as HTMLInputElement | null)?.checked === value, expected);

  // 1. Record a couple of live events first so there is something to stash and restore.
  await monitor.getByRole('button', { name: 'Start recording', exact: true }).click();
  await monitor.waitForFunction(() => document.querySelector('#recording-state')?.textContent === 'Recording is on');
  const tab = await context.newPage();
  await tab.goto(fixture.origin); await tab.bringToFront();
  await tab.locator('#probe').click(); await tab.locator('h1').click();
  await monitor.bringToFront();
  await monitor.waitForFunction(() => Number(document.querySelector('#record-count')?.textContent) >= 1);
  const live = (await stored()).live;
  assert.ok(live.sessionId && live.events.length >= 1, 'live events were recorded');
  const liveHistory = await historyCount();
  assert.ok(liveHistory >= live.events.length);

  // 2. A converted recording, shifted so its newest event is one minute old.
  const sample = JSON.parse(await readFile(samplePath, 'utf8'));
  const shift = Date.now() - 60_000 - Date.parse(sample.events.at(-1).at);
  const move = (iso: string) => new Date(Date.parse(iso) + shift).toISOString();
  sample.startedAt = move(sample.startedAt);
  for (const event of sample.events) event.at = move(event.at);
  for (const item of sample.tabs ?? []) item.observedAt = move(item.observedAt);
  const file = join(profile, 'dataset.json');
  await writeFile(file, JSON.stringify(sample));
  await monitor.locator('#dataset-file').setInputFiles(file);
  await toggleChecked(true);
  await countShown(sample.events.length);
  assert.equal(await monitor.locator('#recording-state').textContent(), 'Recording is paused');
  assert.equal(await monitor.locator('#dataset-error').textContent(), '');
  assert.equal(await monitor.locator('#dataset-tasks tr').count(), sample.tabs.length);
  let saved = await stored();
  assert.equal(saved.live.sessionId, sample.sessionId);
  assert.equal(saved.live.events.length, sample.events.length);
  assert.equal('source' in saved.live, false, 'converter metadata is not stored');
  assert.equal(saved.stash.sessionId, live.sessionId);
  assert.equal(saved.stash.events.length, live.events.length);
  assert.equal(saved.dataset.eventCount, sample.events.length);
  assert.equal(await historyCount(), liveHistory + sample.events.length, 'dataset events joined the action history');

  // 3. Live interaction while a dataset is loaded is not recorded into it.
  await tab.bringToFront(); await tab.locator('#probe').click(); await tab.locator('h1').click();
  await monitor.bringToFront();
  await monitor.waitForTimeout(1500);
  assert.equal((await stored()).live.events.length, sample.events.length);

  // 4. A file carrying a field the recorder never stores is rejected and changes nothing.
  const bad = join(profile, 'bad.json');
  await writeFile(bad, JSON.stringify({ ...sample, events: [{ ...sample.events[0], value: 'typed text must never be stored' }, ...sample.events.slice(1)] }));
  await monitor.locator('#dataset-file').setInputFiles(bad);
  await monitor.waitForFunction(() => (document.querySelector('#dataset-error')?.textContent ?? '').length > 0);
  const rejection = await monitor.locator('#dataset-error').textContent();
  assert.match(rejection ?? '', /^Event 0 /);
  assert.equal((await stored()).live.sessionId, sample.sessionId);

  // 5. Toggle off restores the live recording and removes the dataset's actions from history.
  await monitor.locator('#dataset-toggle').uncheck();
  await toggleChecked(false);
  await countShown(live.events.length);
  saved = await stored();
  assert.equal(saved.live.sessionId, live.sessionId);
  assert.equal(saved.dataset, undefined); assert.equal(saved.stash, undefined);
  assert.equal(await historyCount(), liveHistory);

  // 6. Start recording while a dataset is loaded restores live first, so capture never writes into dataset data.
  await monitor.locator('#dataset-file').setInputFiles(file);
  await toggleChecked(true);
  await monitor.getByRole('button', { name: 'Start recording', exact: true }).click();
  await monitor.waitForFunction(() => document.querySelector('#recording-state')?.textContent === 'Recording is on');
  await toggleChecked(false);
  saved = await stored();
  assert.notEqual(saved.live.sessionId, sample.sessionId);
  assert.equal(saved.live.events.length, live.events.length);
  assert.equal(saved.dataset, undefined); assert.equal(saved.stash, undefined);
  assert.equal(await historyCount(), liveHistory);
  assert.deepEqual(errors, []);

  await mkdir('.local/evidence', { recursive: true });
  const report = { mode: 'real-browser-dataset-toggle', extension: process.argv.includes('--raw') ? 'source' : 'built', sample: samplePath, datasetEvents: sample.events.length, datasetTabs: sample.tabs.length,
    liveEventsBefore: live.events.length, liveRestoredOnToggleOff: true, liveRestoredOnStartRecording: true, liveCaptureBlockedWhileLoaded: true, badFileRejected: rejection, historyRestored: true, pageErrors: errors };
  await writeFile('.local/evidence/dataset-toggle.json', JSON.stringify(report, null, 2));
  console.log(`Dataset toggle verified: ${sample.events.length} dataset events across ${sample.tabs.length} tabs loaded and unloaded; ${live.events.length} live events restored twice; bad file rejected ("${rejection}"). Evidence: .local/evidence/dataset-toggle.json`);
} finally {
  await context?.close();
  await fixture.close();
  await rm(profile, { recursive: true, force: true });
}
