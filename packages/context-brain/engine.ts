import { createHash, randomUUID } from 'node:crypto';
import { BrainEvent, ContextDecision, SnapSignals, type BrainProviders, type WorkingContext, type CallResult, type ContextFrame, TabContext, type IntervalEvidence } from './contracts.js';
import { checkImages } from '../model-adapters/index.js';

function safeFailure(error:unknown) {
  const code=error instanceof Error?error.message:'';
  return /^(context-[a-z-]+(?:-[0-9]{3})?|unknown-evidence-reference|decision-must-cite-fresh-evidence)$/.test(code)?code:'invalid-output-or-transport';
}
const RECENT_MS=90_000, IDLE_MS=120_000, RETENTION_MS=24*3600_000;
export type JournalEntry = {at:string;kind:string;[key:string]:unknown};
export type BrainView = {
  schemaVersion:1;contextModel:string;mode:'live'|'replay';working:WorkingContext|null;recent:BrainEvent[];tabs:TabContext[];assumptions:{id:string;at:string;decision:ContextDecision;observation?:IntervalEvidence}[];
  archived:{context:WorkingContext;reason:string;closedAt:string}[];journal:JournalEntry[];
  pendingSwitches:number;lastEventAt:string|null;
  providers:{snap:{calls:number;averageMs:number};context:{calls:number;averageMs:number}};
};
// Stores observable conclusions and evidence references, never hidden model reasoning.
export class ContextBrain {
  private state:BrainView;
  private seen=new Set<string>();
  private busy=false;
  private pendingIntent='';
  constructor(private readonly providers:BrainProviders,private readonly clock=()=>Date.now()) {
    this.state={schemaVersion:1,contextModel:providers.contextModel??'context',mode:providers.mode,working:null,recent:[],tabs:[],assumptions:[],archived:[],journal:[],pendingSwitches:0,lastEventAt:null,providers:{snap:{calls:0,averageMs:0},context:{calls:0,averageMs:0}}};
  }
  private log(kind:string,data:Record<string,unknown>={}) {
    this.state.journal.push({at:new Date(this.clock()).toISOString(),kind,...data});
    this.state.journal=this.state.journal.slice(-200);
  }
  private reset(reason:string) {
    if (this.state.working && this.clock()-Date.parse(this.state.working.updatedAt)<RETENTION_MS) this.state.archived.push({context:this.state.working,reason,closedAt:new Date(this.clock()).toISOString()});
    this.state.archived=this.state.archived.slice(-20);
    this.state.working=null;this.state.recent=[];this.state.pendingSwitches=0;this.pendingIntent='';
    this.log('context-retired',{reason});
  }
  private expire() {
    const now=this.clock();
    this.state.assumptions=this.state.assumptions.filter(item=>now-Date.parse(item.at)<RETENTION_MS);
    this.state.tabs=this.state.tabs.filter(tab=>now-Date.parse(tab.observedAt)<30000);
    this.state.recent=this.state.recent.filter(event=>now-Date.parse(event.at)<RECENT_MS);
    this.state.archived=this.state.archived.filter(item=>now-Date.parse(item.closedAt)<RETENTION_MS);
    this.state.journal=this.state.journal.filter(item=>now-Date.parse(item.at)<RETENTION_MS);
    if (this.state.lastEventAt && now-Date.parse(this.state.lastEventAt)>IDLE_MS && (this.state.working || this.state.recent.length)) this.reset('idle-context-expired');
  }
  view():BrainView {this.expire();return structuredClone(this.state);}
  setTabs(raw:unknown[]) {
    if(this.busy)throw new Error('context-busy');
    if(raw.length>200)throw new Error('context-tab-limit');
    this.state.tabs=raw.map(tab=>TabContext.parse(tab)).filter(tab=>this.clock()-Date.parse(tab.observedAt)<30000 && Date.parse(tab.observedAt)<=this.clock()+5000);
  }
  clear() {
    if (this.busy) throw new Error('context-busy');
    const fresh=new ContextBrain(this.providers,this.clock);this.state=fresh.state;this.seen.clear();this.pendingIntent='';
  }
  private measured<T>(provider:'snap'|'context',call:CallResult<T>,evidenceIds:string[]) {
    if (call.mode!==this.providers.mode) throw new Error('context-provider-mode-mismatch');
    const metric=this.state.providers[provider];metric.averageMs=(metric.averageMs*metric.calls+call.latencyMs)/(metric.calls+1);metric.calls++;
    this.log('provider-result',{provider,model:call.model,mode:call.mode,latencyMs:call.latencyMs,inputHash:call.inputHash,version:call.version,usage:call.usage,evidenceIds});
  }
  async observe(raw:unknown[],frames:ContextFrame[]=[],observation?:IntervalEvidence):Promise<BrainView> {
    if (this.busy) throw new Error('context-busy');
    if (raw.length>64 || frames.length>2) throw new Error('context-batch-limit');
    const now=this.clock();
    // Validate the entire batch before touching working memory or calling providers.
    const parsed=raw.map(value=>BrainEvent.parse(value));
    if (parsed.some(event=>Date.parse(event.at)>now+5000 || now-Date.parse(event.at)>=RETENTION_MS)) throw new Error('context-event-outside-retention');
    const batchIds=new Set<string>();
    const fresh=parsed.filter(event=>{if(this.seen.has(event.id)||batchIds.has(event.id))return false;batchIds.add(event.id);return true;});
    if (!fresh.length) return this.view();
    if (fresh.some((event,index)=>index>0 && Date.parse(event.at)<Date.parse(fresh[index-1].at))) throw new Error('context-events-out-of-order');
    const scopeOf=(event:BrainEvent)=>`${event.sessionId}|${new URL(event.origin).origin}|${event.tabId}`;
    if (fresh.some(event=>scopeOf(event)!==scopeOf(fresh[0]))) throw new Error('context-mixed-scope-batch');
    if (frames.some(frame=>!Number.isFinite(Date.parse(frame.at)) || now-Date.parse(frame.at)>RECENT_MS || Date.parse(frame.at)>now+5000 || `${frame.sessionId}|${new URL(frame.origin).origin}|${frame.tabId}`!==scopeOf(fresh[0]))) throw new Error('context-frame-scope-or-time-mismatch');
    checkImages(frames.map(frame=>frame.image));
    if (this.state.lastEventAt && (Date.parse(fresh[0].at)<Date.parse(this.state.lastEventAt)-5000 || (this.state.working?.scope!==fresh[0].sessionId && Date.parse(fresh[0].at)<Date.parse(this.state.lastEventAt)))) throw new Error('context-stale-event');
    this.busy=true;
    try {
      this.expire();
      const scope=fresh[0].sessionId;
      if ((this.state.working && this.state.working.scope!==scope) || this.state.recent.some(event=>event.sessionId!==scope)) this.reset('observation-session-changed');
      if (this.state.lastEventAt && Date.parse(fresh[0].at)-Date.parse(this.state.lastEventAt)>IDLE_MS && this.state.working) this.reset('idle-context-expired');
      if (this.state.working?.status==='completed' && fresh.some(event=>!['pointer','scroll','page-visible'].includes(event.kind))) this.reset('completed-task-retired');
      for (const event of fresh) this.seen.add(event.id);
      // Dedupe is bounded independently of working memory.
      if (this.seen.size>4000) this.seen=new Set([...this.seen].slice(-2000));
      this.state.lastEventAt=new Date(Math.max(Date.parse(this.state.lastEventAt??fresh[0].at),Date.parse(fresh.at(-1)!.at))).toISOString();
      this.state.recent=[...this.state.recent,...fresh].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).filter(event=>now-Date.parse(event.at)<RECENT_MS).slice(-12);
      this.log('evidence-received',{eventIds:fresh.map(event=>event.id),frames:frames.map(frame=>({at:frame.at,hash:createHash('sha256').update(frame.image.base64).digest('hex')}))});
      if (!this.state.recent.length) {this.log('fast-path',{reason:'evidence-outside-working-window'});return this.view();}
      if (!observation && fresh.every(event=>['pointer','scroll'].includes(event.kind))) {
        this.log('fast-path',{reason:'passive-metadata-only; no inference call'});return this.view();
      }
      const events=this.state.recent;
      let signals:null|ReturnType<typeof SnapSignals.parse>=null;
      const metrics=this.state.providers;
      const useSnap=frames.length>0 || metrics.snap.calls<3 || metrics.snap.averageMs<=metrics.context.averageMs || Boolean(this.pendingIntent);
      this.log('routing',{snap:useSnap,reason:frames.length?'image-analysis':this.pendingIntent?'confirm-task-candidate':useSnap?'action-analysis-cold-or-measured-faster':'action-analysis-Snap-measured-slower',contextOwner:this.state.contextModel});
      try {
        if (!useSnap) throw new Error('snap-action-routing-skipped');
        const result=await this.providers.snap({previous:this.state.working,events,images:frames.map(frame=>frame.image),frameTimes:frames.map(frame=>frame.at)});
        this.measured('snap',result,events.map(event=>event.id));signals=SnapSignals.parse(result.value);
        this.log('snap-signals',{...signals});
      } catch (error) {
        if (useSnap) this.log('provider-unavailable',{provider:'snap',code:safeFailure(error),reason:'No decision available; The context model receives missing signals explicitly.'});
      }
      let decision:ContextDecision;
      try {
        const result=await this.providers.context({previous:this.state.working,events,signals,tabs:this.state.tabs,observation,freshEventIds:fresh.map(event=>event.id),candidate:this.pendingIntent?{intent:this.pendingIntent,confirmations:this.state.pendingSwitches}:null});
        this.measured('context',result,events.map(event=>event.id));decision=ContextDecision.parse(result.value);
        if (decision.nextAction.evidenceIds.some(id=>!events.some(event=>event.id===id))) throw new Error('unknown-evidence-reference');
        if (!decision.nextAction.evidenceIds.some(id=>fresh.some(event=>event.id===id))) throw new Error('decision-must-cite-fresh-evidence');
        if (decision.nextAction.targetTabId!==null && !this.state.tabs.some(tab=>tab.tabId===decision.nextAction.targetTabId) && !events.some(event=>event.tabId===decision.nextAction.targetTabId)) throw new Error('context-prediction-unknown-tab');
        if (decision.evidenceIds.some(id=>!events.some(event=>event.id===id))) throw new Error('unknown-evidence-reference');
        if (!decision.evidenceIds.some(id=>fresh.some(event=>event.id===id))) throw new Error('decision-must-cite-fresh-evidence');
      } catch (error) {
        this.state.pendingSwitches=0;this.pendingIntent='';
        if (this.state.working) {this.state.working.confidence=0;this.state.working.status='uncertain';this.state.working.nextAction={kind:'unknown',description:'Prediction unavailable until the context model responds.',targetTabId:null,confidence:0,evidenceIds:[fresh.at(-1)!.id]};}
        this.log('provider-unavailable',{provider:'context',code:safeFailure(error),reason:'Context update unavailable or invalid; no inferred replacement.'});
        return this.view();
      }
      this.log('intent-assessment',{...decision,observationId:observation?.id});
      this.state.assumptions.push({id:randomUUID(),at:new Date(this.clock()).toISOString(),decision,observation});
      this.state.assumptions=this.state.assumptions.slice(-30);
      const current=this.state.working;
      if(current)current.nextAction=decision.nextAction;
      if (!current) {
        this.state.working={taskId:randomUUID(),scope,openedAt:fresh[0].at,updatedAt:fresh.at(-1)!.at,...this.contextFields(decision)};
        this.log('context-opened',{taskId:this.state.working.taskId});
      } else if (decision.status==='new_task') {
        // Two corroborated updates prevent a single click/screen transition from erasing a task.
        const corroborated=decision.confidence>=.8 && signals?.taskRelation==='different' && signals.relationConfidence>=.8;
        if (corroborated) {
          const matches=this.pendingIntent.trim().toLowerCase()===decision.intent.trim().toLowerCase();
          this.state.pendingSwitches=matches?this.state.pendingSwitches+1:1;this.pendingIntent=decision.intent;
        } else {this.state.pendingSwitches=0;this.pendingIntent=decision.intent;}
        if (this.state.pendingSwitches>=2) {
          this.reset('confirmed-task-change');
          // Old raw events are absent from the next recursive context update.
          this.state.recent=fresh.slice(-12);
          this.state.working={taskId:randomUUID(),scope,openedAt:fresh[0].at,updatedAt:fresh.at(-1)!.at,...this.contextFields(decision)};
          this.log('context-opened',{taskId:this.state.working.taskId});
        } else {
          current.status='uncertain';
          this.log('task-change-pending',{candidate:this.pendingIntent||decision.intent,confirmations:this.state.pendingSwitches});
        }
      } else {
        this.state.pendingSwitches=0;this.pendingIntent='';
        if (decision.status==='uncertain' || decision.confidence<.6) {
          current.status='uncertain';current.confidence=Math.min(current.confidence,decision.confidence);
        } else {
          Object.assign(current,this.contextFields(decision),{updatedAt:fresh.at(-1)!.at});
        }
      }
      return this.view();
    } finally {this.busy=false;}
  }
  private contextFields(decision:ContextDecision) {
    return {intent:decision.intent,summary:decision.summary,confidence:decision.confidence,status:decision.status,nextAction:decision.nextAction};
  }
}
