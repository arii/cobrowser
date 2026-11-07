import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrainEvent, type WorkingContext, type IntervalEvidence } from './contracts.js';
export type TaskHistory={id:string;scope:string;openedAt:string;closedAt?:string;reason?:string;context:WorkingContext|null;events:BrainEvent[];observations:IntervalEvidence[]};
type RecordEntry={kind:'open';task:TaskHistory}|{kind:'events';events:BrainEvent[]}|{kind:'context';context:WorkingContext}|{kind:'observation';observation:IntervalEvidence}|{kind:'switch';startId:string;id:string;at:string;scope:string};
const words=(value:string)=>new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g)??[]);
export class TaskHistoryStore {
  active:TaskHistory|null=null;
  archived:TaskHistory[]=[];
  private ids=new Set<string>();
  private logPath?:string;
  constructor(private readonly root?:string){
    if(!root)return;
    mkdirSync(root,{recursive:true,mode:0o700});
    const info=lstatSync(root);if(!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid?.() || (info.mode&0o077))throw new Error('context-history-directory-not-private');
    this.logPath=join(root,'tasks.jsonl');
    if(existsSync(this.logPath)){
      const file=lstatSync(this.logPath);if(!file.isFile() || file.isSymbolicLink() || (file.mode&0o077))throw new Error('context-history-file-not-private');
      const lines=readFileSync(this.logPath,'utf8').split('\n');
      for(let index=0;index<lines.length;index++){
        if(!lines[index])continue;
        let record:RecordEntry;
        try{record=JSON.parse(lines[index]);}catch{throw new Error('context-history-corrupt');}
        this.apply(record);
      }
    }
  }
  private record(entry:RecordEntry){
    if(this.logPath)appendFileSync(this.logPath,JSON.stringify(entry)+'\n',{mode:0o600});
    this.apply(structuredClone(entry));
  }
  private apply(entry:RecordEntry){
    if(entry.kind==='open')this.active=entry.task;
    else if(entry.kind==='events'){
      if(!this.active)throw new Error('context-history-no-active-task');
      for(const raw of entry.events){const event=BrainEvent.parse(raw);if(!this.ids.has(event.id)){this.active.events.push(event);this.ids.add(event.id);}}
    }else if(entry.kind==='context'){
      if(this.active)this.active.context=entry.context;
    }else if(entry.kind==='observation'){
      if(this.active && !this.active.observations.some(item=>item.id===entry.observation.id))this.active.observations.push(entry.observation);
    }else if(entry.kind==='switch'){
      const old=this.active;if(!old)throw new Error('context-history-no-active-task');
      const boundary=old.events.findIndex(event=>event.id===entry.startId);if(boundary<0)throw new Error('context-history-boundary-missing');
      const moved=old.events.splice(boundary);
      const after=old.observations.filter(item=>Date.parse(item.at)>=Date.parse(moved[0].at));
      old.observations=old.observations.filter(item=>!after.includes(item));
      old.closedAt=moved[0].at;old.reason='confirmed-task-change';this.archived.push(old);
      this.active={id:entry.id,scope:entry.scope,openedAt:moved[0].at,events:moved,observations:after,context:null};
    }
  }
  has(id:string){return this.ids.has(id);}
  begin(scope:string,at:string){if(!this.active)this.record({kind:'open',task:{id:randomUUID(),scope,openedAt:at,events:[],observations:[],context:null}});return this.active!;}
  append(events:BrainEvent[],observation?:IntervalEvidence){
    const fresh=events.filter(event=>!this.has(event.id));if(fresh.length)this.record({kind:'events',events:fresh});
    if(observation)this.record({kind:'observation',observation});
  }
  revise(context:WorkingContext){this.record({kind:'context',context});}
  switchTask(startId:string,scope:string,at:string){this.record({kind:'switch',startId,id:randomUUID(),scope,at});return this.active!;}
  retrieve(query:string,excluded:Set<string>,limit=6){
    const terms=words(query);if(!terms.size || !this.active)return [];
    return this.active.events.filter(event=>!excluded.has(event.id) && !['pointer','scroll'].includes(event.kind)).map((event,index)=>{
      const tokens=words([event.target?.label,...(event.formTargets??[]).map(field=>field.label),event.origin,event.kind,event.tag].join(' '));
      return {event,index,score:[...terms].filter(term=>tokens.has(term)).length};
    }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score || b.index-a.index).slice(0,limit).map(item=>item.event);
  }
  clear(){
    if(this.logPath){const temporary=this.logPath+'.tmp';writeFileSync(temporary,'',{mode:0o600});renameSync(temporary,this.logPath);}
    this.active=null;this.archived=[];this.ids.clear();
  }
}
