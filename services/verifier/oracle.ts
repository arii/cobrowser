export interface Task { team: 'red' | 'blue'; asOf: string; timezone: string }
export function previousWeek(task: Task) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: task.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(task.asOf));
  const part = (name: string) => Number(parts.find(p => p.type === name)!.value);
  const localDate = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7;
  const end = new Date(+localDate - daysSinceMonday * 86400000);
  const start = new Date(+end - 7 * 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), timezone: task.timezone };
}
// Independently authored oracle snapshot. No import from fixture/export code.
// Public tests are not hidden evaluation data. Distinct ownership/review remains Phase 2 work.
const facts: [string, number, number][] = [
  ['2026-10-19',119,219],['2026-10-20',120,220],['2026-10-21',121,221],['2026-10-22',122,222],
  ['2026-10-23',123,223],['2026-10-24',124,224],['2026-10-25',125,225],
  ['2026-10-26',126,226],['2026-10-27',127,227],['2026-10-28',128,228],['2026-10-29',129,229],
  ['2026-10-30',130,230],['2026-10-31',131,231],['2026-11-01',101,201],
];
export function inspectCSV(bytes: Buffer, task: Task) {
  const range = previousWeek(task);
  const selected = facts.filter(([date]) => date >= range.start && date < range.end);
  if (selected.length !== 7) throw new Error('Oracle dataset does not cover task');
  const expected = ['team,date,value', ...selected.map(([date, red, blue]) => `${task.team},${date},${task.team === 'red' ? red : blue}`)].join('\n') + '\n';
  const actual = bytes.toString('utf8').replace(/\r\n/g, '\n');
  return { verdict: actual === expected ? 'passed' : 'failed', range, team: task.team,
    assertions: { schema: actual.split('\n')[0] === 'team,date,value', exactRows: actual === expected }, expected, actual };
}
