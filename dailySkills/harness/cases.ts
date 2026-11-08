// Fixture tasks with ground truth. Each case is what a user did once; formats turn it into a skill shape.
import type { Task } from '../../services/verifier/oracle.js';

export interface Target { tag: 'BUTTON' | 'A' | 'INPUT' | 'SELECT' | 'TEXTAREA'; label: string; type: string }
export interface CaseStep {
  kind: 'click' | 'change';
  target: Target;
  /** change steps only: the value the run should end up entering, and how the intent describes it */
  param?: { description: string; value: string };
}
export interface Truth {
  /** grade the downloaded CSV bytes with the independent oracle */
  csv?: Task;
  /** the export the server must have seen */
  audit?: { team: string; start: string; end: string };
  /** text the page's #activity status must contain afterwards (no download expected) */
  activity?: string;
}
export interface Case {
  id: string;
  intent: string;           // what the user was trying to do, in words (the run instruction)
  steps: CaseStep[];
  outcome: { kind: 'page-changed' | 'navigation' | 'form-submitted' | 'download'; description: string; check?: { titleIncludes?: string; textIncludes?: string } };
  inputs: 'stub-model' | 'overrides';   // how change-step values reach the run
  truth: Truth;
}

// The fixture's default week is 2026-10-26 → 2026-11-02, which is the previous calendar week for this asOf in LA.
export const AS_OF = '2026-11-07T20:00:00Z';
export const TIMEZONE = 'America/Los_Angeles';
export const WEEK = { start: '2026-10-26', end: '2026-11-02' };

const team: Target = { tag: 'SELECT', label: 'Team', type: '' };
const start: Target = { tag: 'INPUT', label: 'Start inclusive', type: '' };
const end: Target = { tag: 'INPUT', label: 'End exclusive', type: '' };
const exportCsv: Target = { tag: 'BUTTON', label: 'Export CSV', type: 'submit' };
const reset: Target = { tag: 'BUTTON', label: 'Reset filters ↺', type: 'button' };

export const CASES: Case[] = [
  {
    id: 'export-default',
    intent: 'Export the CSV report for the red team for the previous calendar week.',
    steps: [{ kind: 'click', target: exportCsv }],
    outcome: { kind: 'download', description: 'The CSV for the selected week downloads and the page confirms the export.', check: { textIncludes: 'Export successful' } },
    inputs: 'overrides',
    truth: { csv: { team: 'red', asOf: AS_OF, timezone: TIMEZONE }, audit: { team: 'red', ...WEEK } },
  },
  {
    id: 'export-blue-week',
    intent: 'Export the CSV report for the blue team for the previous calendar week.',
    steps: [
      { kind: 'change', target: team, param: { description: 'Which team the report is for, red or blue.', value: 'blue' } },
      { kind: 'change', target: start, param: { description: 'First day of the week, inclusive, as YYYY-MM-DD.', value: WEEK.start } },
      { kind: 'change', target: end, param: { description: 'Day after the last day of the week, exclusive, as YYYY-MM-DD.', value: WEEK.end } },
      { kind: 'click', target: exportCsv },
    ],
    outcome: { kind: 'download', description: 'The CSV for the blue team and the requested week downloads.', check: { textIncludes: 'Export successful' } },
    inputs: 'stub-model',
    truth: { csv: { team: 'blue', asOf: AS_OF, timezone: TIMEZONE }, audit: { team: 'blue', ...WEEK } },
  },
  {
    id: 'export-blue-week-overrides',
    intent: 'Export the CSV report for the blue team for the previous calendar week.',
    steps: [
      { kind: 'change', target: team, param: { description: 'Which team the report is for, red or blue.', value: 'blue' } },
      { kind: 'change', target: start, param: { description: 'First day of the week, inclusive, as YYYY-MM-DD.', value: WEEK.start } },
      { kind: 'change', target: end, param: { description: 'Day after the last day of the week, exclusive, as YYYY-MM-DD.', value: WEEK.end } },
      { kind: 'click', target: exportCsv },
    ],
    outcome: { kind: 'download', description: 'The CSV for the blue team and the requested week downloads.', check: { textIncludes: 'Export successful' } },
    inputs: 'overrides',
    truth: { csv: { team: 'blue', asOf: AS_OF, timezone: TIMEZONE }, audit: { team: 'blue', ...WEEK } },
  },
  {
    id: 'reset-then-export',
    intent: 'Reset the filters, switch to the blue team and export the CSV.',
    steps: [
      { kind: 'click', target: reset },
      { kind: 'change', target: team, param: { description: 'Which team the report is for, red or blue.', value: 'blue' } },
      { kind: 'click', target: exportCsv },
    ],
    outcome: { kind: 'download', description: 'The CSV for the blue team downloads after the filters were reset.', check: { textIncludes: 'Export successful' } },
    inputs: 'stub-model',
    truth: { csv: { team: 'blue', asOf: AS_OF, timezone: TIMEZONE }, audit: { team: 'blue', ...WEEK } },
  },
  {
    id: 'preview-team',
    intent: 'Switch the report preview to the blue team without exporting.',
    steps: [{ kind: 'change', target: team, param: { description: 'Which team to preview, red or blue.', value: 'blue' } }],
    outcome: { kind: 'page-changed', description: 'The preview table and chart show the blue team.', check: { textIncludes: 'Preview updated · blue team' } },
    inputs: 'overrides',
    truth: { activity: 'Preview updated · blue team' },
  },
];
