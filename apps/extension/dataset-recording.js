// Dataset mode: a recorder state converted from a public dataset (see dailySkills/ in the repo) stands in for
// live capture while testing. This module only checks and normalizes the file; recorder.js owns storage.
import { validEvent } from './recording-events.js';
const STORED=['id','sessionId','at','origin','tabId','provenance','kind','tag','x','y','key','target','formTargets','effect'];
const CONTENT=['kind','tag','x','y','key','target','formTargets'];
const TTL=24*60*60*1000;
const webOrigin=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol) && url.origin===value;}catch{return false;}};
const fail=code=>{throw new Error(code);};
/** Per-tab task summary from the converter's `source` key, for display only. */
export function datasetTasks(source){
  const list=Array.isArray(source?.merged)?source.merged:source && typeof source==='object'?[source]:[];
  return list.slice(0,200).map((task,index)=>({tabId:index+1,dataset:String(task?.dataset??'').slice(0,80),site:String(task?.site??'').slice(0,80),task:String(task?.task??'').replace(/\s+/g,' ').slice(0,300)}));
}
/** Returns {state, tasks, expired, dropped}; throws Error(code) for anything the recorder would not have stored. */
export function normalizeDatasetRecording(input,{limit=2000,now=Date.now(),generation}={}){
  if(!input || typeof input!=='object' || Array.isArray(input))fail('dataset-not-an-object');
  if(input.schemaVersion!==1)fail('dataset-unsupported-schema');
  if(typeof input.sessionId!=='string' || !input.sessionId)fail('dataset-missing-session');
  if(!Array.isArray(input.events) || !input.events.length)fail('dataset-no-events');
  if(input.events.length>50000)fail('dataset-too-many-events');
  const cutoff=now-TTL;let previous=-Infinity,expired=0;
  const events=input.events.map((event,index)=>{
    if(!event || typeof event!=='object')fail(`dataset-event-${index}-invalid`);
    for(const key of Object.keys(event))if(!STORED.includes(key))fail(`dataset-event-${index}-unknown-field-${key}`);
    const content={};for(const key of CONTENT)if(event[key]!==undefined)content[key]=event[key];
    if(!validEvent(content))fail(`dataset-event-${index}-rejected-by-recorder`);
    if(typeof event.id!=='string' || !event.id || event.id.length>80)fail(`dataset-event-${index}-missing-id`);
    if(event.sessionId!==input.sessionId)fail(`dataset-event-${index}-session-mismatch`);
    if(event.provenance!=='human')fail(`dataset-event-${index}-not-human`);
    if(!Number.isInteger(event.tabId) || event.tabId<0)fail(`dataset-event-${index}-bad-tab`);
    if(!webOrigin(event.origin))fail(`dataset-event-${index}-bad-origin`);
    if(event.effect!==undefined && !['content-changed','form-submitted'].includes(event.effect))fail(`dataset-event-${index}-bad-effect`);
    if(event.effect!==undefined && event.kind!=='click')fail(`dataset-event-${index}-effect-on-non-click`);
    const at=Date.parse(event.at);
    if(Number.isNaN(at))fail(`dataset-event-${index}-bad-time`);
    if(at<previous)fail(`dataset-event-${index}-out-of-order`);
    previous=at;if(at<=cutoff)expired++;
    return {...event,at:new Date(at).toISOString()};
  });
  if(new Set(events.map(event=>event.id)).size!==events.length)fail('dataset-duplicate-event-ids');
  const fresh=events.filter(event=>Date.parse(event.at)>cutoff);
  if(!fresh.length)fail('dataset-all-events-expired');
  const dropped=Math.max(0,fresh.length-limit);
  const kept=fresh.slice(-limit);
  const tabs=(Array.isArray(input.tabs)?input.tabs:[]).filter(tab=>tab && typeof tab==='object' && Number.isInteger(tab.tabId) && tab.tabId>=0 && webOrigin(tab.origin)).slice(0,200)
    .map(tab=>({tabId:tab.tabId,origin:tab.origin,title:String(tab.title??'').slice(0,160),headings:[],excerpt:'',active:tab.active===true,
      observedAt:Number.isNaN(Date.parse(tab.observedAt))?new Date(now).toISOString():new Date(Date.parse(tab.observedAt)).toISOString(),readStatus:'unavailable'}));
  const startedAt=Number.isNaN(Date.parse(input.startedAt))?kept[0].at:new Date(Date.parse(input.startedAt)).toISOString();
  const state={schemaVersion:1,historyGeneration:generation??crypto.randomUUID(),sessionId:input.sessionId,startedAt,events:kept,tabs,tabCount:tabs.length,dropped};
  return {state,tasks:datasetTasks(input.source),expired,dropped};
}
