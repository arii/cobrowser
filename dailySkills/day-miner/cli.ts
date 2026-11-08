import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecorderState } from '../src/recorder-format.js';
import { loadEnv } from './env.js';
import { compress } from './compress.js';
import { mine, skillMarkdown, toLibrary } from './mine.js';
import { pickProvider } from './providers.js';

const USAGE = `Usage: pnpm mine <recording.json>... [--provider llama|subq|gemini] [--out skills/<day>] [--max-events N] [--dry-run]

Input: recorder exports (the monitor's Export JSON, or a converted dataset file from data/recordings).
Output: <out>/index.json, <out>/import.json (paste into the skills page), <out>/<slug>/skill.json + SKILL.md.
--dry-run prints the compressed day the model would see and exits without calling a model.`;

const argv = process.argv.slice(2);
const flag = (name: string) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : undefined; };
const files = argv.filter((arg, index) => !arg.startsWith('--') && !(index > 0 && argv[index - 1].startsWith('--') && ['provider', 'out', 'max-events'].includes(argv[index - 1].slice(2))));
if (!files.length) { console.log(USAGE); process.exit(argv.length ? 1 : 0); }
const env = loadEnv();
const states: RecorderState[] = [];
for (const file of files) states.push(JSON.parse(await readFile(file, 'utf8')));
const compressed = compress(states, { maxEvents: flag('max-events') ? Number(flag('max-events')) : undefined });
const day = new Date(compressed.firstAt).toISOString().slice(0, 10);
console.log(`Day ${day}: ${compressed.eventCount} meaningful interactions across ${compressed.tabs.size} tabs (${compressed.lines.join('\n').length.toLocaleString()} characters for the model).`);
if (argv.includes('--dry-run')) { console.log(compressed.lines.join('\n')); process.exit(0); }
const provider = pickProvider(env, flag('provider'));
console.log(`Asking ${provider} to find tasks and propose skills…`);
const result = await mine(compressed, provider, env);
const out = flag('out') ?? join('skills', day);
await mkdir(out, { recursive: true });
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'skill';
const used = new Set<string>();
for (const skill of result.skills) {
  let name = slug(skill.title); while (used.has(name)) name = `${name}-2`; used.add(name);
  await mkdir(join(out, name), { recursive: true });
  await writeFile(join(out, name, 'skill.json'), JSON.stringify(skill, null, 2));
  await writeFile(join(out, name, 'SKILL.md'), skillMarkdown(skill));
}
const importable = result.skills.filter(skill => !skill.blockers.length).map(toLibrary);
await writeFile(join(out, 'import.json'), JSON.stringify(importable, null, 2));
await writeFile(join(out, 'index.json'), JSON.stringify({ day, provider: result.provider, model: result.model, latencyMs: result.latencyMs, usage: result.usage, eventCount: compressed.eventCount, tasks: result.tasks,
  skills: result.skills.map(skill => ({ id: skill.id, title: skill.title, steps: skill.steps.length, sites: skill.sites.map(site => site.url), outcome: skill.outcome.kind, confidence: skill.confidence, blockers: skill.blockers })) }, null, 2));
console.log(`\n${result.model} answered in ${(result.latencyMs / 1000).toFixed(1)}s: ${result.tasks.length} tasks found, ${result.skills.length} skills proposed, ${importable.length} replayable.\n`);
for (const task of result.tasks) console.log(`  task  ${task.title} (#${task.firstRef}–#${task.lastRef}): ${task.intent}`);
console.log('');
for (const skill of result.skills) console.log(`  skill ${skill.title} · ${skill.steps.length} steps · ${skill.outcome.kind} · ${Math.round(skill.confidence * 100)}%${skill.blockers.length ? `\n        blocked: ${skill.blockers.join(' | ')}` : '\n        replayable'}`);
console.log(`\nWritten to ${out}/ (import.json holds the ${importable.length} replayable skills for the skills page).`);
