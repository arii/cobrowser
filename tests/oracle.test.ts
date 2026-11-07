import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previousWeek, inspectCSV } from '../services/verifier/oracle.js';
test('explicit timezone determines previous calendar week across local Sunday/Monday', () => {
  const task = { team: 'red' as const, asOf: '2026-11-02T00:30:00Z', timezone: 'America/Los_Angeles' };
  assert.equal(previousWeek(task).start, '2026-10-19');
  assert.equal(previousWeek({ ...task, timezone: 'Asia/Tokyo' }).start, '2026-10-26');
  assert.equal(previousWeek({ ...task, asOf: '2026-01-01T12:00:00Z' }).start, '2025-12-22');
  assert.equal(inspectCSV(Buffer.from('team,date,value\n'), task).verdict, 'failed');
});
