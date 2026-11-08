import { llama, snap, type Image, type Mode, type Replay } from './index.js';

// Phase 1 capability boundary. Learning/planning prompts and generic typed decision
// criteria are deliberately Phase 2/4 work; these methods do not generate skills.
export type ProviderContext = 'learner' | 'planner' | 'verifier-scenarios' | 'supervisor';
export interface VisionProvider {
  readonly family: 'meta-llama';
  readonly mode: Mode;
  readonly context: Exclude<ProviderContext, 'supervisor'>;
  checkVision(image: Image): ReturnType<typeof llama>;
}
export interface DecisionsProvider {
  readonly family: 'subq-snap';
  readonly mode: Mode;
  readonly context: 'supervisor';
  checkDecisions(images: Image[]): ReturnType<typeof snap>;
}
function checkReplay(mode: Mode, replay?: Replay) {
  if (mode !== 'live' && mode !== 'replay') throw new Error('invalid-provider-mode');
  if (mode === 'replay' && replay?.provenance !== 'hand-authored-synthetic') throw new Error('explicit-replay-fixture-required');
  if (mode === 'live' && replay) throw new Error('live-provider-cannot-have-replay-fallback');
}
export function visionProvider(mode: Mode, context: VisionProvider['context'], replay?: Replay): VisionProvider {
  checkReplay(mode, replay);
  return Object.freeze({ family: 'meta-llama', mode, context, checkVision: (image: Image) => llama(mode, image, replay) });
}
export function decisionsProvider(mode: Mode, replay?: Replay): DecisionsProvider {
  checkReplay(mode, replay);
  return Object.freeze({ family: 'subq-snap', mode, context: 'supervisor', checkDecisions: (images: Image[]) => snap(mode, images, replay) });
}
