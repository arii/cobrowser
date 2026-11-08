import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planPlayback, type PlaybackEventInput } from '../apps/extension/playback-plan.js';

let n = 0;
const evt = (over: Partial<PlaybackEventInput> = {}): PlaybackEventInput => {
  n += 1;
  return {
    id: `event-${n}`, at: new Date(1000 + n * 100).toISOString(), sessionId: 'session-a',
    origin: 'http://127.0.0.1:3210', tabId: 1, provenance: 'human',
    kind: 'click', tag: 'BUTTON', x: 0.5, y: 0.5, ...over,
  };
};

test('filtered playback keeps clicks, keys, submits and input pauses; noise is skipped', () => {
  const plan = planPlayback([
    evt({ kind: 'click', tag: 'BUTTON' }),
    evt({ kind: 'pointer', tag: 'PAGE', x: 0.1, y: 0.2 }),
    evt({ kind: 'change', tag: 'INPUT', x: undefined, y: undefined }),
    evt({ kind: 'scroll', tag: 'PAGE', x: undefined, y: undefined }),
    evt({ kind: 'key', tag: 'INPUT', key: 'Tab', x: undefined, y: undefined }),
    evt({ kind: 'page-visible', tag: 'PAGE', x: undefined, y: undefined }),
    evt({ kind: 'submit', tag: 'FORM', x: undefined, y: undefined }),
  ]);
  assert.equal(plan.mode, 'filtered');
  assert.deepEqual(plan.steps.map(step => step.kind), ['click', 'input', 'key', 'submit']);
  assert.deepEqual(plan.skipped.map(item => item.kind), ['pointer', 'scroll', 'page-visible']);
  assert.ok(plan.skipped.every(item => item.reason === 'filtered-noise'));
  assert.equal(plan.steps[0].kind, 'click');
  if (plan.steps[0].kind === 'click') assert.deepEqual([plan.steps[0].x, plan.steps[0].y], [0.5, 0.5]);
});

test('direct playback replays pointer moves and scrolls literally, in recorded order', () => {
  const plan = planPlayback([
    evt({ kind: 'pointer', tag: 'PAGE', x: 0.1, y: 0.2 }),
    evt({ kind: 'click', tag: 'BUTTON' }),
    evt({ kind: 'scroll', tag: 'PAGE', x: undefined, y: undefined }),
    evt({ kind: 'page-visible', tag: 'PAGE', x: undefined, y: undefined }),
  ], { mode: 'direct' });
  assert.deepEqual(plan.steps.map(step => step.kind), ['move', 'click', 'scroll']);
  const move = plan.steps[0];
  assert.equal(move.kind, 'move');
  if (move.kind === 'move') assert.deepEqual([move.x, move.y], [0.1, 0.2]);
  const scroll = plan.steps[2];
  assert.equal(scroll.kind, 'scroll');
  // The recorder never captures scroll distance, so direct replay states its assumption.
  if (scroll.kind === 'scroll') assert.equal(scroll.assumed, true);
  assert.ok(plan.warnings.some(warning => warning.includes('scroll')));
  assert.deepEqual(plan.skipped.map(item => [item.kind, item.reason]), [['page-visible', 'non-actionable']]);
});

test('change steps pause for a user-supplied value; recorded values never exist', () => {
  const plan = planPlayback([evt({ kind: 'change', tag: 'INPUT', x: undefined, y: undefined })]);
  assert.equal(plan.steps.length, 1);
  const step = plan.steps[0];
  assert.equal(step.kind, 'input');
  assert.ok(!('text' in step) && !('value' in step));
  if (step.kind === 'input') assert.equal(step.tag, 'INPUT');
});

test('clicks and pointers without coordinates are skipped in both modes', () => {
  const events = [evt({ kind: 'click', tag: 'BUTTON', x: undefined, y: undefined })];
  for (const mode of ['direct', 'filtered'] as const) {
    const plan = planPlayback(events, { mode });
    assert.equal(plan.steps.length, 0);
    assert.deepEqual(plan.skipped.map(item => item.reason), ['missing-coordinates']);
  }
  const direct = planPlayback([evt({ kind: 'pointer', tag: 'PAGE', x: undefined, y: undefined })], { mode: 'direct' });
  assert.deepEqual(direct.skipped.map(item => item.reason), ['missing-coordinates']);
});

test('empty input, oversized input and unknown modes are rejected', () => {
  assert.throws(() => planPlayback([]), /empty-playback/);
  assert.throws(() => planPlayback([evt()], { mode: 'random' as never }), /invalid-playback-mode/);
  const many = Array.from({ length: 2001 }, () => evt());
  assert.throws(() => planPlayback(many), /playback-event-limit/);
});

test('malformed recorded events are rejected before planning', () => {
  const bad: Partial<PlaybackEventInput>[] = [
    { kind: 'click', x: 0.5, y: undefined },
    { kind: 'key', key: 'a' as never },
    { kind: 'click', key: 'Tab' },
    { kind: 'dance' as never },
    { origin: 'not-a-url' },
    { origin: 'http://127.0.0.1:3210/?private=1' },
    { at: 'not-a-date' },
    { id: '' },
  ];
  for (const over of bad) assert.throws(() => planPlayback([evt(over)]), /invalid-playback-event/, JSON.stringify(over));
});

test('recorded order is preserved and origins are reported in first-appearance order', () => {
  const plan = planPlayback([
    evt({ origin: 'https://b.example' }),
    evt({ origin: 'http://127.0.0.1:3210' }),
    evt({ origin: 'https://b.example' }),
  ]);
  assert.deepEqual(plan.steps.map(step => step.origin), ['https://b.example', 'http://127.0.0.1:3210', 'https://b.example']);
  assert.deepEqual(plan.origins, ['https://b.example', 'http://127.0.0.1:3210']);
  assert.ok(plan.warnings.some(warning => warning.includes('origin')));
});

test('an origin scope replays only that tab family and skips foreign events openly', () => {
  const plan = planPlayback([
    evt({ origin: 'https://b.example' }),
    evt({ origin: 'http://127.0.0.1:3210' }),
    evt({ origin: 'https://b.example', kind: 'key', tag: 'INPUT', key: 'Tab', x: undefined, y: undefined }),
  ], { origin: 'https://b.example' });
  assert.deepEqual(plan.steps.map(step => step.kind), ['click', 'key']);
  assert.ok(plan.steps.every(step => step.origin === 'https://b.example'));
  assert.deepEqual(plan.skipped.map(item => [item.origin, item.reason]), [['http://127.0.0.1:3210', 'other-origin']]);
  assert.ok(plan.warnings.some(warning => warning.includes('other origin')));
});

test('an origin scope with no matching events fails instead of replaying nothing', () => {
  assert.throws(() => planPlayback([evt({ origin: 'http://127.0.0.1:3210' })], { origin: 'https://b.example' }), /no-events-for-tab/);
  assert.throws(() => planPlayback([evt()], { origin: 'not-an-origin' }), /invalid-playback-scope/);
});

test('submit and control keys map to executor steps with their metadata intact', () => {
  const plan = planPlayback([
    evt({ kind: 'submit', tag: 'FORM', x: undefined, y: undefined }),
    evt({ kind: 'key', tag: 'INPUT', key: 'Enter', x: undefined, y: undefined }),
  ]);
  assert.equal(plan.steps[0].kind, 'submit');
  assert.equal(plan.steps[1].kind, 'key');
  if (plan.steps[1].kind === 'key') assert.equal(plan.steps[1].key, 'Enter');
  assert.deepEqual(plan.skipped, []);
});
