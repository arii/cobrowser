import { SkillRevision, checkContentHash } from '../contracts/src/index.js';
export function validateRevision(input: unknown) { const revision=SkillRevision.parse(input);checkContentHash(revision);return revision; }
// Execution is deliberately absent until a trusted approval/runtime boundary exists.
