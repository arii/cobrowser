import { Demonstration, ObservationEvent, SkillRevision, VisualFrame, TaskContract, newId, hashBytes, seal } from '../../packages/contracts/src/index.js';
export function synthetic(now = '2026-11-07T20:00:00.000Z') {
  const bytes = Buffer.from('SYNTHETIC_PIXEL_CONTENT_NOT_USER_DATA');
  const frame = VisualFrame.parse({ schemaVersion: 1, id: newId(), captureSource: 'synthetic', utc: now,
    monotonicNs: '123456789', width: 100, height: 50, scale: 1, bindingId: newId(), crop: { x: 0, y: 0, width: 100, height: 50 },
    masks: [], privacyPolicyVersion: 'synthetic-v1', encryptionRef: { artifactId: newId(), keyId: 'artifact-key-v1', algorithm: 'aes-256-gcm' }, contentHash: hashBytes(bytes) });
  const event = ObservationEvent.parse({ schemaVersion: 1, id: newId(), utc: now, monotonicNs: '123456790', browserId: 'synthetic-chrome',
    connectionId: newId(), windowId: 1, tabId: 1, documentId: 'synthetic-document', frameId: 'main', sequence: 1,
    approvedOrigin: 'http://127.0.0.1:3210', kind: 'download', target: { role: 'button', label: 'Export', sensitive: false }, frameRef: frame.id, provenance: 'human' });
  const demonstration = Demonstration.parse({ schemaVersion: 1, id: newId(), taskFamily: 'previous-week-report', createdAt: now,
    eventIds: [event.id], frameIds: [frame.id], artifactIds: [], inputs: { team: 'red', timezone: 'America/Los_Angeles', note: 'SYNTHETIC_PRIVATE_PARAMETER' },
    outcome: { independentlyObserved: true, kind: 'download', evidenceIds: [event.id] }, humanCorrections: [], assignment: 'train', provenance: 'human' });
  const contract=TaskContract.parse(seal({schemaVersion:1,id:newId(),version:1,inputSchema:{team:{type:'string',enum:['red','blue']}},timezone:'America/Los_Angeles',previousWeek:'monday-to-monday-end-exclusive',allowedOrigins:['http://127.0.0.1:3210'],allowedEffects:['input','download'],artifactAssertions:['csv-exact-rows'],stateAssertions:[],semanticCriteria:[],controlledStopRules:['expired-session'],limits:{maxActions:20,maxDurationMs:60000,maxModelCalls:3,maxArtifactBytes:1048576}}));
  const revision = SkillRevision.parse(seal({ schemaVersion: 1, id: newId(), skillId: newId(), parentHash: null, contractHash: contract.contentHash, createdAt: now,
    parameterSchema: { team: { type: 'string', enum: ['red', 'blue'] } }, procedure: [{ kind: 'observe' }, { kind: 'download', target: 'Export' }],
    requestedCapabilities: ['observe-approved-tab', 'download-approved-artifact'], demonstrationIds: [demonstration.id],
    generator: { provider: 'meta-llama', model: 'synthetic-replay-llama', promptVersion: 'phase1-synthetic-v1', mode: 'replay' } }));
  return { frame, event, demonstration, revision, contract, bytes };
}
