// Skill-format test harness: cases × formats × mutations through the real playback agent, graded by ground truth.
import { mkdir, writeFile } from 'node:fs/promises';
import { startFixture } from '../../apps/fixture-site/server.js';
import { inspectCSV } from '../../services/verifier/oracle.js';
// @ts-expect-error Legacy extension JavaScript has no declaration file.
import { skillIssues } from '../../apps/extension/skill-learning.js';
import { CASES, type Case } from './cases.js';
import { build, FORMATS, type FormatId } from './formats.js';
import { MUTATIONS, mutate, type MutationId } from './mutations.js';
import { ExtensionExecutor, downloadBytes } from './executor-extension.js';

type Verdict = 'pass' | 'wrong-result' | 'failed' | 'gate-blocked' | 'timeout';
interface Result {
  case: string; format: FormatId; mutation: MutationId; executor: 'extension';
  gate: string[]; proposedGate: string[];
  verdict: Verdict; status: string | null; completed: number; total: number; message: string | null;
  checks: Record<string, boolean | string>; durationMs: number;
}

const only = (flag: string) => { const index = process.argv.indexOf(flag); return index >= 0 ? process.argv[index + 1]?.split(',') : undefined; };
const caseFilter = only('--case'), formatFilter = only('--format'), mutationFilter = only('--mutation');
const OUTCOME_RULE = 'This workflow does not end with a supported result action.';

async function grade(testCase: Case, result: Awaited<ReturnType<ExtensionExecutor['run']>>, audit: { team: string; start: string; end: string }[], executor: ExtensionExecutor) {
  const checks: Record<string, boolean | string> = {};
  if (testCase.truth.csv) {
    const download = result.downloads.at(-1);
    if (!download) checks.csv = 'no download';
    else { const report = inspectCSV(await downloadBytes(download), testCase.truth.csv); checks.csv = report.verdict === 'passed' ? true : `oracle ${report.verdict}`; }
  }
  if (testCase.truth.audit) {
    const last = audit.at(-1);
    checks.audit = last ? JSON.stringify(last) === JSON.stringify(testCase.truth.audit) || `server saw ${JSON.stringify(last)}` : 'server saw no export';
  }
  if (testCase.truth.activity && result.run?.tabId) {
    const text = await executor.readTab<string>(result.run.tabId, "()=>document.querySelector('#activity')?.textContent??''");
    checks.activity = (text ?? '').includes(testCase.truth.activity) || `page said "${text}"`;
  }
  return checks;
}

const executor = await ExtensionExecutor.launch(process.argv.includes('--raw'));
const results: Result[] = [];
try {
  for (const testCase of CASES.filter(item => !caseFilter || caseFilter.includes(item.id))) {
    for (const mutation of MUTATIONS.filter(item => !mutationFilter || mutationFilter.includes(item.id))) {
      for (const format of FORMATS.filter(item => !formatFilter || formatFilter.includes(item))) {
        const fixture = await startFixture(false, 0, mutate(mutation.id));
        try {
          const skill: any = build(format, testCase, fixture.origin);
          const gate: string[] = skillIssues(skill);
          const proposedGate = skill.outcome ? gate.filter(issue => issue !== OUTCOME_RULE) : gate;
          const values = Object.fromEntries(testCase.steps.filter(step => step.param).map(step => [step.target.label, step.param!.value]));
          const parameters = testCase.inputs === 'overrides' ? Object.fromEntries(skill.steps.filter((step: any) => step.parameter).map((step: any) => [step.parameter, values[step.target.label]])) : {};
          await executor.seed(skill);
          await executor.stubModel(values);
          const outcome = await executor.run(skill.id, { instruction: testCase.intent, parameters, expectDownload: testCase.outcome.kind === 'download' });
          let verdict: Verdict, checks: Record<string, boolean | string> = {};
          if (!outcome.started.ok) verdict = 'gate-blocked';
          else if (outcome.timedOut) verdict = 'timeout';
          else if (outcome.run?.status !== 'finished') verdict = 'failed';
          else { checks = await grade(testCase, outcome, fixture.audit, executor); verdict = Object.values(checks).every(value => value === true) ? 'pass' : 'wrong-result'; }
          const record: Result = { case: testCase.id, format, mutation: mutation.id, executor: 'extension', gate, proposedGate, verdict, status: outcome.run?.status ?? null,
            completed: outcome.run?.completed ?? 0, total: skill.steps.length, message: outcome.started.ok ? outcome.run?.message ?? null : outcome.started.error ?? null, checks, durationMs: outcome.durationMs };
          results.push(record);
          console.log(`${testCase.id.padEnd(28)} ${mutation.id.padEnd(15)} ${format.padEnd(8)} ${verdict.padEnd(13)} ${record.completed}/${record.total} ${record.message ?? ''}`);
          await executor.closeTabs(outcome.run?.tabIds ?? []);
        } finally { await fixture.close(); }
      }
    }
  }
} finally { await executor.close(); }

const symbol: Record<Verdict, string> = { pass: '✅', 'wrong-result': '❗', failed: '❌', 'gate-blocked': '⛔', timeout: '⏱' };
const cell = (result?: Result) => result ? `${symbol[result.verdict]} ${result.verdict === 'pass' ? `${result.completed}/${result.total}` : result.verdict === 'gate-blocked' ? 'gate' : `${result.completed}/${result.total}`}` : '—';
const mutations = MUTATIONS.filter(item => !mutationFilter || mutationFilter.includes(item.id));
let markdown = `# Skill-format harness · ${new Date().toISOString()}\n\nExecutor: the extension's own playback agent (skills:run → perform → chrome.debugger), input model stubbed deterministically.\n\n`;
for (const format of FORMATS.filter(item => !formatFilter || formatFilter.includes(item))) {
  const rows = results.filter(result => result.format === format);
  const passed = rows.filter(result => result.verdict === 'pass').length;
  markdown += `## Format \`${format}\` · ${passed}/${rows.length} passed\n\n| case | ${mutations.map(item => item.id).join(' | ')} |\n|---|${mutations.map(() => '---').join('|')}|\n`;
  for (const testCase of CASES.filter(item => !caseFilter || caseFilter.includes(item.id))) {
    markdown += `| ${testCase.id} | ${mutations.map(item => cell(rows.find(result => result.case === testCase.id && result.mutation === item.id))).join(' | ')} |\n`;
  }
  markdown += '\n';
}
const blocked = results.filter(result => result.verdict === 'gate-blocked');
if (blocked.length) {
  markdown += `## Gate-blocked skills\n\n| case | format | today's gate | with the outcome block accepted |\n|---|---|---|---|\n`;
  for (const result of blocked.filter((item, index, all) => all.findIndex(other => other.case === item.case && other.format === item.format) === index)) markdown += `| ${result.case} | ${result.format} | ${result.gate.join('; ')} | ${result.proposedGate.length ? result.proposedGate.join('; ') : 'would run'} |\n`;
  markdown += '\n';
}
const failures = results.filter(result => ['failed', 'wrong-result', 'timeout'].includes(result.verdict));
if (failures.length) {
  markdown += `## Failures\n\n| case | format | mutation | at step | message / checks |\n|---|---|---|---|---|\n`;
  for (const result of failures) markdown += `| ${result.case} | ${result.format} | ${result.mutation} | ${result.completed}/${result.total} | ${result.message ?? ''} ${Object.entries(result.checks).filter(([, value]) => value !== true).map(([key, value]) => `${key}: ${value}`).join('; ')} |\n`;
  markdown += '\n';
}
markdown += `Legend: ✅ pass (ground truth met) · ❗ ran to completion but ground truth not met · ❌ run failed · ⛔ refused by skillIssues before any dispatch · ⏱ timed out. Page errors: ${executor.pageErrors.length}.\n`;
await mkdir('.local/evidence/harness', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(`.local/evidence/harness/run-${stamp}.json`, JSON.stringify({ at: new Date().toISOString(), results, pageErrors: executor.pageErrors }, null, 2));
await writeFile('.local/evidence/harness/latest.json', JSON.stringify({ at: new Date().toISOString(), results, pageErrors: executor.pageErrors }, null, 2));
await writeFile('.local/evidence/harness/latest.md', markdown);
console.log('\n' + markdown);
