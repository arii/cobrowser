import { pendingActions, acknowledgeActions } from './action-history.js';
import { currentVisualEvidence } from './visual-context.js';
// Authenticated Chrome native messaging, restricted to this extension ID by the host manifest.
// No API credentials, unauthenticated HTTP endpoint, or browser debugger connection.
export function nativeBrainLink() {
  let clientId;
  let port,latest,timer,deadline,inFlight,seq=0,retryAt=0;
  const status=(value)=>chrome.storage.local.set({brainConnection:{...value,at:new Date().toISOString()}}).catch(()=>{});
  const schedule=(state)=>{latest=state;if(!timer)timer=setTimeout(()=>{timer=undefined;void pump().catch(()=>status({status:'error',code:'context-local-history-unavailable'}));},2000);};
  async function pump(){
    if(!latest||inFlight)return;
    if(Date.now()<retryAt){schedule(latest);return;}
    const {recordingEnabled=false}=await chrome.storage.session.get('recordingEnabled');
    if(!recordingEnabled&&!port)return;
    if(!port){
      try {
        port=chrome.runtime.connectNative('com.cobrowser.context');
        void status({status:'connecting'});
        port.onMessage.addListener(async message=>{
          if(message?.v!==1 || !['brain-state','brain-error','brain-progress'].includes(message.kind))return;
          if(message.seq!==inFlight?.seq && message.seq!==0)return;
          if(message.kind==='brain-progress'){await chrome.storage.local.set({brainActivity:{phase:message.phase,at:message.at,sessionId:message.sessionId}});return;}
          const sent=inFlight;clearTimeout(deadline);inFlight=undefined;
          if(message.kind==='brain-state'){
            if(sent?.lastSequence && message.ackEventIds?.length)await acknowledgeActions(sent.lastSequence);
            const {fixtureRecording}=await chrome.storage.local.get('fixtureRecording');
            if(fixtureRecording?.sessionId===message.sessionId){
              await chrome.storage.local.set({contextBrain:message.state});
              void status({status:'connected',model:message.state.contextModel});
              await chrome.storage.local.set({brainActivity:{phase:'Waiting for the next observation interval',at:new Date().toISOString(),sessionId:message.sessionId}});
            }
          }else void status({status:'error',code:message.code??'context-native-host-error'});
          if(latest)schedule(latest);
        });
        port.onDisconnect.addListener(()=>{
          void chrome.runtime.lastError;
          clearTimeout(deadline);inFlight=undefined;port=undefined;retryAt=Date.now()+30000;
          void status({status:'unavailable',code:'context-native-host-unavailable'});
          if(latest)schedule(latest);
        });
      }catch{port=undefined;retryAt=Date.now()+30000;void status({status:'unavailable',code:'context-native-host-unavailable'});schedule(latest);return;}
    }
    if(!clientId){const saved=await chrome.storage.local.get('historyClientId');clientId=saved.historyClientId??crypto.randomUUID();if(!saved.historyClientId)await chrome.storage.local.set({historyClientId:clientId});}
    const pending=recordingEnabled?await pendingActions(latest.historyGeneration):[];
    const message={clientId,historyGeneration:latest.historyGeneration,v:1,kind:'observe',seq:++seq,sessionId:latest.sessionId,enabled:recordingEnabled,tabs:latest.tabs??[],events:pending.map(item=>item.event)};
    const observation=currentVisualEvidence();
    if(recordingEnabled && observation?.frames?.every(frame=>frame.sessionId===latest.sessionId)){
      message.observation=observation;
      if(new TextEncoder().encode(JSON.stringify(message)).length>950000)message.observation={...observation,frames:observation.frames.slice(-1)};
      if(new TextEncoder().encode(JSON.stringify(message)).length>950000)message.observation={...observation,frames:[]};
    }
    inFlight={seq:message.seq,lastSequence:pending.at(-1)?.sequence};
    deadline=setTimeout(()=>{void status({status:'error',code:'context-native-host-timeout'});port?.disconnect();},65000);
    try{port.postMessage(message);}catch{clearTimeout(deadline);inFlight=undefined;port?.disconnect();}
  }
  return {schedule};
}
