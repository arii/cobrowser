export * from './schemas.js';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { RevisionState, RunState } from './schemas.js';

export function newId(): string { return randomUUID(); }
// Version 1: JSON encoding, code-unit sorted object keys, array order preserved.
// Deliberately rejects undefined/non-JSON values rather than silently omitting them.
export function canonicalJSON(value: unknown): string {
  const json = z.json().parse(value);
  function sort(v: z.infer<ReturnType<typeof z.json>>): unknown {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(key => [key, sort(v[key])]));
    return v;
  }
  return JSON.stringify(sort(json));
}
export const hashBytes = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const contentHash = (value: unknown): string => hashBytes(Buffer.from(canonicalJSON(value)));
export function checkContentHash(value: { contentHash: string } & Record<string, unknown>): void {
  const { contentHash: claimed, ...content } = value;
  if (claimed !== contentHash(content)) throw new Error('content-hash-mismatch');
}
export function seal<T extends Record<string, unknown>>(value: T): T & { contentHash: string } {
  if ('contentHash' in value) throw new Error('already-hashed');
  return { ...value, contentHash: contentHash(value) };
}
const revisionTransitions: Record<RevisionState, readonly RevisionState[]> = {
  draft: ['queued'], queued: ['verifying'], verifying: ['approved', 'blocked', 'inconclusive'], approved: [], blocked: [], inconclusive: [],
};
const runTransitions: Record<RunState, readonly RunState[]> = {
  created: ['running', 'cancelled'], running: ['paused', 'needs_user', 'succeeded', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'], needs_user: ['running', 'cancelled'], succeeded: [], failed: [], cancelled: [],
};
export function assertRevisionTransition(from: RevisionState, to: RevisionState) {
  if (!revisionTransitions[RevisionState.parse(from)].includes(RevisionState.parse(to))) throw new Error(`invalid-revision-transition:${from}:${to}`);
}
export function assertRunTransition(from: RunState, to: RunState) {
  if (!runTransitions[RunState.parse(from)].includes(RunState.parse(to))) throw new Error(`invalid-run-transition:${from}:${to}`);
}
export * from './verification.js';
