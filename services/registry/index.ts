import { SCHEMA_VERSION } from '../../packages/contracts/src/index.js';
console.log(JSON.stringify({ worker:'registry',schemaVersion:SCHEMA_VERSION,state:'scaffold',promotionEnabled:false,reason:'authenticated-verifier-gate-required' }));
