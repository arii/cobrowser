import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateStepDecision, type SkillStepRequest } from '../packages/skill-runtime/step-planner.js';
const request: SkillStepRequest = {
  v: 1, kind: 'skill-step', seq: 1, instruction: 'Export the blue team report', at: '2026-11-07T20:00:00.000Z', timezone: 'America/Los_Angeles',
  skill: { title: 'Export CSV', summary: 'Exports the weekly CSV.', outcome: { kind: 'download', description: 'CSV downloads.' }, step: 0, total: 2 },
  step: { kind: 'click', intent: 'Download the report', recordedTarget: { tag: 'BUTTON', label: 'Export CSV', type: 'submit' }, parameterDescription: null },
  page: { siteId: 'main', origin: 'http://127.0.0.1:1', title: 'Fixture', text: 'Weekly performance', controls: [
    { target: { tag: 'BUTTON', label: 'Download report', type: 'submit' }, options: [] }, { target: { tag: 'SELECT', label: 'Team', type: '' }, options: ['red', 'blue'] } ] },
  answers: [],
};
test('accepts a renamed control that is on the page and rejects inventions and kind mismatches', () => {
  const act = validateStepDecision({ action: 'act', target: { tag: 'BUTTON', label: 'Download report', type: 'submit' }, value: null, explanation: 'Same export button, renamed.', question: null }, request);
  assert.equal(act.target?.label, 'Download report');
  assert.throws(() => validateStepDecision({ action: 'act', target: { tag: 'BUTTON', label: 'Export CSV', type: 'submit' }, value: null, explanation: 'x', question: null }, request), /target-not-on-page/);
  assert.throws(() => validateStepDecision({ action: 'act', target: { tag: 'SELECT', label: 'Team', type: '' }, value: 'blue', explanation: 'x', question: null }, request), /kind-mismatch/);
  const change = { ...request, step: { ...request.step, kind: 'change' as const, intent: 'Choose the team' } };
  assert.equal(validateStepDecision({ action: 'act', target: { tag: 'SELECT', label: 'Team', type: '' }, value: 'blue', explanation: 'x', question: null }, change).value, 'blue');
  assert.throws(() => validateStepDecision({ action: 'act', target: { tag: 'SELECT', label: 'Team', type: '' }, value: 'green', explanation: 'x', question: null }, change), /invalid-option/);
  assert.equal(validateStepDecision({ action: 'skip', target: null, value: null, explanation: 'Already open.', question: null }, request).action, 'skip');
  assert.equal(validateStepDecision({ action: 'needs_input', target: null, value: null, explanation: 'Unclear.', question: 'Which team?' }, request).action, 'needs_input');
  assert.throws(() => validateStepDecision({ action: 'done', target: null, value: 'x', explanation: 'x', question: null }, request), /invalid-action/);
});
