import { pathToFileURL } from 'node:url';
import { type VerificationAuthority, type VerificationReport } from '../../packages/contracts/src/index.js';
import { type HarnessStore } from '../../packages/storage/src/index.js';
import { executeProcedure, type ProcedureTransport } from '../../packages/skill-runtime/index.js';

// Local supervisor API. Do not hand the authority or this object to learner IPC.
export class SkillRegistry {
  constructor(private readonly store: HarnessStore, private readonly authority: VerificationAuthority) {}
  submit(report: VerificationReport, options: Parameters<HarnessStore['applyVerification']>[1]) {
    return this.store.applyVerification(report, options, this.authority);
  }
  quarantine(report: VerificationReport, options: Parameters<HarnessStore['quarantineAndRollback']>[1]) {
    return this.store.quarantineAndRollback(report, options, this.authority);
  }
  async execute(skillId: string, suiteId: string, parameters: Record<string,string>, transport: ProcedureTransport, options: {userConfirmed:boolean;signal?:AbortSignal}) {
    // Recheck the exact approved pointer and context before every runtime step.
    let interpreterStarted=false;
    try {
      if (!options.userConfirmed) throw new Error('execution-requires-user-activation');
      const active=this.store.authorizeActiveSkill(skillId,suiteId,this.authority);
      const revision=active.revision!;
      interpreterStarted=true;
      return await executeProcedure(revision,active.contract,parameters,transport,{signal:options.signal,authorize:()=>{
        try {const current=this.store.authorizeActiveSkill(skillId,suiteId,this.authority);return current.revision?.contentHash===revision.contentHash&&current.generation===active.generation;}catch{return false;}
      }});
    } catch(error) { if(!interpreterStarted)await transport.detach();throw error; }
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify({worker:'registry',state:'local-api',authenticatedPromotion:true,rollback:true,ipcEnabled:false,isolation:'same-user-process; supervisor authority required'}));
