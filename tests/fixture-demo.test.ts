import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixture } from '../apps/fixture-site/server.js';
import { inspectCSV, previousWeek, type Task } from '../services/verifier/oracle.js';

const tasks: Task[] = [
  { team: 'red', asOf: '2026-11-07T20:00:00Z', timezone: 'America/Los_Angeles' },
  { team: 'blue', asOf: '2026-11-02T00:30:00Z', timezone: 'America/Los_Angeles' },
  { team: 'blue', asOf: '2026-11-02T00:30:00Z', timezone: 'Asia/Tokyo' },
];

test('demo downloads satisfy explicit task contracts across the timezone boundary', async () => {
  const fixture = await startFixture();
  try {
    for (const task of tasks) {
      const { start, end } = previousWeek(task);
      const response = await fetch(`${fixture.origin}/export?${new URLSearchParams({ team: task.team, start, end })}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^text\/csv/);
      assert.match(response.headers.get('content-disposition') ?? '', /attachment; filename="report\.csv"/);
      const report = inspectCSV(Buffer.from(await response.arrayBuffer()), task);
      assert.equal(report.verdict, 'passed', JSON.stringify({ task, report }));
      assert.deepEqual(fixture.audit.at(-1), { team: task.team, start, end });
    }
    assert.equal(fixture.audit.length, tasks.length);
  } finally {
    await fixture.close();
  }
});

test('wrong-week demo still downloads a CSV but independent artifact verification rejects it', async () => {
  const fixture = await startFixture(true);
  try {
    const task = tasks[0]!;
    const { start, end } = previousWeek(task);
    const response = await fetch(`${fixture.origin}/export?${new URLSearchParams({ team: task.team, start, end })}`);
    assert.equal(response.status, 200);
    const report = inspectCSV(Buffer.from(await response.arrayBuffer()), task);
    assert.equal(report.verdict, 'failed');
    assert.equal(report.assertions.schema, true);
    assert.equal(report.assertions.exactRows, false);
    assert.equal(fixture.audit.length, 1);
    assert.notEqual(fixture.audit[0]!.start, start);
  } finally {
    await fixture.close();
  }
});

test('invalid export requests return no CSV and do not enter the export audit', async () => {
  const fixture = await startFixture();
  try {
    for (const query of [
      '',
      'team=green&start=2026-10-26&end=2026-11-02',
      'team=red&start=invalid&end=2026-11-02',
      'team=red&start=2026-10-26',
    ]) {
      const response = await fetch(`${fixture.origin}/export?${query}`);
      assert.equal(response.status, 400, query);
      assert.equal(response.headers.get('content-disposition'), null);
      assert.equal(await response.text(), '');
    }
    assert.deepEqual(fixture.audit, []);
  } finally {
    await fixture.close();
  }
});
