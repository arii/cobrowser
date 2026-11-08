import { z } from 'zod';
import { createHash } from 'node:crypto';

const usage = z.object({ input_tokens: z.number().nonnegative().optional(), output_tokens: z.number().nonnegative().optional(), prompt_tokens: z.number().nonnegative().optional(), completion_tokens: z.number().nonnegative().optional() }).passthrough();
const probability = z.number().min(0).max(1);
const distribution = z.record(z.string(), probability).refine(p => Math.abs(Object.values(p).reduce((a,b) => a+b,0) - 1) < .02);
export const SnapAnswer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), noul: probability }),
  z.object({ type: z.literal('choice'), choice: z.string(), probabilities: distribution, confidence: probability }),
  z.object({ type: z.literal('score'), score: z.number(), legend: z.record(z.string(), z.string()), probabilities: distribution, confidence: probability }),
]);
const SnapResponse = z.object({ model: z.literal('subq-snap-1.1'), answers: z.record(z.string(), SnapAnswer), usage });
export const VisionResult = z.object({ text: z.string().max(100), color: z.enum(['red', 'green', 'blue', 'unknown']) }).strict();
const ChatResponse = z.object({ model: z.string(), choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1), usage });
export type Image = { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string };
export function checkImages(images: Image[]) {
  if (images.length > 4) throw new Error('image-count-limit');
  let total = 0;
  for (const image of images) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.base64)) throw new Error('invalid-base64');
    const bytes = Buffer.from(image.base64, 'base64');
    const valid = image.mediaType === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))
      : image.mediaType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216
      : image.mediaType === 'image/webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
    if (!valid || bytes.length > 4 * 1024 * 1024) throw new Error('invalid-or-oversize-image');
    total += bytes.length;
  }
  if (total > 8 * 1024 * 1024) throw new Error('total-image-limit');
}
export type Mode = 'live' | 'replay';
export type Replay = { provenance: 'hand-authored-synthetic'; llama: unknown; snap: unknown };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function post(endpoint: string, key: string, body: unknown) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('unsafe-endpoint');
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > 13 * 1024 * 1024) throw new Error('request-size-limit');
  const started = performance.now();
  let response: Response;
  try { response = await fetch(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: serialized, signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('provider-network-or-timeout'); }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`provider-http-${response.status}`); }
  const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > 1024 * 1024) { await reader.cancel(); throw new Error('response-size-limit'); } chunks.push(next.value); }
  let raw: unknown;
  try { raw = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new Error('provider-invalid-json'); }
  // Request IDs can be arbitrary strings: hash before logging; never log provider bodies/errors.
  return { raw, latencyMs: Math.round(performance.now() - started), requestIdHash: response.headers.has('x-request-id') ? hash(response.headers.get('x-request-id')) : null, inputHash: hash(body) };
}
function requireCloud() { if (process.env.HARNESS_CLOUD_ENABLED !== '1') throw new Error('cloud-processing-disabled'); }
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`missing-${name}`); return value; }

export async function llama(mode: Mode, image: Image, replay?: Replay) {
  checkImages([image]);
  let configuredModel = 'replay-llama-vision';
  if (mode === 'live') {
    requireCloud();
    if (required('LLAMA_SCHEMA') !== 'openai-chat') throw new Error('unsupported-LLAMA_SCHEMA');
    configuredModel = required('LLAMA_MODEL');
    if (!/llama/i.test(configuredModel)) throw new Error('configured-model-is-not-declared-llama');
  }
  const body = { model: configuredModel, max_tokens: 128, temperature: 0,
    response_format: { type: 'json_schema', json_schema: { name: 'vision_probe', strict: true, schema: z.toJSONSchema(VisionResult) } },
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Read the large word and dominant background color in this synthetic image. Return text and color as JSON.' },
      { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } },
    ] }] };
  const transport = mode === 'live' ? await post(required('LLAMA_ENDPOINT'), required('LLAMA_API_KEY'), body)
    : { raw: replay?.llama, latencyMs: 0, inputHash: hash(body), requestIdHash: null };
  const parsed = ChatResponse.safeParse(transport.raw);
  if (!parsed.success) throw new Error('llama-invalid-envelope');
  let content: unknown;
  try { content = JSON.parse(parsed.data.choices[0].message.content); } catch { throw new Error('llama-invalid-json-content'); }
  const value = VisionResult.safeParse(content);
  if (!value.success) throw new Error('llama-invalid-structured-output');
  if (mode === 'live' && parsed.data.model !== configuredModel) throw new Error('llama-response-model-mismatch');
  return { mode, provenance: mode === 'replay' ? replay?.provenance : 'provider', model: parsed.data.model,
    promptVersion: 'vision-probe-v1', ...transport, raw: undefined, value: value.data, usage: parsed.data.usage,
    imageHash: hash(image), capabilityPassed: value.data.text === 'PHASE0' && value.data.color === 'red' };
}

export const snapQuestions = {
  matches: { type: 'noul', instructions: 'Does the screenshot show a red background and the word PHASE0?', criteria: { true: 'Both visible', false: 'Either absent' } },
  evidence: { type: 'choice', instructions: 'Classify evidence of a red background and word PHASE0.', criteria: { match: 'Both visible', mismatch: 'Contradicted', insufficient: 'Cannot determine' } },
  quality: { type: 'score', instructions: 'Rate legibility of the word.', criteria: { '0': 'Unreadable', '1': 'Partly legible', '2': 'Clearly legible' } },
} as const;
export function parseSnap(raw: unknown) {
  const parsed = SnapResponse.safeParse(raw);
  if (!parsed.success) throw new Error('snap-invalid-envelope');
  const a = parsed.data.answers;
  if (Object.keys(a).sort().join(',') !== 'evidence,matches,quality' || a.matches.type !== 'noul' || a.evidence.type !== 'choice' || a.quality.type !== 'score') throw new Error('snap-question-mismatch');
  if (Object.keys(a.evidence.probabilities).sort().join(',') !== 'insufficient,match,mismatch' || !(a.evidence.choice in a.evidence.probabilities)) throw new Error('snap-choice-mismatch');
  if (Object.keys(a.quality.legend).sort().join(',') !== '0,1,2' || Object.keys(a.quality.probabilities).sort().join(',') !== '0,1,2' || a.quality.score < 0 || a.quality.score > 2) throw new Error('snap-score-mismatch');
  const weighted = Number(a.quality.probabilities['1']) + 2 * Number(a.quality.probabilities['2']);
  if (Math.abs(weighted - a.quality.score) > .02) throw new Error('snap-score-inconsistent');
  return parsed.data;
}
export async function snap(mode: Mode, images: Image[], replay?: Replay) {
  checkImages(images);
  if (images.length !== 1) throw new Error('missing-required-synthetic-image');
  const body = { model: 'subq-snap-1.1', state: 'Synthetic capability check only. No user content.', images, questions: snapQuestions };
  if (mode === 'live') requireCloud();
  const transport = mode === 'live' ? await post('https://api.subq.ai/v1/systemone', required('SUBQ_API_KEY'), body)
    : { raw: replay?.snap, latencyMs: 0, inputHash: hash(body), requestIdHash: null };
  const parsed = parseSnap(transport.raw);
  const { matches, evidence } = parsed.answers;
  // Probe thresholds only, not calibrated product approval thresholds.
  const capabilityPassed = matches.type === 'noul' && matches.noul >= .9 && evidence.type === 'choice' && evidence.choice === 'match' && evidence.confidence >= .9;
  return { mode, provenance: mode === 'replay' ? replay?.provenance : 'provider', model: parsed.model, questionVersion: 'snap-probe-v1',
    ...transport, raw: undefined, answers: parsed.answers, usage: parsed.usage, imageHashes: images.map(hash), capabilityPassed,
    verdict: capabilityPassed ? 'probe-passed' : 'inconclusive' };
}
