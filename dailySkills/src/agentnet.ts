// xlangai/AgentNet -> recorder format.
// Trajectories are PyAutoGUI code per step with normalized screen coordinates and no timestamps.
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolveOrigin, stagedEvent, type RecorderKey, type StagedEvent, type StagedTask } from './recorder-format.js';

export interface AgentNetMeta { task_id: string; instruction: string; websites: string[]; applications: string[]; system: string; screen_width: number; screen_height: number; step_num: number; domains?: string }
export interface AgentNetStep { index: number; image: string; value: { observation?: string; thought?: string; action?: string; code?: string; last_step_correct?: unknown; last_step_redundant?: unknown; reflection?: string } }
export interface AgentNetTask { task_id: string; instruction: string; task_completed: boolean; natural_language_task?: string; actual_task?: string; task_difficulty?: number; traj: AgentNetStep[] }

export const AGENTNET_FILES = {
  meta: 'https://huggingface.co/datasets/xlangai/AgentNet/resolve/main/meta_data_merged.jsonl',
  win_mac: 'https://huggingface.co/datasets/xlangai/AgentNet/resolve/main/agentnet_win_mac_18k.jsonl',
  ubuntu: 'https://huggingface.co/datasets/xlangai/AgentNet/resolve/main/agentnet_ubuntu_5k.jsonl',
};

export async function loadAgentNetMeta(pathOrUrl: string): Promise<Map<string, AgentNetMeta>> {
  const text = /^https?:/.test(pathOrUrl) ? await (await fetch(pathOrUrl, { redirect: 'follow' })).text() : await readFile(pathOrUrl, 'utf8');
  const map = new Map<string, AgentNetMeta>();
  for (const line of text.split('\n')) if (line.trim()) { const meta = JSON.parse(line) as AgentNetMeta; map.set(meta.task_id, meta); }
  return map;
}

/** Streams a (possibly remote, multi-GB) JSONL file and yields tasks until the caller stops. Remote reads use HTTP ranges in chunks. */
export async function* streamAgentNetTasks(pathOrUrl: string, options: { chunkBytes?: number; maxBytes?: number } = {}): AsyncGenerator<AgentNetTask> {
  if (!/^https?:/.test(pathOrUrl)) {
    const lines = createInterface({ input: createReadStream(pathOrUrl, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of lines) if (line.trim()) yield JSON.parse(line) as AgentNetTask;
    return;
  }
  const chunk = options.chunkBytes ?? 16 * 1024 * 1024, max = options.maxBytes ?? Infinity;
  let offset = 0, buffer = '';
  const decoder = new TextDecoder();
  while (offset < max) {
    const response = await fetch(pathOrUrl, { headers: { Range: `bytes=${offset}-${offset + chunk - 1}` }, redirect: 'follow', signal: AbortSignal.timeout(300_000) });
    if (response.status === 416) break;
    if (!response.ok) throw new Error(`AgentNet download HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    buffer += decoder.decode(bytes, { stream: true });
    offset += bytes.length;
    const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as AgentNetTask;
    if (bytes.length < chunk || response.status === 200) break;
  }
  if (buffer.trim()) yield JSON.parse(buffer) as AgentNetTask;
}

export interface AgentNetConvertOptions { chromeTopPx: number; stepMs: number; markClickEffects: boolean }
export const AGENTNET_DEFAULTS: AgentNetConvertOptions = { chromeTopPx: 90, stepMs: 3000, markClickEffects: true };

const KEYS: Record<string, RecorderKey> = { enter: 'Enter', return: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const CALL = /(?:pyautogui|computer)\.(\w+)\((.*)\)\s*$/;
const num = (args: string, name: string, position: number): number | null => {
  const named = new RegExp(`\\b${name}\\s*=\\s*(-?[\\d.]+)`).exec(args);
  if (named) return Number(named[1]);
  const positional = args.split(',').map(part => part.trim()).filter(part => part && !part.includes('='));
  return positional[position] !== undefined && /^-?[\d.]+$/.test(positional[position]) ? Number(positional[position]) : null;
};
const str = (args: string): string | null => { const match = /(['"])((?:\\.|(?!\1).)*)\1/.exec(args); return match ? match[2] : null; };

export const isBrowserTask = (meta: AgentNetMeta | undefined) => !!meta && (meta.websites?.length > 0 || (meta.applications ?? []).some(app => /chrome|edge|firefox|safari|browser/i.test(app)));

export function convertAgentNetTask(task: AgentNetTask, meta: AgentNetMeta | undefined, options: AgentNetConvertOptions = AGENTNET_DEFAULTS): StagedTask {
  const width = meta?.screen_width ?? 1920, height = meta?.screen_height ?? 1080, top = options.chromeTopPx;
  const site = meta?.websites?.[0] ?? null;
  const { origin, resolvedBy } = resolveOrigin(site, `${task.instruction} ${task.actual_task ?? ''}`, site ?? task.task_id);
  const stats: Record<string, number> = { clicks: 0, browserUiClicks: 0, typedCommits: 0, keys: 0, scrolls: 0, pointers: 0, effects: 0, unsupportedActions: 0 };
  const events: StagedEvent[] = [];
  const toViewport = (x: number, y: number) => ({ x, y: (y * height - top) / (height - top) });
  let clock = 0;
  const steps = task.traj ?? [];
  steps.forEach((step, index) => {
    clock = index * options.stepMs;
    const lines = (step.value.code ?? '').split(/[\n;]+/).map(line => line.trim()).filter(Boolean);
    const hasNext = index < steps.length - 1 && !/terminate/.test(steps[index + 1]?.value.code ?? '');
    for (const line of lines) {
      const match = CALL.exec(line);
      if (!match) { stats.unsupportedActions++; continue; }
      const [, fn, args] = match;
      const at = clock; clock += 500;
      switch (fn) {
        case 'click': case 'doubleClick': case 'tripleClick': case 'triple_click': case 'double_click': {
          const x = num(args, 'x', 0), y = num(args, 'y', 1);
          if (x === null || y === null) { stats.unsupportedActions++; break; }
          if (y * height < top) { stats.browserUiClicks++; break; }
          const click = stagedEvent({ offsetMs: at, kind: 'click', tag: 'OTHER', ...toViewport(x, y) });
          if (options.markClickEffects && hasNext && line === lines[lines.length - 1]) { click.effect = 'content-changed'; stats.effects++; }
          events.push(click); stats.clicks++;
          break;
        }
        case 'moveTo': { const x = num(args, 'x', 0), y = num(args, 'y', 1); if (x !== null && y !== null && y * height >= top) { events.push(stagedEvent({ offsetMs: at, kind: 'pointer', tag: 'OTHER', ...toViewport(x, y) })); stats.pointers++; } break; }
        case 'write': case 'typewrite': {
          if (str(args) === null) { stats.unsupportedActions++; break; }
          // Typed values are never stored by the recorder; only the committed-change signal survives.
          events.push(stagedEvent({ offsetMs: at, kind: 'change', tag: 'INPUT' })); stats.typedCommits++;
          break;
        }
        case 'press': {
          const name = (str(args) ?? '').toLowerCase(); const key = KEYS[name];
          if (!key) { stats.unsupportedActions++; break; }
          events.push(stagedEvent({ offsetMs: at, kind: 'key', tag: 'OTHER', key })); stats.keys++;
          break;
        }
        case 'scroll': case 'hscroll': case 'vscroll': { events.push(stagedEvent({ offsetMs: at, kind: 'scroll', tag: 'PAGE' })); stats.scrolls++; break; }
        case 'terminate': case 'wait': case 'sleep': break;
        default: stats.unsupportedActions++; // hotkey, dragTo, keyDown/Up, rightClick etc. have no recorder equivalent
      }
    }
  });
  return {
    origin, title: site ? `${site} - ${task.instruction.slice(0, 120)}` : task.instruction.slice(0, 160), originalStart: null,
    durationMs: Math.max(clock, steps.length * options.stepMs), events, stats,
    source: {
      dataset: 'xlangai/AgentNet', id: task.task_id, task: task.instruction, naturalLanguageTask: task.natural_language_task, actualTask: task.actual_task,
      site, websites: meta?.websites ?? [], applications: meta?.applications ?? [], system: meta?.system, originResolvedBy: resolvedBy,
      screen: { width, height, chromeTopPx: top }, screenshots: steps.map(step => step.image),
      steps: steps.map(step => ({ index: step.index, action: step.value.action, code: step.value.code, thought: step.value.thought })),
    },
  };
}
