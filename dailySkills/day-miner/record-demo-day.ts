// Produces a labeled "day" of real recorder data by driving the fixture sites in the built extension, then exports it.
// Output: data/recordings/demo-day.json (the recorder's Export JSON, full action history).
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixture } from '../../apps/fixture-site/server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const extension = join(root, 'apps/extension/.output/chrome-mv3');
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data/recordings/demo-day.json');
const reports = createServer((_req, res) => res.end(`<!doctype html><html><head><title>Team reports</title></head><body>
<h1>Reports</h1><label>Team <select><option>Red</option><option>Blue</option></select></label><button type="button" onclick="document.querySelector('#editor').hidden=false">Open report</button>
<section id="editor" hidden><label>Report title <input id="title" type="text"></label>
<button type="button" onclick="document.querySelector('output').textContent='Preview: '+document.querySelector('input').value">Preview report</button></section><output></output></body></html>`));
await new Promise<void>(done => reports.listen(0, '127.0.0.1', done));
const reportsOrigin = `http://127.0.0.1:${(reports.address() as { port: number }).port}`;
const fixture = await startFixture(false, 0);
const profile = await mkdtemp(join(tmpdir(), 'cobrowser-demo-day-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, acceptDownloads: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const send = (kind: string, args = {}) => popup.evaluate(message => (globalThis as any).chrome.runtime.sendMessage(message), { kind, ...args });
  if (!(await send('recording:start')).ok) throw new Error('recording did not start');
  const page = await context.newPage();
  const pause = (ms: number) => page.waitForTimeout(ms);
  const exportWeek = async (team: 'red' | 'blue', start?: string, end?: string) => {
    await page.goto(fixture.origin); await page.bringToFront(); await pause(300);
    await page.locator('#team').selectOption(team);
    if (start) { const field = page.locator('#start'); await field.click(); await field.press('ControlOrMeta+A'); await field.pressSequentially(start); await field.press('Tab'); }
    if (end) { const field = page.locator('#end'); await field.click(); await field.press('ControlOrMeta+A'); await field.pressSequentially(end); await field.press('Tab'); }
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    await download; await pause(700);
  };
  const previewReport = async (team: 'Red' | 'Blue', title: string) => {
    await page.goto(reportsOrigin); await page.bringToFront(); await pause(300);
    await page.locator('select').selectOption(team);
    await page.getByRole('button', { name: 'Open report', exact: true }).click(); await pause(200);
    await page.locator('#title').fill(title);
    await page.getByRole('button', { name: 'Preview report', exact: true }).click(); await pause(700);
  };
  // A plausible day: the weekly export done twice for different teams, a report preview twice, a reset in between, some browsing.
  await exportWeek('blue', '2026-10-26', '2026-11-02'); await pause(1200);
  await previewReport('Blue', 'Weekly summary'); await pause(1500);
  await page.goto(fixture.origin); await page.bringToFront(); await pause(300);
  await page.getByRole('button', { name: 'Reset filters ↺', exact: true }).click(); await pause(400);
  await page.locator('#team').selectOption('blue'); await pause(900);
  await exportWeek('red', '2026-10-19', '2026-10-26'); await pause(1200);
  await previewReport('Red', 'Incident review'); await pause(800);
  await page.goto(fixture.origin); await page.bringToFront(); await pause(300);
  await page.locator('#probe').fill('scratch note'); await page.locator('#team').click(); await pause(600);
  for (let attempt = 0; attempt < 30; attempt++) { const status = await send('recording:status'); if (status.value.events.filter((event: any) => ['click', 'change'].includes(event.kind)).length >= 18) break; await pause(200); }
  const exported = (await send('recording:export')).value;
  const state = { schemaVersion: 1, sessionId: exported.sessionId, startedAt: exported.startedAt, events: exported.events, tabs: exported.tabs ?? [], tabCount: exported.tabCount ?? 0, dropped: exported.dropped ?? 0,
    source: { dataset: 'recorded-demo-day', fixture: fixture.origin, reports: reportsOrigin, note: 'Real recorder output from the built extension driving two local fixture sites.' } };
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(state, null, 2));
  const kinds = state.events.reduce((acc: Record<string, number>, event: any) => ({ ...acc, [event.kind]: (acc[event.kind] ?? 0) + 1 }), {});
  console.log(`Recorded demo day: ${state.events.length} events (${Object.entries(kinds).map(([kind, count]) => `${kind} ${count}`).join(', ')}), labeled targets on ${state.events.filter((event: any) => event.target).length}. Written to ${out}`);
} finally {
  await context.close(); await fixture.close(); reports.closeAllConnections(); await new Promise<void>(done => reports.close(() => done())); await rm(profile, { recursive: true, force: true });
}
