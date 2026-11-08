import { ActionRequest, type ActionRequest as Request } from '../../contracts/src/schemas.js';

export interface BrowserObservation {
  runId: string; sessionId: string; tabId: number; windowId: number; documentId: string; origin: string;
  sequence: number; observedAt: string; cssWidth: number; cssHeight: number;
  screenshotWidth: number; screenshotHeight: number;
}
// Transport only. Does not confer authorization, plan actions, or assert task success.
export interface BrowserTransport {
  observe(): Promise<BrowserObservation>;
  dispatch(request: Request): Promise<void>;
  detach(): Promise<void>;
}
export function validateAction(input: unknown, observation: BrowserObservation, now: Date): Request {
  const action = ActionRequest.parse(input);
  if (![observation.cssWidth,observation.cssHeight].every(value=>Number.isFinite(value)&&value>0) || !Number.isFinite(+now) || !Number.isFinite(Date.parse(observation.observedAt))) throw new Error('invalid-observation-context');
  if (Date.parse(action.createdAt) > +now || Date.parse(action.expiresAt) <= +now || +now - Date.parse(observation.observedAt) > 10000 || Date.parse(observation.observedAt) > +now) throw new Error('stale-action-or-observation');
  for (const key of ['runId', 'sessionId', 'tabId', 'windowId', 'documentId', 'origin'] as const) {
    if (action[key] !== observation[key]) throw new Error('action-scope-mismatch');
  }
  if (action.observationSequence !== observation.sequence) throw new Error('observation-sequence-mismatch');
  if (action.action.kind === 'click' && (action.action.x >= observation.cssWidth || action.action.y >= observation.cssHeight)) throw new Error('action-outside-viewport');
  return action;
}
export function screenshotToCSS(x: number, y: number, observation: BrowserObservation) {
  if (![x, y, observation.cssWidth, observation.cssHeight, observation.screenshotWidth, observation.screenshotHeight].every(Number.isFinite)
    || observation.cssWidth <= 0 || observation.cssHeight <= 0 || observation.screenshotWidth <= 0 || observation.screenshotHeight <= 0
    || x < 0 || y < 0 || x >= observation.screenshotWidth || y >= observation.screenshotHeight) throw new Error('invalid-screenshot-coordinates');
  return { x: x * observation.cssWidth / observation.screenshotWidth, y: y * observation.cssHeight / observation.screenshotHeight };
}
