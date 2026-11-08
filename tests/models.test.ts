import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSnap, checkImages, llama, snap, type Replay } from '../packages/model-adapters/index.js';
import { visionProvider, decisionsProvider } from '../packages/model-adapters/interfaces.js';
const replay = JSON.parse(await readFile('tests/fixtures/model-replay.json', 'utf8')) as Replay;
const image = { mediaType: 'image/png' as const, base64: 'iVBORw0KGgo=' };
test('provider interfaces require explicit replay and never attach a replay fallback to live mode', async () => {
  assert.throws(()=>visionProvider('replay','learner'),/explicit-replay/);
  assert.throws(()=>decisionsProvider('live',replay),/cannot-have-replay-fallback/);
  const learner=visionProvider('replay','learner',replay);
  const planner=visionProvider('replay','planner',replay);
  assert.notEqual(learner,planner);
  assert.equal((await learner.checkVision(image)).mode,'replay');
  assert.equal((await decisionsProvider('replay',replay).checkDecisions([image])).mode,'replay');
});
test('replay is explicitly labeled; invalid model results cannot pass', async () => {
  assert.equal((await llama('replay', image, replay)).provenance, 'hand-authored-synthetic');
  assert.equal((await snap('replay', [image], replay)).mode, 'replay');
  await assert.rejects(llama('replay', image, { ...replay, llama: {} }), /invalid-envelope/);
  await assert.rejects(snap('replay', [], replay), /missing-required/);
  assert.throws(() => parseSnap({ model: 'subq-snap-1.1', answers: {}, usage: {} }), /question-mismatch/);
  const wrong = structuredClone(replay.snap) as any;
  wrong.answers.matches.noul = 1.2;
  assert.throws(() => parseSnap(wrong), /invalid-envelope/);
  const unknown = structuredClone(replay.snap) as any;
  unknown.answers.evidence.choice = 'invented';
  assert.throws(() => parseSnap(unknown), /choice-mismatch/);
});
test('image limits and explicit cloud gate', async () => {
  assert.throws(() => checkImages(Array(5).fill(image)), /count-limit/);
  assert.throws(() => checkImages([{ ...image, base64: 'data:bad' }]), /invalid-base64/);
  const before = process.env.HARNESS_CLOUD_ENABLED; delete process.env.HARNESS_CLOUD_ENABLED;
  try { await assert.rejects(llama('live', image), /cloud-processing-disabled/); }
  finally { if (before !== undefined) process.env.HARNESS_CLOUD_ENABLED = before; }
});
test('provider outages and malformed live responses remain errors; never replay fallback', async () => {
  const savedFetch = globalThis.fetch;
  const savedCloud = process.env.HARNESS_CLOUD_ENABLED;
  const savedKey = process.env.SUBQ_API_KEY;
  process.env.HARNESS_CLOUD_ENABLED = '1'; process.env.SUBQ_API_KEY = 'synthetic-test-key';
  try {
    globalThis.fetch = async () => new Response('untrusted provider error body', { status: 503 });
    await assert.rejects(snap('live', [image]), /^Error: provider-http-503$/);
    globalThis.fetch = async () => new Response('{"bad":"shape"}', { status: 200 });
    await assert.rejects(snap('live', [image]), /snap-invalid-envelope/);
    globalThis.fetch = async () => { throw new Error('untrusted timeout details'); };
    await assert.rejects(snap('live', [image]), /^Error: provider-network-or-timeout$/);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedCloud === undefined) delete process.env.HARNESS_CLOUD_ENABLED; else process.env.HARNESS_CLOUD_ENABLED = savedCloud;
    if (savedKey === undefined) delete process.env.SUBQ_API_KEY; else process.env.SUBQ_API_KEY = savedKey;
  }
});
