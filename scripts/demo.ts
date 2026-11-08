import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { startFixture } from '../apps/fixture-site/server.js';
import { inspectCSV, previousWeek, type Task } from '../services/verifier/oracle.js';

const headless = process.argv.includes('--headless');
const evidence = '.local/evidence';
const task: Task = { team: 'red', asOf: '2026-11-07T20:00:00Z', timezone: 'America/Los_Angeles' };
const range = previousWeek(task);
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
await mkdir(evidence, { recursive: true });
const fixtures: Awaited<ReturnType<typeof startFixture>>[] = [];
const results: { name: string; mutation: string; origin: string; pageClaim: string; sha256: string; report: ReturnType<typeof inspectCSV> }[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let dashboard: ReturnType<typeof createServer> | undefined;
try {
  fixtures.push(await startFixture(false));
  fixtures.push(await startFixture(true));
  browser = await chromium.launch({ headless });
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: task.timezone, viewport: { width: 1440, height: 1000 } });
  const pageErrors: string[] = [];
  context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
  for (const [index, fixture] of fixtures.entries()) {
    const page = await context.newPage();
    await page.goto(fixture.origin);
    await page.evaluate(label => { document.title = `${label} · ${document.title}`; }, index === 0 ? 'Correct export' : 'Wrong-week mutation');
    await page.locator('[name=team]').selectOption(task.team);
    await page.locator('[name=start]').fill(range.start);
    await page.locator('[name=end]').fill(range.end);
    const downloading = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await downloading;
    const name = index === 0 ? 'correct' : 'wrong-week';
    const file = `${evidence}/demo-${name}.csv`;
    await download.saveAs(file);
    const bytes = await readFile(file);
    const report = inspectCSV(bytes, task);
    const pageClaim = await page.locator('#status').innerText();
    assert.equal(pageClaim, 'Export successful');
    assert.equal(report.verdict, index === 0 ? 'passed' : 'failed');
    assert.equal(fixture.audit.length, 1);
    await page.screenshot({ path: `${evidence}/demo-${name}.png`, fullPage: true });
    results.push({ name, mutation: index === 0 ? 'none' : 'wrong-week-demo', origin: fixture.origin, pageClaim, sha256: createHash('sha256').update(bytes).digest('hex'), report });
  }
  assert.deepEqual(pageErrors, [], 'Fixture pages must have no uncaught JavaScript errors');
  const report = { mode: 'live-local-synthetic-fixtures', automatedChecks: 'passed', task, results, pageErrors,
    scope: 'Real browser downloads inspected against a separately authored oracle. Public synthetic data; no learned skill, cloud calls, or promotion claim.' };
  await writeFile(`${evidence}/demo.json`, JSON.stringify(report, null, 2));
  const rows = (csv: string) => csv.trim().split('\n').slice(1).map(line => `<tr>${line.split(',').map(cell => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('');
  const table = (csv: string) => `<table><thead><tr><th>Team</th><th>Date</th><th>Value</th></tr></thead><tbody>${rows(csv)}</tbody></table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cobrowser · Test demo</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f5f2;color:#202c30;font:15px/1.55 system-ui,sans-serif}main{max-width:1240px;margin:auto;padding:36px 28px}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #d8ddd8;padding-bottom:22px}.brand{font-weight:750;letter-spacing:-.5px;font-size:21px}.badge{font-size:12px;background:#e4eee6;color:#2d6141;border-radius:30px;padding:7px 12px}h1{font-size:46px;line-height:1.1;letter-spacing:-2px;max-width:770px;margin:38px 0 15px}p{color:#606b6f;max-width:780px}.contract{padding:18px 22px;background:#263c36;color:#e7f3ec;border-radius:12px;margin:28px 0;display:flex;gap:38px;flex-wrap:wrap}.contract strong{display:block;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#a5c4b3}.cards{display:grid;grid-template-columns:1fr 1fr;gap:22px}.card{background:white;border:1px solid #dce1da;border-radius:14px;overflow:hidden}.cardhead{padding:23px 25px 18px;border-bottom:1px solid #e5e9e3}h2{font-size:21px;letter-spacing:-.5px;margin:8px 0}.result{font-size:12px;font-weight:750;letter-spacing:1px;color:#2b754a}.failed{color:#ad4d2c}.cardhead p{margin:5px 0}.tables{padding:12px 25px 22px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 5px;border-bottom:1px solid #eef0ec}th{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#6a7678}a{color:#214f43;text-underline-offset:4px}details{margin-top:16px;font-size:13px}summary{cursor:pointer;font-weight:600}.links{display:flex;gap:20px;flex-wrap:wrap;margin:26px 0}footer{font-size:12px;color:#78817f;border-top:1px solid #d8ddd8;padding-top:20px}code{background:#e9ece6;border-radius:4px;padding:2px 5px}@media(max-width:760px){.cards{grid-template-columns:1fr}h1{font-size:36px}.contract{gap:16px}}
  </style></head><body><main><header><span class="brand">◈ cobrowser / test lab</span><span class="badge">2 / 2 checks passed · Local synthetic data</span></header><h1>A success message isn't proof.</h1><p>Two real CSV downloads. Both pages say “Export successful.” The verifier checks the actual bytes against the requested week and catches the deliberately incorrect report.</p><section class="contract" aria-label="Task contract"><span><strong>Requested report</strong>Red team · Previous calendar week</span><span><strong>Inclusive start → exclusive end</strong>${range.start} → ${range.end}</span><span><strong>Timezone</strong>${task.timezone}</span></section><section class="cards">${results.map((item, index) => `<article class="card"><div class="cardhead"><span class="result ${index ? 'failed' : ''}">${index ? 'MUTATION CAUGHT' : 'ARTIFACT VERIFIED'}</span><h2>${index ? 'Wrong week. Detected.' : 'Right team. Right week.'}</h2><p>Page claim: <strong>${escape(item.pageClaim)}</strong></p><p>Artifact verdict: <strong>${escape(item.report.verdict)}</strong> · ${index ? 'Exact rows differ from the contract.' : 'Schema and all seven rows match.'}</p></div><div class="tables">${table(item.report.actual)}${index ? `<details><summary>Compare with expected rows</summary>${table(item.report.expected)}</details>` : ''}<details><summary>Inspect saved evidence</summary><p>SHA-256: <code style="overflow-wrap:anywhere">${item.sha256}</code></p><a href="/demo-${item.name}.csv" download>Download inspected CSV</a></details></div></article>`).join('')}</section><nav class="links" aria-label="Explore the demo"><a href="${fixtures[0]!.origin}" target="_blank" rel="noopener">Try the reporting workspace ↗</a><a href="${fixtures[1]!.origin}" target="_blank" rel="noopener">Try the wrong-week fixture ↗</a><a href="/demo.json" target="_blank" rel="noopener">View machine-readable evidence ↗</a></nav><footer>Fixed task time: ${task.asOf}. Automated setup used Playwright to submit the forms and inspect real downloads. These are public fixtures and a separately authored oracle, not a learned workflow or hidden evaluation. Results above are the saved startup checks; manual exports do not refresh them. Close the browser to stop the demo.</footer></main></body></html>`;
  dashboard = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html); return; }
    if (path === '/demo.json') { res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(report, null, 2)); return; }
    const item = results.find(result => path === `/demo-${result.name}.csv`);
    if (item) { res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="demo-${item.name}.csv"` }).end(item.report.actual); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => { dashboard!.once('error', reject); dashboard!.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${(dashboard.address() as { port: number }).port}`;
  const summary = await context.newPage();
  await summary.goto(origin);
  await summary.screenshot({ path: `${evidence}/demo.png`, fullPage: true });
  console.log(`Demo verified: correct export passed; wrong-week export rejected.${headless ? '' : `\nReview: ${origin}`}\nEvidence: ${evidence}/demo.json\nScreenshot: ${evidence}/demo.png${headless ? '' : '\nClose this browser to stop.'}`);
  if (!headless) {
    const stop = () => { void browser?.close(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try { await new Promise<void>(resolve => browser!.once('disconnected', () => resolve())); }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
} finally {
  await browser?.close();
  if (dashboard?.listening) await new Promise<void>((resolve, reject) => dashboard!.close(error => error ? reject(error) : resolve()));
  for (const fixture of fixtures) await fixture.close();
}
