import { SCHEMA_VERSION } from '../../packages/contracts/src/index.js';
console.log(JSON.stringify({ worker:'verifier-supervisor',schemaVersion:SCHEMA_VERSION,state:'scaffold',verificationEnabled:false,isolation:'not-provisioned' }));
