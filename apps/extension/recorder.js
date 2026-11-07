import { retainAction, readAllActions, clearActions } from './action-history.js';
import { validTarget } from './skill-learning.js';
import { captureVisualContext, clearVisualEvidence } from './visual-context.js';
import { nativeBrainLink } from './native-brain.js';
import { cancelReplayForReset, getAgentTab, getReplaySnapshot } from './playback.js';
const brainLink=nativeBrainLink();
// Opt-in observation across HTTP(S) tabs, independent of execution assignment.
// Independent of debugger/native probe execution.
const webOrigin = value => {try {const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.origin:null;} catch {return null;}};
let lastTabRefresh=0;
function messageOrigin(value) {
  try { return new URL(value ?? '').origin; } catch { return ''; }
}
const KEY = 'fixtureRecording';
const TTL = 24 * 60 * 60 * 1000;
const LIMIT = 2000;
const empty = () => ({schemaVersion:1, historyGeneration:crypto.randomUUID(),sessionId:null, startedAt:null, events:[], tabs:[], tabCount:0, dropped:0});
let queue = Promise.resolve();
function serial(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
async function read() {
  const saved = await chrome.storage.local.get([KEY,'contextBrain']);
  const state = saved[KEY] ?? empty();
  if(!state.historyGeneration)state.historyGeneration=crypto.randomUUID();
  if (saved.contextBrain && Date.now()-Date.parse(saved.contextBrain.connectedAt)>TTL) await chrome.storage.local.remove('contextBrain');
  const cutoff = Date.now() - TTL;
  state.tabs=(state.tabs??[]).filter(tab=>Date.parse(tab.observedAt)>cutoff);
  state.events = state.events.filter(event => Date.parse(event.at) > cutoff);
  return state;
}
async function badge(enabled) {
  await chrome.action.setBadgeText({text:enabled?'REC':''});
  await chrome.action.setBadgeBackgroundColor({color:'#b42318'});
}
async function tabMessage(tabId) {
  let timeout;
  try{return await Promise.race([chrome.tabs.sendMessage(tabId,{kind:'recording:context-request'},{frameId:0}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('page-read-timeout')),1500);})]);}
  finally{clearTimeout(timeout);}
}
async function refreshTabs(state, force=false) {
  if (!force && Date.now()-lastTabRefresh<5000) return;
  lastTabRefresh=Date.now();
  const tabs=(await chrome.tabs.query({})).filter(tab=>!tab.incognito && webOrigin(tab.url));
  state.tabCount=tabs.length;
  state.tabs=await Promise.all(tabs.sort((a,b)=>Number(b.active)-Number(a.active)||(b.lastAccessed??0)-(a.lastAccessed??0)).slice(0,200).map(async tab=>{
    const base={tabId:tab.id,origin:webOrigin(tab.url),title:(tab.title??'').slice(0,160),headings:[],excerpt:'',active:tab.active,observedAt:new Date().toISOString(),readStatus:'unavailable'};
    try {
      let context;
      try {context=await tabMessage(tab.id);if(context?.recorderVersion!==3)throw new Error('old-content-script');}
      catch {
        const files=chrome.runtime.getManifest().content_scripts?.flatMap(script=>script.js??[])??[];
        if (!files.length) return base;
        await chrome.scripting.executeScript({target:{tabId:tab.id},files});
        context=await tabMessage(tab.id);
      }
      const current=await chrome.tabs.get(tab.id);
      if (current.url!==tab.url || current.incognito) return base;
      if(!context || typeof context.title!=='string' || !Array.isArray(context.headings) || typeof context.excerpt!=='string')return {...base,readError:'page-did-not-respond'};
      return {...base,title:typeof context?.title==='string'?context.title.slice(0,160):base.title,
        headings:Array.isArray(context?.headings)?context.headings.filter(value=>typeof value==='string').slice(0,3).map(value=>value.slice(0,120)):[],
        excerpt:typeof context?.excerpt==='string'?context.excerpt.slice(0,1200):'',readStatus:context.excerpt.trim()||context.headings.length?'ready':'empty'};
    } catch {return {...base,readError:'page-access-unavailable-reload-site'};}
  }));
}
async function snapshot() {
  const state = await read();
  const {recordingEnabled = false, recordingError = null} = await chrome.storage.session.get(['recordingEnabled','recordingError']);
  if (recordingEnabled) {await refreshTabs(state);await captureVisualContext(state);await save(state);}
  const {contextBrain:storedBrain=null,brainConnection=null,brainActivity=null} = await chrome.storage.local.get(['contextBrain','brainConnection','brainActivity']);
  const contextBrain=storedBrain?.providers?.context?storedBrain:null;
  const brain=contextBrain && Date.now()-Date.parse(contextBrain.connectedAt)>120000?{...contextBrain,working:null,recent:[],pendingSwitches:0}:contextBrain;
  return {...state, brain, brainConnection, brainActivity, enabled:recordingEnabled, error:recordingError, limit:LIMIT, retentionHours:24, origin:'all open HTTP/HTTPS tabs', replay:await getReplaySnapshot(), agentTab:await getAgentTab()};
}
async function archiveAction(event,generation){
  try{await retainAction(event,generation);}catch{
    await chrome.storage.session.set({recordingEnabled:false,recordingError:'Local task history could not be saved. Recording stopped.'});
    await badge(false);throw new Error('recording-history-storage-failed');
  }
}
async function save(state) {
  try { await chrome.storage.local.set({[KEY]:state});brainLink.schedule(state); }
  catch {
    await chrome.storage.session.set({recordingEnabled:false,recordingError:'Local storage failed. Recording stopped.'});
    await badge(false);
    throw new Error('recording-storage-failed');
  }
}
function validEvent(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['kind','tag','x','y','key','target','formTargets'].includes(key))) return false;
  return (value.formTargets===undefined || (value.kind==='click' && Array.isArray(value.formTargets) && value.formTargets.length<=12 && value.formTargets.every(target=>validTarget(target) && ['INPUT','SELECT','TEXTAREA'].includes(target.tag))))
    && (value.target===undefined || (['click','change'].includes(value.kind) && validTarget(value.target)))
    && ['click','change','submit','scroll','page-visible','pointer','key'].includes(value.kind)
    && ['INPUT','SELECT','TEXTAREA','BUTTON','A','FORM','PAGE','OTHER'].includes(value.tag)
    && ((value.x === undefined && value.y === undefined) || (['pointer','click'].includes(value.kind) && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x>=0 && value.x<=1 && value.y>=0 && value.y<=1))
    && (value.key === undefined || (value.kind === 'key' && ['Tab','Enter','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(value.key)));
}
export function installRecorder() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    const isView = sender.id === chrome.runtime.id && !sender.tab?.incognito
      && [chrome.runtime.getURL('recording.html'),chrome.runtime.getURL('popup.html'),chrome.runtime.getURL('skills.html')].includes(sender.url);
    const isContent = sender.id === chrome.runtime.id && sender.tab && !sender.tab.incognito && sender.frameId === 0;
    if(message?.kind==='recording:effect' && isContent){
      serial(async()=>{
        if(!(await chrome.storage.session.get('recordingEnabled')).recordingEnabled)return;
        const state=await read();
        const event=state.events.find(item=>item.id===message.id && item.tabId===sender.tab.id && item.sessionId===state.sessionId && item.origin===webOrigin(sender.url));
        if(event?.kind==='click' && Date.now()-Date.parse(event.at)<5000){if(event.effect!=='content-changed')event.effect=message.effect==='form-submitted'?'form-submitted':'content-changed';await archiveAction(event,state.historyGeneration);await save(state);}
      }).then(()=>respond({ok:true}),error=>respond({ok:false,error:error.message}));return true;
    }
    if (message?.kind === 'recording:event' && isContent) {
      serial(async () => {
        if (!validEvent(message.event)) throw new Error('invalid-recording-event');
        if (!(await chrome.storage.session.get('recordingEnabled')).recordingEnabled) return;
        const {lastDispatch,skillRun} = await chrome.storage.session.get(['lastDispatch','skillRun']);
        if(skillRun?.status==='running' && skillRun.tabId===sender.tab.id)return;
        const expected = webOrigin(sender.url);
        if (!expected) return;
        if (messageOrigin(sender.url) !== expected || messageOrigin(sender.tab?.url) !== expected) return;
        if (lastDispatch?.tabId === sender.tab.id && Date.now() - lastDispatch.at < 750) return; // Own debugger input is not a human observation.
        const tab = await chrome.tabs.get(sender.tab.id);
        if (!tab.active || messageOrigin(tab.url) !== expected || !(await chrome.windows.get(tab.windowId)).focused) return;
        const state = await read();
        if (state.events.length >= LIMIT) {
          const removed=state.events.splice(0,state.events.length-LIMIT+1);
          state.dropped+=removed.length;
        }
        const id=crypto.randomUUID();
        state.events.push({id,sessionId:state.sessionId,at:new Date().toISOString(),
          origin:expected,tabId:sender.tab.id,provenance:'human',...message.event});
        await archiveAction(state.events.at(-1),state.historyGeneration);
        await save(state);
        return {id};
      }).then(value => respond({ok:true,value}), error => respond({ok:false,error:error.message}));
      return true;
    }
    if (!isView || !['recording:status','recording:start','recording:pause','recording:clear','recording:export'].includes(message?.kind)) return;
    serial(async () => {
      if(message.kind==='recording:export')return {...await snapshot(),events:await readAllActions(),historyScope:'Full locally retained action history; no 24-hour truncation.'};
      if (message.kind === 'recording:start') {
        const state = await read();
        await refreshTabs(state,true);
        state.sessionId = crypto.randomUUID();
        state.startedAt = new Date().toISOString();
        await cancelReplayForReset('recording-session-changed');
        await save(state);
        await chrome.storage.session.set({recordingEnabled:true,recordingError:null});
        await badge(true);
      } else if (message.kind === 'recording:pause') {
        clearVisualEvidence();
        await chrome.storage.session.set({recordingEnabled:false});
        await badge(false);
      } else if (message.kind === 'recording:clear') {
        clearVisualEvidence();
        await chrome.storage.session.set({recordingEnabled:false,recordingError:null});
        await cancelReplayForReset('recording-cleared');
        await clearActions();
        await save(empty());
        await chrome.storage.local.remove('contextBrain');
        await badge(false);
      }
      return snapshot();
    }).then(value => respond({ok:true,value}), error => respond({ok:false,error:error.message}));
    return true;
  });
  // A native port keeps the worker alive; this drives intervals even with the monitor closed.
  setInterval(()=>{void serial(async()=>{if(!(await chrome.storage.session.get('recordingEnabled')).recordingEnabled)return;const state=await read();await refreshTabs(state);await captureVisualContext(state);await save(state);}).catch(()=>{});},10000);
  chrome.alarms.create('recording-retention', {periodInMinutes:.5});
  const tabsChanged=()=>{lastTabRefresh=0;void serial(async()=>{if(!(await chrome.storage.session.get('recordingEnabled')).recordingEnabled)return;const state=await read();await refreshTabs(state);await save(state);}).catch(()=>{});};
  chrome.tabs.onActivated.addListener(tabsChanged);
  chrome.tabs.onRemoved.addListener(tabsChanged);
  chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.status==='complete')tabsChanged();});
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'recording-retention') void serial(async () => {const state=await read();if ((await chrome.storage.session.get('recordingEnabled')).recordingEnabled) {await refreshTabs(state);await captureVisualContext(state);}await save(state);}).catch(() => {});
  });
  void serial(async () => {const state=await read();for(const event of state.events)await archiveAction(event,state.historyGeneration);await save(state); await badge((await snapshot()).enabled); }).catch(() => {});
}
