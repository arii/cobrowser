import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// @ts-expect-error Legacy extension JavaScript has no declaration file.
import { normalizeDatasetRecording, datasetTasks } from '../apps/extension/dataset-recording.js';
// @ts-expect-error Legacy extension JavaScript has no declaration file.
import { validEvent } from '../apps/extension/recording-events.js';

const sample = async () => JSON.parse(await readFile(new URL('../dailySkills/data/recordings/psai-merged.json', import.meta.url), 'utf8'));
const justAfter = (state: {events: {at: string}[]}) => Date.parse(state.events.at(-1)!.at) + 60_000;

test('accepts a converted dataset recording and strips what the recorder does not store', async () => {
  const input = await sample();
  const { state, tasks, expired, dropped } = normalizeDatasetRecording(input, { now: justAfter(input), generation: 'gen-1' });
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.historyGeneration, 'gen-1');
  assert.equal(state.sessionId, input.sessionId);
  assert.equal(state.events.length, input.events.length);
  assert.equal(state.tabs.length, input.tabs.length);
  assert.equal(state.tabCount, state.tabs.length);
  assert.equal('source' in state, false);
  assert.equal(expired, 0); assert.equal(dropped, 0);
  assert.equal(tasks.length, input.tabs.length);
  assert.ok(tasks.every((task: {task: string}) => task.task.length > 0));
  for (const event of state.events) {
    const content = Object.fromEntries(Object.entries(event).filter(([key]) => ['kind','tag','x','y','key','target','formTargets'].includes(key)));
    assert.ok(validEvent(content));
  }
});

test('enforces the 24-hour window and the live event cap', async () => {
  const input = await sample();
  assert.throws(() => normalizeDatasetRecording(input, { now: justAfter(input) + 48 * 3600_000 }), /dataset-all-events-expired/);
  const halfway = Date.parse(input.events[Math.floor(input.events.length / 2)].at) + 24 * 3600_000;
  const partial = normalizeDatasetRecording(input, { now: halfway });
  assert.ok(partial.expired > 0 && partial.state.events.length === input.events.length - partial.expired);
  const capped = normalizeDatasetRecording(input, { now: justAfter(input), limit: 10 });
  assert.equal(capped.state.events.length, 10); assert.equal(capped.dropped, input.events.length - 10);
});

test('rejects anything the recorder would not have stored', async () => {
  const input = await sample();
  const now = justAfter(input);
  const mutate = (change: (events: Record<string, unknown>[]) => void) => { const copy = structuredClone(input); change(copy.events); return copy; };
  assert.throws(() => normalizeDatasetRecording({ ...input, schemaVersion: 2 }, { now }), /unsupported-schema/);
  assert.throws(() => normalizeDatasetRecording(mutate(events => { events[0].value = 'typed text'; }), { now }), /unknown-field-value/);
  assert.throws(() => normalizeDatasetRecording(mutate(events => { events[0].kind = 'keypress'; }), { now }), /rejected-by-recorder/);
  assert.throws(() => normalizeDatasetRecording(mutate(events => { events[0].sessionId = 'other'; }), { now }), /session-mismatch/);
  assert.throws(() => normalizeDatasetRecording(mutate(events => { events[0].origin = 'https://example.com/path?q=1'; }), { now }), /bad-origin/);
  assert.throws(() => normalizeDatasetRecording(mutate(events => { events[0].provenance = 'agent'; }), { now }), /not-human/);
  assert.throws(() => normalizeDatasetRecording(mutate(events => { events[1].id = events[0].id; }), { now }), /duplicate-event-ids/);
  assert.throws(() => normalizeDatasetRecording(mutate(events => { [events[0].at, events[1].at] = [events[1].at, events[0].at]; }), { now }), /out-of-order/);
  assert.throws(() => normalizeDatasetRecording({ schemaVersion: 1, sessionId: 's', events: [] }, { now }), /no-events/);
  assert.deepEqual(datasetTasks(undefined), []);
  assert.equal(datasetTasks({ task: 'Find a recipe', site: 'Allrecipes' })[0].site, 'Allrecipes');
});
