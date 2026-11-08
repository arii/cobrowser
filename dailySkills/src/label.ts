// Target labeling: give converted clicks the {tag,label,type} target the recorder stores, from the frame at click time.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { RecorderEvent, RecorderState, RecorderTarget } from './recorder-format.js';
import { clickFrames, ensurePsaiVideo, type Image, type VideoInfo } from './frames.js';
import { checkWithSnap, labelWithVlm, pickVlmProvider, snapTag, vlmModelName, type SnapAnswer, type VlmAnswer, type VlmProvider } from './vision.js';
import { validTarget } from './validate.js';
import { labelNear, ocrAvailable, ocrLineAt, ocrWords, type OcrAnswer } from './ocr.js';

interface TaskSource { dataset?: string; id?: string; tabId?: number; placedStartedAt?: string; screen?: { width: number; height: number; chromeTopPx: number }; timing?: { firstEventTimestamp: number; videoStartTimestamp: number }; task?: string; site?: string }
export interface LabelRecord { eventId: string; tabId: number; videoSeconds: number; frames: string[]; vlm?: VlmAnswer & { model: string; latencyMs: number }; snap?: SnapAnswer & { model: string; latencyMs: number }; ocr?: OcrAnswer | null; decision: string; target: RecorderTarget | null }
export interface LabelOptions { provider: VlmProvider | 'auto' | 'none'; snap: boolean; ocr: boolean; dryRun: boolean; limitClicks: number; rawDir: string; env?: NodeJS.ProcessEnv; log?: (line: string) => void }

const INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'number', 'url', 'tel', 'date', 'time', 'submit', 'button', 'reset']);
const tasksOf = (state: RecorderState): TaskSource[] => { const source = state.source as { merged?: TaskSource[] } & TaskSource | undefined; return Array.isArray(source?.merged) ? source.merged : source ? [source] : []; };

/** Combine the VLM's name with Snap's class check into a recorder target, or explain why there is none. */
export function decideTarget(vlm: VlmAnswer | undefined, snap: SnapAnswer | undefined, ocr?: OcrAnswer | null): { target: RecorderTarget | null; decision: string } {
  let tag: VlmAnswer['tag'], label: string, type: string, decision = 'labeled';
  if (vlm) {
    tag = vlm.tag;
    if (snap) {
      if (snap.control === 'none' && snap.controlConfidence >= 0.6 && snap.clickable < 0.5) return { target: null, decision: 'snap-says-not-a-control' };
      const alternative = snapTag(snap.control);
      if (alternative !== 'NONE' && alternative !== tag && snap.controlConfidence >= 0.7) { tag = alternative; decision = 'snap-overrode-tag'; }
    }
    if (tag === 'NONE') return { target: null, decision: 'vlm-says-not-a-control' };
    if (vlm.confidence < 0.4) return { target: null, decision: 'low-confidence' };
    label = vlm.label.replace(/\s+/g, ' ').trim().slice(0, 100) || ocr?.label || '';
    type = vlm.type;
  } else if (snap) {
    // No vision LLM: Snap says what kind of control it is, OCR reads the text on the click's row.
    if (snap.control === 'none') return { target: null, decision: snap.clickable >= 0.6 ? 'snap-unsure-of-control-kind' : 'snap-says-not-a-control' };
    if (snap.controlConfidence < 0.5 && snap.clickable < 0.6) return { target: null, decision: 'snap-low-confidence' };
    if (!ocr?.label) return { target: null, decision: 'no-ocr-text-at-click' };
    tag = snapTag(snap.control); label = ocr.label; type = ''; decision = 'snap+ocr';
  } else return { target: null, decision: 'no-model-answer' };
  if (!label) return { target: null, decision: 'no-label' };
  type = type.trim().toLowerCase().replace(/[^a-z-]/g, '').slice(0, 30);
  if (['password', 'hidden', 'file', 'checkbox', 'radio'].includes(type)) return { target: null, decision: `unsupported-type-${type}` };
  if (tag === 'INPUT' && !INPUT_TYPES.has(type)) type = 'text';
  if (tag === 'BUTTON' && !['', 'submit', 'button', 'reset'].includes(type)) type = 'button';
  if (tag === 'A' || tag === 'SELECT' || tag === 'TEXTAREA') type = '';
  const target: RecorderTarget = { tag: tag as RecorderTarget['tag'], label, type };
  if (!validTarget(target)) return { target: null, decision: 'rejected-by-validTarget' };
  return { target, decision };
}

export async function labelState(state: RecorderState, fileName: string, options: LabelOptions): Promise<{ state: RecorderState; records: LabelRecord[]; summary: Record<string, number> }> {
  const env = options.env ?? process.env, log = options.log ?? (() => {});
  const chosen = options.dryRun ? 'none' : options.provider === 'auto' ? pickVlmProvider(env) : options.provider;
  const provider: VlmProvider | null = chosen === 'none' ? null : chosen;
  const useSnap = options.snap && !options.dryRun && Boolean(env.SUBQ_API_KEY);
  const useOcr = options.ocr && !options.dryRun && await ocrAvailable();
  if (options.snap && !options.dryRun && !env.SUBQ_API_KEY) log('  SUBQ_API_KEY not set: skipping Snap cross-check');
  if (options.ocr && !options.dryRun && !useOcr) log('  tesseract not found: skipping OCR');
  if (!options.dryRun && !provider && !useSnap) throw new Error('Nothing can label clicks: set LLAMA_ENDPOINT + LLAMA_MODEL + LLAMA_API_KEY, or SUBQ_API_KEY for Snap + OCR, in dailySkills/.env');
  if (!options.dryRun) log(`  labeling with ${provider ? `${provider} (${vlmModelName(provider, env)})` : 'no vision LLM'}${useSnap ? ' + SubQ Snap' : ''}${useOcr ? ' + tesseract OCR' : ''}`);
  const records: LabelRecord[] = []; const summary: Record<string, number> = { clicks: 0, labeled: 0, changesInherited: 0, skippedTasks: 0 };
  const cacheDir = join(options.rawDir, 'labels'); await mkdir(cacheDir, { recursive: true });
  const stem = basename(fileName, '.json');
  const next: RecorderState = { ...state, events: state.events.map(event => ({ ...event })) };
  let clicksSeen = 0;
  for (const task of tasksOf(state)) {
    const tabId = task.tabId ?? 1;
    if (task.dataset !== 'anaisleila/computer-use-data-psai' || !task.id || !task.timing || !task.screen || !task.placedStartedAt) { summary.skippedTasks++; log(`  tab ${tabId}: no video frames available for ${task.dataset ?? 'unknown dataset'}; skipped`); continue; }
    const cachePath = join(cacheDir, `${task.id}.json`);
    const cache = JSON.parse(await readFile(cachePath, 'utf8').catch(() => '{}')) as Record<string, Partial<LabelRecord>>;
    let video: VideoInfo | null = null;
    const base = Date.parse(task.placedStartedAt), { width, height, chromeTopPx: top } = task.screen;
    const clicks = next.events.filter(event => event.tabId === tabId && event.kind === 'click' && event.x !== undefined && !event.target);
    log(`  tab ${tabId} ${task.site ?? ''}: ${clicks.length} clicks · ${(task.task ?? '').slice(0, 80)}`);
    for (const click of clicks) {
      if (clicksSeen >= options.limitClicks) break;
      clicksSeen++; summary.clicks++;
      const offsetS = (Date.parse(click.at) - base) / 1000;
      const videoSeconds = (task.timing.firstEventTimestamp - task.timing.videoStartTimestamp) + offsetS;
      const cached = cache[click.id];
      let record: LabelRecord = { eventId: click.id, tabId, videoSeconds: Number(videoSeconds.toFixed(3)), frames: cached?.frames ?? [], decision: 'pending', target: null };
      if (cached && (!provider || cached.vlm) && (!useSnap || cached.snap) && (!useOcr || cached.ocr !== undefined)) { record = { ...record, vlm: cached.vlm, snap: cached.snap, ocr: cached.ocr }; }
      else {
        video ??= await ensurePsaiVideo(task.id, join(options.rawDir, 'psai', 'videos'));
        const scaleX = video.width / width, scaleY = video.height / height;
        const px = click.x! * width * scaleX, py = (click.y! * (height - top) + top) * scaleY;
        const frames = await clickFrames(video, videoSeconds, px, py, join(options.rawDir, 'frames', stem), `${task.id}-${click.id.slice(0, 8)}`);
        record.frames = frames.files;
        if (options.dryRun) { record.decision = 'dry-run'; records.push(record); continue; }
        const images: Image[] = [frames.full, frames.crop];
        if (provider) {
          try { const vlm = await labelWithVlm(provider, images, env); record.vlm = { ...vlm.answer, model: vlm.model, latencyMs: vlm.latencyMs }; }
          catch (error) { record.decision = `vlm-error: ${(error as Error).message.slice(0, 200)}`; log(`    ${record.decision}`); }
        }
        if (useOcr) {
          try {
            const row = labelNear(await ocrWords(frames.ocr.path), frames.ocr.x, frames.ocr.y);
            // Prefer a run that actually contains the click; otherwise try the tight single-line pass.
            const line = row && row.confidence >= 0.7 ? null : await ocrLineAt(frames.ocr.path, frames.ocr.x, frames.ocr.y, frames.ocr.path.replace(/-ocr\.png$/, '-ocr-line.png'));
            record.ocr = line && (!row || line.confidence >= row.confidence) ? line : row;
          } catch (error) { log(`    ocr-error: ${(error as Error).message.slice(0, 200)}`); record.ocr = null; }
        }
        if (useSnap) { try { const snap = await checkWithSnap(images, env); record.snap = { ...snap.answer, model: snap.model, latencyMs: snap.latencyMs }; } catch (error) { log(`    snap-error: ${(error as Error).message.slice(0, 200)}`); } }
        cache[click.id] = { frames: record.frames, vlm: record.vlm, snap: record.snap, ocr: record.ocr };
        await writeFile(cachePath, JSON.stringify(cache, null, 2));
      }
      if (!record.decision.startsWith('vlm-error') || useSnap) {
        const decided = decideTarget(record.vlm, record.snap, record.ocr);
        record.decision = decided.decision; record.target = decided.target;
      }
      if (record.target) { click.target = record.target; summary.labeled++; }
      summary[record.decision.split(':')[0]] = (summary[record.decision.split(':')[0]] ?? 0) + 1;
      log(`    +${offsetS.toFixed(1)}s ${record.decision}${record.target ? ` → ${record.target.tag} "${record.target.label}"${record.target.type ? ` (${record.target.type})` : ''}` : ''}${record.vlm ? ` [vlm ${record.vlm.tag} ${Math.round(record.vlm.confidence * 100)}%]` : ''}${record.snap ? ` [snap ${record.snap.control} ${Math.round(record.snap.controlConfidence * 100)}%]` : ''}${record.ocr ? ` [ocr "${record.ocr.label}"]` : record.ocr === null ? ' [ocr none]' : ''}`);
      records.push(record);
    }
    // A committed field change belongs to the field clicked just before it (click-to-focus, then type).
    const tabEvents = next.events.filter(event => event.tabId === tabId);
    tabEvents.forEach((event, index) => {
      if (event.kind !== 'change' || event.target) return;
      for (let back = index - 1; back >= 0; back--) {
        const previous = tabEvents[back] as RecorderEvent;
        if (Date.parse(event.at) - Date.parse(previous.at) > 30_000) break;
        if (previous.kind === 'click') { if (previous.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(previous.target.tag)) { event.target = { ...previous.target }; summary.changesInherited++; } break; }
      }
    });
  }
  const source = (next.source ?? {}) as Record<string, unknown>;
  next.source = { ...source, labeling: { provider: options.dryRun ? 'dry-run' : provider ?? 'none', model: provider ? vlmModelName(provider, env) : null, snap: useSnap ? (env.SUBQ_SNAP_MODEL ?? 'subq-snap-1.1') : null, ocr: useOcr ? 'tesseract' : null, labeledAt: new Date().toISOString(), summary, records } };
  return { state: next, records, summary };
}
