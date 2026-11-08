import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

interface LiveTask {
  id: string;
  latencyMs: number | null;
  chars: number | null;
  refused: boolean | null;
  temporalStale: boolean | null;
  unitsPassed: boolean | null;
  excerpt: string;
}
interface LiveFixture {
  asOf: string;
  endpoint: string;
  model: string;
  results: LiveTask[];
}
interface SnapFixture {
  model: string;
  latencyMs: number;
  capabilityPassed: boolean;
  verdict: string;
  answers: {
    matchesNoul: number;
    evidenceChoice: string;
    evidenceConfidence: number;
    qualityScore: number;
  };
}

const live = JSON.parse(
  readFileSync(new URL('./fixtures/agentverse-live-20261107.json', import.meta.url), 'utf8'),
) as LiveFixture;
const snap = JSON.parse(
  readFileSync(new URL('./fixtures/subq-snap-live-20261107.json', import.meta.url), 'utf8'),
) as SnapFixture;

const byId = (id: string): LiveTask => {
  const task = live.results.find((t) => t.id === id);
  assert.ok(task, `missing live task ${id}`);
  return task;
};

test('live Fetch.ai run covers all 7 hackathon tasks', () => {
  assert.equal(live.asOf, '2026-11-07');
  assert.equal(live.endpoint, 'https://api.asi1.ai/v1/chat/completions');
  assert.deepEqual(
    live.results.map((t) => t.id),
    ['sf-hackathons', 'sf-weather', 'asics-cheapest', 'linkedin-reply', 'discord-summary', 'grocery-list', 'job-application'],
  );
  for (const task of live.results) {
    assert.ok(typeof task.latencyMs === 'number' && task.latencyMs > 0);
    assert.ok(task.excerpt.length > 0);
  }
});

test('live-data tasks are refused or stale: the verifier catches what trust cannot prove', () => {
  // Tasks needing live ground truth: agent declines instead of answering.
  assert.equal(byId('sf-hackathons').refused, true);
  assert.equal(byId('asics-cheapest').refused, true);
  // Grocery list guessed from stale training data: late-2025 prices.
  assert.equal(byId('grocery-list').temporalStale, true);
  // Pure text tasks answer without refusal or staleness.
  for (const id of ['linkedin-reply', 'discord-summary', 'job-application']) {
    assert.equal(byId(id).refused, false);
    assert.equal(byId(id).temporalStale, false);
  }
});

test('weather task carries Fahrenheit and jacket advice (lenient live check)', () => {
  assert.equal(byId('sf-weather').unitsPassed, true);
});

test('live SubQ Snap probe passed on synthetic evidence', () => {
  assert.equal(snap.model, 'subq-snap-1.1');
  assert.equal(snap.capabilityPassed, true);
  assert.equal(snap.verdict, 'probe-passed');
  assert.ok(snap.answers.matchesNoul >= 0.9);
  assert.equal(snap.answers.evidenceChoice, 'match');
  assert.ok(snap.answers.evidenceConfidence >= 0.9);
  assert.ok(snap.answers.qualityScore >= 0 && snap.answers.qualityScore <= 2);
});
