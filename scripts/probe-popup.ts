import { chromium } from 'playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';

const profile = await mkdtemp(join(tmpdir(), 'harness-popup-'));
const fixture = await startFixture(false, 3210);
const extension = resolve(process.argv.includes('--built') ? 'apps/extension/.output/chrome-mv3' : 'apps/extension');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const pageErrors: string[] = [];
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(pathToFileURL(resolve('apps/extension/popup.html')).href);
  assert.equal(await page.locator('#setup').isVisible(), true);
  assert.equal(await page.locator('button:disabled').count(), 5);
  assert.match(await page.locator('#status').innerText(), /Extension APIs are unavailable/);

  await page.goto(`chrome-extension://${id}/popup.html`);
  await page.waitForFunction(() => document.getElementById('status')?.textContent?.startsWith('Ready.'));
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
  assert.deepEqual(pageErrors, []);
  const report = { mode: 'live-extension-popup-UI', directFile: 'setup instructions visible; all five controls disabled', results,
    inputValue: await agent.locator('#probe').inputValue(), missingNativeHost: 'visible progress then native-timeout with setup guidance', pageErrors };
  await mkdir('.local/evidence', { recursive: true });
  await writeFile('.local/evidence/popup-ui.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await context.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }); }
