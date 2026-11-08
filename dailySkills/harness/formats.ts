// Skill data structures under test. Each builder turns a case into a library entry the extension can run.
import { randomUUID } from 'node:crypto';
import type { Case } from './cases.js';

export type FormatId = 'literal' | 'outcome';
export const FORMATS: FormatId[] = ['literal', 'outcome'];

const paramName = (index: number) => `input_${index + 1}`;

/** Today's library shape, exactly what skill-learning.js produces from a recording. */
export function literal(testCase: Case, origin: string) {
  return {
    id: randomUUID(), title: testCase.id, customTitle: true, origin, sites: [{ id: 'main', url: `${origin}/` }],
    steps: testCase.steps.map((step, index) => ({ kind: step.kind, target: step.target, parameter: step.kind === 'change' ? paramName(index) : null })),
    examples: [{ at: new Date().toISOString(), eventIds: ['harness-example'], effect: 'content-changed' }],
    evidenceIds: ['harness-example'], exampleCount: 1, qualityVersion: 3,
    reusability: { reusable: true, confidence: 0.88, source: 'local', reason: 'Harness fixture.' },
    assessment: 'Harness-built skill.', active: true, savedAt: new Date().toISOString(),
  };
}

/** The day-miner contract (dailySkills/day-miner/CONTRACT.md): outcome block + parameter descriptions. */
export function outcomeContract(testCase: Case, origin: string) {
  return {
    schemaVersion: 'dayskill-1', id: randomUUID(), title: testCase.id, summary: testCase.intent, whenToUse: testCase.intent,
    sites: [{ id: 'main', url: `${origin}/` }],
    steps: testCase.steps.map((step, index) => ({
      kind: step.kind, siteId: 'main', target: step.target,
      ...(step.kind === 'change' ? { parameter: { name: paramName(index), description: step.param?.description ?? '' } } : {}),
      evidence: ['harness-example'],
    })),
    outcome: testCase.outcome,
    examples: [{ at: new Date().toISOString(), eventIds: ['harness-example'], effect: 'content-changed' }],
    evidence: { sessionIds: ['harness'], day: new Date().toISOString().slice(0, 10), eventIds: ['harness-example'] },
    generator: { provider: 'harness', model: 'none', promptVersion: 'fixture' },
    confidence: 0.9, blockers: [] as string[],
  };
}

/** Translation the contract specifies, so the current extension executor can run a contract skill. */
export function contractToLibrary(skill: ReturnType<typeof outcomeContract>) {
  return {
    id: skill.id, title: skill.title, customTitle: true, origin: new URL(skill.sites[0].url).origin, sites: skill.sites,
    steps: skill.steps.map(step => ({ kind: step.kind, siteId: step.siteId, target: step.target, parameter: step.parameter?.name ?? null, parameterDescription: step.parameter?.description })),
    outcome: skill.outcome, examples: skill.examples, evidenceIds: skill.evidence.eventIds, exampleCount: skill.examples.length, qualityVersion: 3,
    reusability: { reusable: true, confidence: skill.confidence, source: 'model', reason: skill.summary },
    assessment: skill.summary, learnedBy: 'day-miner', active: true, savedAt: new Date().toISOString(),
  };
}

export function build(format: FormatId, testCase: Case, origin: string) {
  return format === 'literal' ? literal(testCase, origin) : contractToLibrary(outcomeContract(testCase, origin));
}
