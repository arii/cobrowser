import { chromium } from 'playwright';
import { startFixture } from '../apps/fixture-site/server.js';
import { inspectCSV, previousWeek, type Task } from '../services/verifier/oracle.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

await mkdir('.local/evidence', { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const task of [
    { team: 'red', asOf: '2026-11-07T20:00:00Z', timezone: 'America/Los_Angeles' },
    { team: 'blue', asOf: '2026-11-02T00:30:00Z', timezone: 'America/Los_Angeles' },
    { team: 'blue', asOf: '2026-11-02T00:30:00Z', timezone: 'Asia/Tokyo' },
  ] satisfies Task[]) for (const mutation of [false, true]) {
    const fixture = await startFixture(mutation);
    const context = await browser.newContext({ acceptDownloads: true, timezoneId: task.timezone });
    try {
      await context.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(fixture.origin);
      const range = previousWeek(task);
      // This is an artifact feasibility driver, not a learned candidate/runtime claim.
      await page.locator('[name=team]').selectOption(task.team);
      await page.locator('[name=start]').fill(range.start);
      await page.locator('[name=end]').fill(range.end);
      const download = page.waitForEvent('download');
      await page.locator('#export').click();
      const file = await download;
      const stem = `${task.team}-${task.timezone.replaceAll('/', '-')}-${mutation ? 'wrong-week' : 'correct'}`;
      await file.saveAs(`.local/evidence/${stem}.csv`);
      const bytes = await readFile(`.local/evidence/${stem}.csv`);
      const report = inspectCSV(bytes, task);
      const status = await page.locator('#status').innerText();
      assert.equal(status, 'Export successful');
      assert.equal(report.verdict, mutation ? 'failed' : 'passed');
      assert.equal(fixture.audit.length, 1);
      await page.screenshot({ path: `.local/evidence/${stem}.png` });
      results.push({ task, mutation: mutation ? 'wrong-week-demo' : 'none', status, ...report, audit: fixture.audit,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    } finally { await context.close(); await fixture.close(); }
  }
  const result = { mode: 'live-local-fixture', browser: browser.version(), isolation: 'fresh context; fixture-only routed page traffic; no Docker security sandbox', results };
  await writeFile('.local/evidence/verifier.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
