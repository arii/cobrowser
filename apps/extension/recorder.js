// Human interaction metadata for the assigned origin (fixture when unassigned).
// Independent of debugger/native probe execution.
const ORIGIN = 'http://127.0.0.1:3210';
function messageOrigin(value) {
  try { return new URL(value ?? '').origin; } catch { return ''; }
}
const KEY = 'fixtureRecording';
const TTL = 24 * 60 * 60 * 1000;
const LIMIT = 2000;
const empty = () => ({schemaVersion:1, sessionId:null, startedAt:null, events:[], dropped:0});
let queue = Promise.resolve();
function serial(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
async function read() {
  const state = (await chrome.storage.local.get(KEY))[KEY] ?? empty();
  const cutoff = Date.now() - TTL;
  state.events = state.events.filter(event => Date.parse(event.at) > cutoff);
  return state;
}
async function badge(enabled) {
  await chrome.action.setBadgeText({text:enabled?'REC':''});
  await chrome.action.setBadgeBackgroundColor({color:'#b42318'});
}
async function snapshot() {
  const state = await read();
  const {recordingEnabled = false, recordingError = null, assigned} = await chrome.storage.session.get(['recordingEnabled','recordingError','assigned']);
  return {...state, enabled:recordingEnabled, error:recordingError, limit:LIMIT, retentionHours:24, origin:assigned?.origin ?? ORIGIN};
}
async function save(state) {
  try { await chrome.storage.local.set({[KEY]:state}); }
  catch {
    await chrome.storage.session.set({recordingEnabled:false,recordingError:'Local storage failed. Recording stopped.'});
    await badge(false);
    throw new Error('recording-storage-failed');
  }
}
function validEvent(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['kind','tag'].includes(key))) return false;
  return ['click','change','submit','scroll','page-visible'].includes(value.kind)
    && ['INPUT','SELECT','TEXTAREA','BUTTON','A','FORM','PAGE','OTHER'].includes(value.tag);
}
export function installRecorder() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    const isView = sender.id === chrome.runtime.id && !sender.tab?.incognito
      && [chrome.runtime.getURL('recording.html'),chrome.runtime.getURL('popup.html')].includes(sender.url);
    const isContent = sender.id === chrome.runtime.id && sender.tab && !sender.tab.incognito && sender.frameId === 0;
    if (message?.kind === 'recording:event' && isContent) {
      serial(async () => {
        if (!validEvent(message.event)) throw new Error('invalid-recording-event');
        if (!(await chrome.storage.session.get('recordingEnabled')).recordingEnabled) return;
        const {assigned, lastDispatch} = await chrome.storage.session.get(['assigned','lastDispatch']);
        const expected = assigned?.origin ?? ORIGIN;
        if (messageOrigin(sender.url) !== expected || messageOrigin(sender.tab?.url) !== expected) return;
        if (lastDispatch?.tabId === sender.tab.id && Date.now() - lastDispatch.at < 750) return; // Own debugger input is not a human observation.
        const tab = await chrome.tabs.get(sender.tab.id);
        if (!tab.active || messageOrigin(tab.url) !== expected || !(await chrome.windows.get(tab.windowId)).focused) return;
        const state = await read();
        if (state.events.length >= LIMIT) {
          state.dropped++;
          await save(state);
          await chrome.storage.session.set({recordingEnabled:false,recordingError:'Recording limit reached. Export a copy, then clear saved events to continue.'});
          await badge(false);
          return;
        }
        state.events.push({id:crypto.randomUUID(),sessionId:state.sessionId,at:new Date().toISOString(),
          origin:expected,tabId:sender.tab.id,provenance:'human',...message.event});
        await save(state);
      }).then(() => respond({ok:true}), error => respond({ok:false,error:error.message}));
      return true;
    }
    if (!isView || !['recording:status','recording:start','recording:pause','recording:clear'].includes(message?.kind)) return;
    serial(async () => {
      if (message.kind === 'recording:start') {
        const state = await read();
        if (state.events.length >= LIMIT) throw new Error('Clear the full recording first; export a copy to keep it.');
        state.sessionId = crypto.randomUUID();
        state.startedAt = new Date().toISOString();
        await save(state);
        await chrome.storage.session.set({recordingEnabled:true,recordingError:null});
        await badge(true);
      } else if (message.kind === 'recording:pause') {
        await chrome.storage.session.set({recordingEnabled:false});
        await badge(false);
      } else if (message.kind === 'recording:clear') {
        await chrome.storage.session.set({recordingEnabled:false,recordingError:null});
        await save(empty());
        await badge(false);
      }
      return snapshot();
    }).then(value => respond({ok:true,value}), error => respond({ok:false,error:error.message}));
    return true;
  });
  chrome.alarms.create('recording-retention', {periodInMinutes:1});
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'recording-retention') void serial(async () => save(await read())).catch(() => {});
  });
  void serial(async () => { await save(await read()); await badge((await snapshot()).enabled); }).catch(() => {});
}
