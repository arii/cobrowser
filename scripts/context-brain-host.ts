import { nativeFrame, nativeDecoder } from '../packages/context-brain/native-protocol.js';
import { nativeBrainHandler } from '../packages/context-brain/native-handler.js';
import { liveContextProviders } from '../packages/model-adapters/context.js';
import { syntheticContextProviders } from '../packages/context-brain/replay.js';

// stdout contains ONLY Chrome native-messaging packets. Provider keys stay here.
const allowed='chrome-extension://afchllcepipgheklaapddihncbpmfocl/';
if(process.argv[2]!==allowed)process.exit(2);
const send=(value:unknown)=>process.stdout.write(nativeFrame(value));
try {
  const providers=process.env.COBROWSER_CONTEXT_REPLAY==='1'?syntheticContextProviders():liveContextProviders();
  const handle=nativeBrainHandler(providers,send);
  process.stdin.on('data',nativeDecoder(message=>{
    void handle(message).then(send,error=>{
      const seq=(message as {seq?:number})?.seq;
      send({v:1,kind:'brain-error',seq:Number.isSafeInteger(seq)?seq:0,code:error instanceof Error&&/^context-[a-z-]+$/.test(error.message)?error.message:'context-invalid-message'});
    });
  },()=>process.exit(3)));
  process.stdin.on('end',()=>process.exit(0));
} catch {
  send({v:1,kind:'brain-error',seq:0,code:'context-configuration-unavailable'});process.exitCode=2;
}
