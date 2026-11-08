/// <reference types="chrome" />
// One-shot real-browser check: a day-miner skill imports inactive with no blockers (outcome block), the literal agent
// fails when the export button is renamed, and the intent agent completes the same skill with a real CSV download.
import { chromium, type Download } from 'playwright';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';
import { inspectCSV } from '../services/verifier/oracle.js';
import { mutate } from '../dailySkills/harness/mutations.js';

const fixture = await startFixture(false, 0, mutate('rename-export'));
const profile = await mkdtemp(join(tmpdir(), 'cobrowser-intent-'));
const extension = resolve(process.argv.includes('--raw') ? 'apps/extension' : 'apps/extension/.output/chrome-mv3');
const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, acceptDownloads: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
const downloads: Download[] = [];
context.on('page', page => page.on('download', download => downloads.push(download)));
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = worker.url().split('/')[2];
  const popup = await context.newPage();
  const errors: string[] = []; popup.on('pageerror', error => errors.push(error.message));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const send = (kind: string, args = {}) => popup.evaluate(message => (globalThis as any).chrome.runtime.sendMessage(message), { kind, ...args });
  const waitRun = async (settled = ['finished', 'failed', 'cancelled', 'interrupted']) => { let run: any; for (let i = 0; i < 300; i++) { await popup.waitForTimeout(100); run = (await send('skills:list')).value.run; if (run && settled.includes(run.status)) break; } return run; };

  // 1. Import a skill shaped like the day miner's output: outcome block, per-step intents, recorded (now stale) labels.
  const mined = {
    title: 'Export weekly team CSV', summary: 'Exports the weekly CSV report for a team and week.', whenToUse: 'When a team needs its weekly report file.',
    origin: fixture.origin, sites: [{ id: 'main', url: `${fixture.origin}/` }],
    steps: [
      { kind: 'change', siteId: 'main', target: { tag: 'SELECT', label: 'Team', type: '' }, parameter: 'input_1', intent: 'Choose the team the report is for', parameterDescription: 'The team name, red or blue.' },
      { kind: 'change', siteId: 'main', target: { tag: 'INPUT', label: 'Start inclusive', type: '' }, parameter: 'input_2', intent: 'Set the first day of the reporting week', parameterDescription: 'First day of the week, YYYY-MM-DD.' },
      { kind: 'change', siteId: 'main', target: { tag: 'INPUT', label: 'End exclusive', type: '' }, parameter: 'input_3', intent: 'Set the day after the last day of the reporting week', parameterDescription: 'Day after the last day, YYYY-MM-DD.' },
      { kind: 'click', siteId: 'main', target: { tag: 'BUTTON', label: 'Export CSV', type: 'submit' }, parameter: null, intent: 'Download the CSV report for the selected team and week' },
    ],
    outcome: { kind: 'download', description: 'The CSV report downloads and the page confirms the export.', check: { textIncludes: 'Export successful' } },
    examples: [{ at: new Date().toISOString(), eventIds: ['e1', 'e2', 'e3', 'e4'], effect: 'form-submitted' }], evidenceIds: ['e1', 'e2', 'e3', 'e4'],
    reusability: { reusable: true, confidence: 0.9, source: 'model', reason: 'Repeated twice during the day.' }, generator: { provider: 'llama', model: 'test', promptVersion: 'day-miner-v1' },
  };
  const imported = await send('skills:import', { skills: [mined] });
  assert.equal(imported.ok, true, JSON.stringify(imported));
  const skill = imported.value.skills.find((item: any) => item.title === mined.title);
  assert.ok(skill, 'imported skill is listed');
  assert.deepEqual(skill.blockers, [], `outcome block must satisfy the gate: ${skill.blockers}`);
  assert.equal(skill.active, false); assert.equal(skill.learnedBy, 'day-miner');
  assert.equal((await send('skills:import', { skills: [mined] })).ok, false, 'duplicate import is refused');
  assert.equal((await send('skills:activate', { id: skill.id, active: true, reviewed: true })).ok, true);

  // 2. Literal agent: exact label match cannot find the renamed button, so the recovery flow pauses for help before any dispatch of that step.
  const parameters = { input_1: 'blue', input_2: '2026-10-26', input_3: '2026-11-02' };
  assert.equal((await send('skills:run', { id: skill.id, parameters })).ok, true);
  const literal = await waitRun(['needs_input', 'finished', 'failed', 'cancelled', 'interrupted']);
  assert.equal(literal.status, 'needs_input', JSON.stringify(literal)); assert.equal(literal.completed, 3); assert.match(literal.issue ?? literal.message, /missing|ambiguous/i);
  assert.equal(downloads.length, 0);
  assert.equal((await send('skills:cancel')).ok, true);
  let cancelled: any;
  for (let i = 0; i < 100; i++) { await popup.waitForTimeout(100); cancelled = (await send('skills:list')).value.run; if (cancelled?.finishedAt) break; }
  assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled));
  await popup.waitForTimeout(300); // the run's finally block releases the executor after it records finishedAt
  await worker.evaluate(ids => (globalThis as any).chrome.tabs.remove(ids).catch(() => {}), literal.tabIds);

  // 3. Intent agent with a deterministic stand-in for the step model: picks the on-page control closest to the step's intent.
  // tsx keeps function names, so serialized callbacks reference esbuild's __name helper; define it in the worker first.
  await worker.evaluate(() => { (globalThis as any).__name ??= (fn: unknown) => fn; });
  await worker.evaluate(() => {
    (globalThis as any).__steps = [];
    (globalThis as any).chrome.runtime.sendNativeMessage = async (_host: string, message: any) => {
      (globalThis as any).__steps.push(message);
      if (message.kind !== 'skill-step') throw new Error('unexpected native message');
      const intent = String(message.step.intent).toLowerCase(), recorded = String(message.step.recordedTarget?.label ?? '').toLowerCase();
      const inputs = ['INPUT', 'SELECT', 'TEXTAREA'];
      const candidates = message.page.controls.filter((item: any) => message.step.kind === 'click' ? !inputs.includes(item.target.tag) : inputs.includes(item.target.tag));
      const score = (item: any) => { const label = item.target.label.toLowerCase(); let points = label === recorded ? 10 : 0; for (const word of intent.split(/\W+/)) if (word.length > 3 && label.includes(word)) points += 2; if (/download|export/.test(label) && /download|export|report/.test(intent)) points += 3; return points; };
      const best = candidates.map((item: any) => ({ item, points: score(item) })).sort((a: any, b: any) => b.points - a.points)[0];
      if (!best || best.points <= 0) return { v: 1, kind: 'skill-step-result', seq: message.seq, decision: { action: 'needs_input', target: null, value: null, explanation: 'No matching control.', question: 'Which control should be used?' } };
      const values: Record<string, string> = { Team: 'blue', 'Start inclusive': '2026-10-26', 'End exclusive': '2026-11-02' };
      return { v: 1, kind: 'skill-step-result', seq: message.seq, decision: { action: 'act', target: best.item.target, value: message.step.kind === 'change' ? values[best.item.target.label] ?? '' : null, explanation: `Chose "${best.item.target.label}" for "${message.step.intent}".`, question: null } };
    };
  });
  const startedIntent = await send('skills:run', { id: skill.id, agent: 'intent', instruction: 'Export the blue team CSV for the previous calendar week.' });
  assert.equal(startedIntent.ok, true, JSON.stringify(startedIntent));
  const intent = await waitRun();
  assert.equal(intent.status, 'finished', JSON.stringify(intent)); assert.equal(intent.completed, 4); assert.equal(intent.agent, 'intent');
  assert.equal(intent.decisions.length, 4); assert.equal(intent.decisions[3].label, 'Download report');
  for (let i = 0; i < 30 && !downloads.length; i++) await popup.waitForTimeout(100);
  assert.equal(downloads.length, 1, 'the intent run produced one download');
  const report = inspectCSV(await readFile((await downloads[0].path())!), { team: 'blue', asOf: '2026-11-07T20:00:00Z', timezone: 'America/Los_Angeles' });
  assert.equal(report.verdict, 'passed', report.actual);
  assert.deepEqual(fixture.audit.at(-1), { team: 'blue', start: '2026-10-26', end: '2026-11-02' });
  const requests = await worker.evaluate(() => (globalThis as any).__steps.map((item: any) => ({ kind: item.kind, step: item.skill.step, controls: item.page.controls.length, hasText: item.page.text.length > 0 })));
  assert.equal(requests.length, 4); assert.ok(requests.every((item: any) => item.controls > 0 && item.hasText));
  assert.deepEqual(errors, []);
  await mkdir('.local/evidence', { recursive: true });
  await writeFile('.local/evidence/intent-agent.json', JSON.stringify({ mode: 'real isolated browser, renamed export button, deterministic step-model stub', imported: { blockers: skill.blockers, active: skill.active, learnedBy: skill.learnedBy }, literal: { status: literal.status, completed: literal.completed, issue: literal.issue ?? literal.message, thenCancelled: cancelled.status }, intent: { status: intent.status, completed: intent.completed, decisions: intent.decisions }, csv: report.verdict, audit: fixture.audit.at(-1), stepRequests: requests }, null, 2));
  console.log(`Intent agent verified: mined skill imported with no blockers; literal replay paused for help at step 4 on the renamed button ("${literal.issue ?? literal.message}"); intent replay finished 4/4 choosing "${intent.decisions[3].label}", CSV passed the oracle for blue 2026-10-26→2026-11-02. Evidence: .local/evidence/intent-agent.json`);
} finally { await context.close(); await fixture.close(); await rm(profile, { recursive: true, force: true }); }
