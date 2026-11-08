import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { assembleEach, assembleMerged, type StagedTask, type RecorderState } from './recorder-format.js';
import { convertPsaiRow, fetchPsaiRows, matchesSite, PSAI_DEFAULTS } from './psai.js';
import { AGENTNET_DEFAULTS, AGENTNET_FILES, convertAgentNetTask, isBrowserTask, loadAgentNetMeta, streamAgentNetTasks } from './agentnet.js';
import { validateState } from './validate.js';
import { labelState } from './label.js';
import { loadEnv } from './env.js';

const USAGE = `Usage:
  pnpm convert psai     [--offset N] [--length N] [--site amazon] [--scan-max N] [--all-categories] [common options]
  pnpm convert agentnet [--limit N] [--site amazon] [--file traj.jsonl | --remote win_mac|ubuntu] [--meta meta.jsonl] [--max-mb N] [common options]
  pnpm convert validate <file.json> [...]
  pnpm convert label    <file.json> [...] [--provider auto|llama|none] [--no-snap] [--no-ocr] [--dry-run] [--limit-clicks N] [--out DIR] [--raw DIR]
                        gives PSAI clicks a {tag,label,type} target from the video frame at click time (ffmpeg + vision model;
                        Snap cross-check when SUBQ_API_KEY is set; with no vision LLM key, Snap classifies the control and
                        tesseract OCR reads its text). Reads keys from dailySkills/.env. Output: <out>/<name>.labeled.json

Common options:
  --out DIR            output directory (default data/recordings)
  --merge              also write one merged recording (one session, one tab per task) as <dataset>-merged.json
  --rebase now|keep    'now' (default) shifts timestamps into the last 24h so the extension keeps them; 'keep' uses dataset times
  --gap-seconds N      idle gap between merged tasks (default 60)
  --chrome-top N       px of browser UI above the page viewport (default 90)
  --min-events N       skip tasks that convert to fewer events (default 3)`;

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {}; const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg.startsWith('--')) { const next = argv[index + 1]; if (next !== undefined && !next.startsWith('--')) { flags[arg.slice(2)] = next; index++; } else flags[arg.slice(2)] = true; }
    else positional.push(arg);
  }
  return { flags, positional };
}
const text = (flags: Record<string, string | boolean>, name: string, fallback: string) => typeof flags[name] === 'string' ? flags[name] as string : fallback;
const int = (flags: Record<string, string | boolean>, name: string, fallback: number) => { const value = Number(text(flags, name, String(fallback))); if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`); return value; };
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function writeOutputs(prefix: string, tasks: StagedTask[], flags: Record<string, string | boolean>) {
  const out = text(flags, 'out', 'data/recordings');
  await mkdir(out, { recursive: true });
  const rebase = text(flags, 'rebase', 'now') === 'keep' ? 'keep' : 'now';
  const options = { rebase: rebase as 'now' | 'keep', gapMs: int(flags, 'gap-seconds', 60) * 1000 };
  const states = assembleEach(tasks, options);
  const written: string[] = [];
  for (const [index, state] of states.entries()) {
    const source = tasks[index].source as { id: string; site?: string | null };
    const file = join(out, `${prefix}-${slug(source.site ?? 'site')}-${slug(source.id)}.json`);
    await writeFile(file, JSON.stringify(state, null, 2)); written.push(file);
    report(file, state, tasks[index]);
  }
  if (flags.merge && tasks.length) {
    const merged = assembleMerged(tasks, options);
    const file = join(out, `${prefix}-merged.json`);
    await writeFile(file, JSON.stringify(merged, null, 2)); written.push(file);
    const problems = validateState(merged);
    console.log(`${file}: ${merged.events.length} events, ${merged.tabs.length} tabs, ${merged.startedAt} .. ${merged.events.at(-1)?.at}${problems.length ? `\n  PROBLEMS: ${problems.join('; ')}` : ''}`);
  }
  return written;
}
function report(file: string, state: RecorderState, task: StagedTask) {
  const problems = validateState(state);
  const counts = Object.entries(task.stats).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(' ');
  console.log(`${file}\n  origin ${task.origin} | ${state.events.length} events over ${Math.round(task.durationMs / 1000)}s | ${counts}${problems.length ? `\n  PROBLEMS: ${problems.join('; ')}` : ''}`);
}

async function psai(flags: Record<string, string | boolean>) {
  const offset = int(flags, 'offset', 0), length = int(flags, 'length', 10), minEvents = int(flags, 'min-events', 3);
  const site = typeof flags.site === 'string' ? flags.site : undefined;
  const options = { ...PSAI_DEFAULTS, chromeTopPx: int(flags, 'chrome-top', PSAI_DEFAULTS.chromeTopPx) };
  const scanMax = int(flags, 'scan-max', site ? 1500 : 500);
  const tasks: StagedTask[] = []; let cursor = offset, total = Infinity, skipped = 0;
  while (tasks.length < length && cursor < total && cursor - offset < scanMax) {
    // Rows are ~160KB each (raw pointer moves), so fetch in pages of up to 100 and filter locally.
    const page = await fetchPsaiRows({ offset: cursor, length: site ? 100 : Math.min(100, length - tasks.length) });
    total = page.total; if (!page.rows.length) break;
    if (site) console.log(`  scanned rows ${cursor}..${cursor + page.rows.length - 1}: ${page.rows.filter(row => matchesSite(row, site)).length} match '${site}'`);
    for (const row of page.rows) {
      if (tasks.length >= length) break;
      if (!matchesSite(row, site)) continue;
      if (!flags['all-categories'] && row.category !== 'BROWSER_TASK') { skipped++; continue; }
      const task = convertPsaiRow(row, options);
      if (task.events.length < minEvents) { skipped++; continue; }
      tasks.push(task);
    }
    cursor += page.rows.length;
  }
  console.log(`PSAI: ${tasks.length} tasks converted, ${skipped} skipped (non-browser or too few events), from rows ${offset}..${cursor - 1} of ${total}${site ? ` matching site '${site}'` : ''}`);
  await writeOutputs('psai', tasks, flags);
}

async function agentnet(flags: Record<string, string | boolean>) {
  const limit = int(flags, 'limit', 10), minEvents = int(flags, 'min-events', 3);
  const site = typeof flags.site === 'string' ? flags.site.toLowerCase() : undefined;
  const remote = text(flags, 'remote', 'win_mac') as keyof typeof AGENTNET_FILES;
  const source = typeof flags.file === 'string' ? flags.file : AGENTNET_FILES[remote];
  if (!source) throw new Error(`--remote must be one of ${Object.keys(AGENTNET_FILES).filter(key => key !== 'meta').join(', ')}`);
  const metaPath = text(flags, 'meta', AGENTNET_FILES.meta);
  console.log(`AgentNet: loading metadata from ${metaPath}`);
  const meta = await loadAgentNetMeta(metaPath);
  const options = { ...AGENTNET_DEFAULTS, chromeTopPx: int(flags, 'chrome-top', AGENTNET_DEFAULTS.chromeTopPx) };
  const tasks: StagedTask[] = []; let scanned = 0, skipped = 0;
  for await (const task of streamAgentNetTasks(source, { maxBytes: int(flags, 'max-mb', 512) * 1024 * 1024 })) {
    scanned++;
    const info = meta.get(task.task_id);
    if (!isBrowserTask(info) || (site && !(info!.websites ?? []).some(site_ => site_.toLowerCase().includes(site)))) { skipped++; continue; }
    const staged = convertAgentNetTask(task, info, options);
    if (staged.events.length < minEvents) { skipped++; continue; }
    tasks.push(staged);
    if (tasks.length >= limit) break;
  }
  console.log(`AgentNet: ${tasks.length} browser tasks converted from ${scanned} scanned (${skipped} skipped: desktop-only, other site, or too few events)`);
  await writeOutputs('agentnet', tasks, flags);
}

async function validate(files: string[]) {
  let failed = 0;
  for (const file of files) {
    const state = JSON.parse(await readFile(file, 'utf8')) as RecorderState;
    const problems = validateState(state);
    if (problems.length) failed++;
    console.log(`${file}: ${state.events.length} events, ${problems.length ? `PROBLEMS:\n  ${problems.join('\n  ')}` : 'ok'}`);
  }
  if (failed) process.exitCode = 1;
}

async function label(files: string[], flags: Record<string, string | boolean>) {
  if (!files.length) throw new Error('label needs at least one recording file');
  loadEnv();
  const out = text(flags, 'out', 'data/recordings/labeled'); await mkdir(out, { recursive: true });
  const provider = text(flags, 'provider', 'auto');
  if (!['auto', 'llama', 'none'].includes(provider)) throw new Error('--provider must be auto, llama or none');
  for (const file of files) {
    const state = JSON.parse(await readFile(file, 'utf8')) as RecorderState;
    console.log(`${file}: ${state.events.filter(event => event.kind === 'click').length} clicks`);
    const result = await labelState(state, file, { provider: provider as 'auto' | 'llama' | 'none', snap: !flags['no-snap'], ocr: !flags['no-ocr'], dryRun: Boolean(flags['dry-run']), limitClicks: int(flags, 'limit-clicks', 1000), rawDir: text(flags, 'raw', 'data/raw'), log: line => console.log(line) });
    // Keep the input's subfolder (data/recordings/amazon/x.json -> <out>/amazon/x.labeled.json) so same-named files do not collide.
    const rel = relative(process.cwd(), file).replace(/^data[\\/]recordings[\\/]/, '').replace(/^(\.\.[\\/])+/, '');
    const target = join(out, dirname(rel), `${basename(file, '.json')}.labeled.json`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(result.state, null, 2));
    const problems = validateState(result.state);
    console.log(`  → ${target}: ${Object.entries(result.summary).map(([key, value]) => `${key}=${value}`).join(' ')}${problems.length ? `\n  PROBLEMS: ${problems.join('; ')}` : ''}`);
    if (flags['dry-run']) console.log(`  frames written under ${text(flags, 'raw', 'data/raw')}/frames/${basename(file, '.json')}/`);
  }
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const command = positional[0];
try {
  if (command === 'psai') await psai(flags);
  else if (command === 'agentnet') await agentnet(flags);
  else if (command === 'validate') await validate(positional.slice(1));
  else if (command === 'label') await label(positional.slice(1), flags);
  else { console.log(USAGE); process.exitCode = command ? 1 : 0; }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
