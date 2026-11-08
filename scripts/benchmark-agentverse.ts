import { mkdir, writeFile } from 'node:fs/promises';
// Live ASI:One benchmark for the hackathon task set.
// Usage: ASI1_API_KEY=... npx tsx scripts/benchmark-agentverse.ts
// test.py is a selenium recorder, not a uAgent: untouched by design.
// services/verifier/oracle.ts exports only Task/previousWeek/inspectCSV for
// weekly CSV exports: no chat-grading interface, so checks below are inline.
// Writes only .local/evidence/agentverse-live.json (gitignored); never docs/.
const ENDPOINT = 'https://api.asi1.ai/v1/chat/completions';
const AS_OF = '2026-11-07';
const AS_OF_YEAR = 2026;
const PROMPTS = [
  { id: 'sf-hackathons', prompt: 'List upcoming San Francisco hackathons with dates. Today is November 7, 2026.' },
  { id: 'sf-weather', prompt: 'What is the San Francisco weather right now in Fahrenheit, and should I wear a jacket?' },
  { id: 'asics-cheapest', prompt: "Find the cheapest Asics men's running shoes, size 8.5, with price and store." },
  { id: 'linkedin-reply', prompt: 'Draft a short professional reply to this LinkedIn recruiter message: "Hi! I came across your profile and think you would be a great fit for a senior agent-infra role at our startup. Open to a 15-min chat next week?" Keep it under 80 words.' },
  { id: 'discord-summary', prompt: 'Summarize these Discord messages into 3 action items: "alice: standup moved to 9:30 / bob: can someone review PR #123 by EOD? / cara: hackathon demo rehearsal Thursday 4pm, bring your laptop".' },
  { id: 'grocery-list', prompt: 'Build a grocery list for 4 dinners for 2 people under $60 total, with estimated prices per item. Today is November 7, 2026.' },
  { id: 'job-application', prompt: 'List the key requirements for a "Senior AI Engineer, Agents" job post and draft 3 bullet points tailoring a candidate with browser-agent and eval experience.' },
] as const;
// Pure check: stale-year mentions (observed failure: May/Jun/Sep/Oct 2025
// events returned on Nov 7 2026). Any year before asOfYear means stale.
export function checkTemporalFreshness(text: string, asOfYear = AS_OF_YEAR): { stale: boolean; hits: string[] } {
  const hits = [...text.matchAll(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|\b(19|20)\d{2}\b/gi)]
    .map((m) => m[0]);
  const stale = hits.some((h) => {
    const years = h.match(/\b(19|20)\d{2}\b/g) ?? [];
    return years.some((y) => Number(y) < asOfYear);
  });
  return { stale, hits };
}
// Pure check: Fahrenheit presence + jacket advice (observed: 18.1C first,
// needed a 2nd turn for 64.6F + jacket). Single-turn pass needs both.
export function checkFahrenheitCompliance(text: string): { hasFahrenheit: boolean; hasJacketAdvice: boolean; passed: boolean } {
  const hasFahrenheit = /-?\d+(?:\.\d+)?\s*(?:°F|\bF\b|degrees?\s+F(?:ahrenheit)?|Fahrenheit)/i.test(text);
  const hasJacketAdvice = /jacket/i.test(text);
  return { hasFahrenheit, hasJacketAdvice, passed: hasFahrenheit && hasJacketAdvice };
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing-${name}`);
  return value;
}
async function chat(prompt: string, key: string, model: string): Promise<{ text: string; latencyMs: number }> {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch { throw new Error('provider-network-or-timeout'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`provider-http-${response.status}`); }
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.length;
    if (length > 1024 * 1024) { await reader.cancel(); throw new Error('response-size-limit'); }
    chunks.push(next.value);
  }
  let raw: unknown;
  try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('provider-invalid-json'); }
  const text = (raw as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new Error('asi1-invalid-envelope');
  return { text, latencyMs: Math.round(performance.now() - started) };
}
const key = required('ASI1_API_KEY');
const model = process.env.ASI1_MODEL ?? 'asi1-mini';
const results = [];
for (const { id, prompt } of PROMPTS) {
  try {
    const { text, latencyMs } = await chat(prompt, key, model);
    const temporal = checkTemporalFreshness(text);
    const units = id === 'sf-weather' ? checkFahrenheitCompliance(text) : null;
    results.push({ id, prompt, output: text, latencyMs, chars: text.length, temporal, units });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'unknown';
    const safe = /^(missing-[A-Z0-9_]+|provider-[a-z0-9-]+|asi1-[a-z-]+|response-size-limit)$/.test(code) ? code : 'invalid-response-or-local-error';
    results.push({ id, prompt, output: null, latencyMs: null, chars: null, reason: safe });
  }
}
await mkdir('.local/evidence', { recursive: true });
const payload = { asOf: AS_OF, endpoint: ENDPOINT, model, results };
await writeFile('.local/evidence/agentverse-live.json', JSON.stringify(payload, null, 2));
console.log(JSON.stringify(payload, null, 2));
if (results.some((r) => !('output' in r) || r.output === null)) process.exitCode = 2;
