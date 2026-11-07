import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { llama, snap, type Mode, type Replay } from '../packages/model-adapters/index.js';
const mode: Mode = process.argv.includes('--live') ? 'live' : 'replay';
await mkdir('.local/evidence', { recursive: true });
const browser = await chromium.launch();
let bytes: Buffer;
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 160 } });
  await page.setContent('<body style="margin:0;background:red;color:white;font:bold 60px monospace;display:grid;place-items:center">PHASE0</body>');
  bytes = await page.screenshot({ path: '.local/evidence/synthetic-model.png' });
} finally { await browser.close(); }
const replay = JSON.parse(await readFile('tests/fixtures/model-replay.json', 'utf8')) as Replay;
const image = { mediaType: 'image/png' as const, base64: bytes.toString('base64') };
const results = [];
// Independent calls: a missing Llama prerequisite never suppresses the Snap check.
for (const [provider, call] of [['llama', () => llama(mode, image, replay)], ['snap', () => snap(mode, [image], replay)]] as const) {
  try { results.push({ provider, result: await call() }); }
  catch (e) {
    // Adapter errors are fixed local codes; arbitrary network/provider bodies never logged.
    const code = e instanceof Error ? e.message : 'unknown';
    const safe = /^(missing-[A-Z_]+|cloud-processing-disabled|unsupported-LLAMA_SCHEMA|configured-model-is-not-declared-llama|unsafe-endpoint|provider-[a-z0-9-]+|llama-[a-z-]+|snap-[a-z-]+|response-size-limit)$/.test(code) ? code : 'invalid-response-or-local-error';
    const prerequisites = provider === 'llama' ? ['LLAMA_SCHEMA','LLAMA_ENDPOINT','LLAMA_MODEL','LLAMA_API_KEY'] : ['SUBQ_API_KEY'];
    results.push({ provider, mode, verdict: 'inconclusive', reason: safe, missing: prerequisites.filter(name=>!process.env[name]) });
  }
}
await writeFile(`.local/evidence/models-${mode}.json`, JSON.stringify({ mode, results }, null, 2));
console.log(JSON.stringify({ mode, results }, null, 2));
if (mode === 'live' && results.some(r => !('result' in r) || !r.result?.capabilityPassed)) process.exitCode = 2;
