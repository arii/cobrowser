import { installRecorder } from './recorder.js';
import { ORIGIN, scope, command } from './agent-tab.js';
import './playback.js';
installRecorder();
let port, retry = 100;
const pending = new Map();
let clientPromise = chrome.storage.local.get('client').then(async ({client}) => {
  if (!client) { client = crypto.randomUUID(); await chrome.storage.local.set({client}); } return client;
});
async function connect() {
  if (port) return;
  port = chrome.runtime.connectNative('com.visual_harness.phase0');
  port.onMessage.addListener(m => {
    globalThis.lastAck = m;
    if (m?.kind !== 'ack' || m.v !== 1) return;
    const item = pending.get(m.seq);
    if (item && m.client === item.message.client) { clearTimeout(item.timer); pending.delete(m.seq); item.resolve(m); retry = 100; }
  });
  port.onDisconnect.addListener(() => {
    globalThis.lastNativeError = chrome.runtime.lastError?.message; port = undefined;
    if (pending.size) { setTimeout(connect, retry); retry = Math.min(retry * 2, 2000); }
  });
  for (const item of pending.values()) port.postMessage(item.message);
}
async function ping(seq = Date.now()) {
  const client = await clientPromise;
  if (pending.size >= 16 || pending.has(seq)) throw new Error('pending-limit-or-duplicate-in-flight');
  return new Promise((resolve, reject) => {
    const message = {v:1, kind:'ping', client, seq};
    const timer = setTimeout(() => { pending.delete(seq); reject(new Error('native-timeout')); }, 10000);
    pending.set(seq, { message, timer, resolve });
    if (port) port.postMessage(message); else connect();
  });
}
chrome.runtime.onStartup.addListener(() => connect());
chrome.alarms.create('relay-reconnect', {periodInMinutes: .5});
chrome.alarms.onAlarm.addListener(() => { if (pending.size) connect(); });
async function assign({adopt = false} = {}) {
  const previous = await chrome.storage.session.get('assigned');
  if (previous.assigned) throw new Error('stop-existing-assignment-first');
  let tab, origin;
  if (adopt) {
    [tab] = await chrome.tabs.query({active:true, currentWindow:true});
    if (!tab) throw new Error('no-active-tab');
    if (tab.incognito) throw new Error('adopt-requires-non-incognito-tab');
    let url = null;
    try { url = new URL(tab.url ?? ''); } catch {}
    if (!url || !['http:','https:'].includes(url.protocol)) throw new Error('adopt-requires-http-tab');
    origin = url.origin;
  } else {
    tab = await chrome.tabs.create({url:`${ORIGIN}/`, active:true});
    origin = ORIGIN;
  }
  const assigned = {tabId:tab.id, windowId:tab.windowId, origin};
  await chrome.storage.session.set({assigned});
  let reloaded = false;
  try {
    await chrome.debugger.attach({tabId:tab.id}, '1.3');
    await command('Page.enable');
    if (adopt) {
      let alive = false;
      for (let i = 0; i < 4 && !alive; i++) {
        alive = await chrome.tabs.sendMessage(tab.id, {kind:'recording:ping'}).then(() => true, () => false);
        if (!alive) await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!alive) {
        await chrome.tabs.reload(tab.id);
        await new Promise(resolve => {
          const done = () => { chrome.tabs.onUpdated.removeListener(listener); resolve(); };
          const listener = (id, change) => { if (id === tab.id && change.status === 'complete') done(); };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(done, 10000);
        });
        reloaded = true;
      }
    }
  } catch (error) {
    await stop();
    throw error;
  }
  return {tabId:tab.id, chromeWindowId:tab.windowId, origin:assigned.origin, adopted:adopt, reloaded};
}
async function screenshot() {
  const {tab} = await scope();
  const metrics = await command('Page.getLayoutMetrics');
  const frame = (await command('Page.getFrameTree')).frameTree.frame;
  const shot = await command('Page.captureScreenshot', {format:'png',captureBeyondViewport:false});
  const observation = {id:crypto.randomUUID(),tabId:tab.id,loaderId:frame.loaderId,frameId:frame.id,at:Date.now(),viewport:metrics.cssVisualViewport,zoom:await chrome.tabs.getZoom(tab.id)};
  await chrome.storage.session.set({observation});
  const window = await chrome.windows.get(tab.windowId);
  return {png:shot.data, observation, context:{chromeWindowId:tab.windowId,title:tab.title,active:tab.active,focused:window.focused,bounds:{left:window.left,top:window.top,width:window.width,height:window.height}}};
}
async function clickType({observationId,x,y,text}) {
  const {observation} = await chrome.storage.session.get('observation');
  const {tab} = await scope();
  const frame = (await command('Page.getFrameTree')).frameTree.frame;
  if (!observation || observation.id !== observationId || observation.tabId !== tab.id || Date.now()-observation.at>10000 || frame.loaderId !== observation.loaderId) throw new Error('stale-observation');
  const now = (await command('Page.getLayoutMetrics')).cssVisualViewport;
  if (JSON.stringify(now)!==JSON.stringify(observation.viewport) || (await chrome.tabs.getZoom(tab.id))!==observation.zoom) throw new Error('viewport-changed');
  if (!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=now.clientWidth||y>=now.clientHeight||typeof text!=='string'||text.length>100) throw new Error('invalid-input');
  await chrome.storage.session.set({lastDispatch:{tabId:tab.id, at:Date.now()}});
  await command('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
  await command('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
  await command('Input.insertText',{text});
  await chrome.storage.session.remove('observation');
  return {kind:'input-dispatched',tabId:tab.id};
}
async function stop() {
  const {assigned} = await chrome.storage.session.get('assigned');
  if (assigned) await chrome.debugger.detach({tabId:assigned.tabId}).catch(()=>{});
  await chrome.storage.session.remove(['assigned','observation']);
}
chrome.debugger.onDetach.addListener(() => { chrome.storage.session.remove(['assigned','observation']); });
chrome.tabs.onUpdated.addListener((id, change) => {
  if (!change.url) return;
  let origin = '';
  try { origin = new URL(change.url).origin; } catch {}
  chrome.storage.session.get('assigned').then(({assigned}) => {
    if (assigned?.tabId===id && origin !== (assigned.origin ?? ORIGIN)) return stop();
  });
});
chrome.tabs.onRemoved.addListener(id => chrome.storage.session.get('assigned').then(({assigned}) => { if (assigned?.tabId===id) return stop(); }));
globalThis.phase0 = {ping,assign,screenshot,clickType,stop};
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('popup.html')) return;
  const fn = {ping,assign,screenshot,stop,clickType}[m.kind];
  if (!fn) return;
  fn(m.args).then(value=>respond({ok:true,value}), e=>respond({ok:false,error:e.message})); return true;
});
