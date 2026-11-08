import { skillInputHandler } from '../packages/skill-runtime/input-planner.js';
import { resolveSkillInput } from '../packages/model-adapters/skill-input.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { nativeFrame, nativeDecoder } from '../packages/context-brain/native-protocol.js';
import { nativeBrainHandler } from '../packages/context-brain/native-handler.js';
import { liveContextProviders } from '../packages/model-adapters/context.js';
import { syntheticContextProviders } from '../packages/context-brain/replay.js';

// stdout contains ONLY Chrome native-messaging packets. Provider keys stay here.
const allowed='chrome-extension://afchllcepipgheklaapddihncbpmfocl/';
if(process.argv[2]!==allowed)process.exit(2);
const send=(value:unknown)=>process.stdout.write(nativeFrame(value));
try {
  let handle:ReturnType<typeof nativeBrainHandler>|undefined;
  const observe=(message:unknown)=>{
    if(!handle){const providers=process.env.COBROWSER_CONTEXT_REPLAY==='1'?syntheticContextProviders():liveContextProviders();handle=nativeBrainHandler(providers,send,{historyRoot:process.env.COBROWSER_HISTORY_ROOT??join(homedir(),'Library/Application Support/Cobrowser/context-history')});}
    return handle(message);
  };
  process.stdin.on('data',nativeDecoder(message=>{
    const skillRequest=(message as {kind?:string})?.kind==='skill-input';
    void (skillRequest?skillInputHandler(resolveSkillInput)(message):Promise.resolve().then(()=>observe(message))).then(send,error=>{
      const seq=(message as {seq?:number})?.seq;
      send({v:1,kind:skillRequest?'skill-input-error':'brain-error',seq:Number.isSafeInteger(seq)?seq:0,code:error instanceof Error&&/^(context|skill)-[a-z-]+$/.test(error.message)?error.message:skillRequest?'skill-input-provider-unavailable':'context-invalid-message'});
    });
  },()=>process.exit(3)));
  process.stdin.on('end',()=>process.exit(0));
} catch {
  send({v:1,kind:'brain-error',seq:0,code:'context-configuration-unavailable'});process.exitCode=2;
}
