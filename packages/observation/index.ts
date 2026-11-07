import { ObservationEvent } from '../contracts/src/index.js';
export function acceptedHumanObservation(input: unknown) {
  const event=ObservationEvent.parse(input);
  if (event.provenance!=='human' || event.approvedOrigin!=='http://127.0.0.1:3210') throw new Error('excluded-observation');
  return event;
}
