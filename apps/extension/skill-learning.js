import { workflowSites } from './skill-workflow.js';
// Save supported workflows after one attempt; model judgments enrich local evidence.
export const QUALITY_VERSION=3;
export const riskyAction=/\b(send|pay|purchase|buy|checkout|delete|remove|destroy|publish|transfer|unsubscribe|confirm order|sign out|log out)\b/i;
// Exact legacy fixture label; avoid classifying arbitrary business fields as probes.
export const probeTarget=target=>/^CDP typing probe$/i.test(target?.label?.trim()??'');
export function validTarget(target){
  return target && Object.keys(target).every(key=>['tag','label','type'].includes(key))
    && ['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(target.tag)
    && typeof target.label==='string' && target.label.trim().length>0 && target.label.length<=100
    && !/^(unknown|untitled|other|button|click|action|\.{3})$/i.test(target.label.trim())
    && typeof target.type==='string' && /^[a-z-]{0,30}$/.test(target.type)
    && !['password','hidden','file','checkbox','radio'].includes(target.type);
}
export const outcomeAction=step=>step?.kind==='click' && validTarget(step.target)
  && ['BUTTON','A'].includes(step.target.tag)
  && /^(export|download|preview|search|filter|apply filters?|show results?|generate|calculate|run report)\b/i.test(step.target.label.trim())
  && !riskyAction.test(step.target.label);
export const OUTCOME_KINDS=['page-changed','navigation','form-submitted','download'];
// A mined skill may declare its observable end state instead of ending on a result-verb click.
export const validOutcome=outcome=>!!outcome && typeof outcome==='object' && OUTCOME_KINDS.includes(outcome.kind)
  && typeof outcome.description==='string' && outcome.description.trim().length>0 && outcome.description.length<=300;
export function defaultSkillName(steps){
  const label=steps?.at(-1)?.target?.label?.replace(/\s+/g,' ').trim();
  if(!label)return 'Workflow needs new examples';
  const templates={export:'Export report',download:'Download report',preview:'Preview report',search:'Search records',filter:'Filter results',generate:'Generate report',calculate:'Calculate results'};
  return (templates[label.toLowerCase()]??label).slice(0,80);
}
export function skillIssues(skill){
  const issues=[];
  if(skill.sites){try{const sites=workflowSites(skill);if(skill.steps?.some(step=>!sites.some(site=>site.id===(step.siteId??'main'))))issues.push('A workflow step has no configured website.');}catch{issues.push('The website configuration is invalid.');}}
  if(!Array.isArray(skill.steps) || !skill.steps.length || skill.steps.length>48)return ['This workflow has no complete, supported action sequence.'];
  for(const [index,step] of skill.steps.entries()){
    if(probeTarget(step?.target))issues.push(`Step ${index+1} is a developer probe. Remove it and review the repaired skill.`);
    if(!validTarget(step?.target) || !['click','change'].includes(step.kind))issues.push(`Step ${index+1} has no supported, named action.`);
    if(step?.target && riskyAction.test(step.target.label))issues.push(`Step ${index+1} may have an irreversible effect.`);
    if(step?.kind==='change' && (!['INPUT','SELECT','TEXTAREA'].includes(step.target?.tag) || !/^input_\d+$/.test(step.parameter??'')))issues.push(`Step ${index+1} has no usable input parameter.`);
    if(step?.kind==='click' && !['BUTTON','A'].includes(step.target?.tag))issues.push(`Step ${index+1} only focuses a field.`);
    if(step?.target?.type==='submit' && !/\b(export|download|search|filter)\b/i.test(step.target.label))issues.push(`Step ${index+1} has an unsupported form submission.`);
  }
  if(!outcomeAction(skill.steps.at(-1)) && !validOutcome(skill.outcome))issues.push('This workflow does not end with a supported result action.');
  if(![2,QUALITY_VERSION].includes(skill.qualityVersion) || !Array.isArray(skill.examples) || !skill.examples.some(example=>['content-changed','form-submitted'].includes(example.effect)))issues.push('Complete one workflow with an observed result or form submission to learn this skill.');
  return [...new Set(issues)];
}
const targetKey=target=>target?[target.tag,target.label,target.type]:null;
export const skillGoalKey=(origin,target)=>JSON.stringify([origin,targetKey(target)]);
const signature=event=>JSON.stringify([event.kind,targetKey(event.target)]);
function normalizeExample(items){
  const outcome=items.at(-1),fields=(outcome.formTargets??[]).filter(target=>!probeTarget(target));
  const fieldKey=target=>JSON.stringify(targetKey(target));
  const fieldsSet=new Set(fields.map(fieldKey));
  const result=[];
  for(const [index,event] of items.entries()){
    if(event===outcome)break;
    if(fields.length && fieldsSet.has(fieldKey(event.target)) && ['click','change'].includes(event.kind))continue;
    if(event.kind==='key' && ['INPUT','SELECT','TEXTAREA'].includes(event.tag)){
      // Filling a located field replaces its editing/focus keys, never its values.
      if(fields.length && fields.some(field=>field.tag===event.tag))continue;
      if(['Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) && items.slice(index+1).some(next=>next.kind==='change' && next.tag===event.tag))continue;
    }
    if(event.kind==='click' && ['INPUT','SELECT','TEXTAREA'].includes(event.target?.tag) && items.slice(index+1).some(next=>next.kind==='change' && fieldKey(next.target)===fieldKey(event.target)))continue;
    result.push(event);
  }
  // The submitted form exposes its input dependencies, not their recorded values.
  for(const field of fields)result.push({...outcome,kind:'change',tag:field.tag,target:field});
  result.push(outcome);return result;
}
export function analyzeSkills(events,brain=null){
  const episodes=[],pairedSubmits=new Map();let episode=[];let previous;
  for(const event of events){
    if(event.provenance!=='human' || event.source==='probe' || event.source==='agent' || probeTarget(event.target)){episode=[];previous=undefined;continue;}
    // Never mine arbitrary sliding windows: a boundary or an outcome closes an example.
    if(previous && (event.sessionId!==previous.sessionId || event.tabId!==previous.tabId || event.origin!==previous.origin || Date.parse(event.at)-Date.parse(previous.at)>30000 || event.kind==='page-visible'))episode=[];
    previous=event;
    if(!['click','change','submit','key'].includes(event.kind))continue;
    if(event.kind==='change' && episode.at(-1)?.kind==='click' && JSON.stringify(targetKey(episode.at(-1).target))===JSON.stringify(targetKey(event.target)))episode.pop();
    if(event.kind==='submit' && !episode.length){
      const last=episodes.at(-1)?.at(-1);
      if(last?.target?.type==='submit' && last.tabId===event.tabId && last.origin===event.origin && last.sessionId===event.sessionId && Date.parse(event.at)-Date.parse(last.at)<1500)pairedSubmits.set(last.id,event.id);
      continue;
    } // paired submit after a completed outcome click
    if(event.kind==='submit' && episode.at(-1)?.kind==='click' && episode.at(-1)?.target?.type==='submit')continue;
    episode.push(event);
    if(outcomeAction(event)){
      episodes.push(episode);
      episode=[];
    }
  }
  const patterns=new Map();
  for(const raw of episodes){
    const example=normalizeExample(raw);
    const origin=example[0].origin,key=JSON.stringify([origin,example.map(signature)]);
    if(!patterns.has(key))patterns.set(key,{key,origin,examples:[]});
    patterns.get(key).examples.push({steps:example,raw});
  }
  const candidates=[],learning=[];
  for(const pattern of patterns.values()){
    const confirmed=pattern.examples.filter(example=>['content-changed','form-submitted'].includes(example.steps.at(-1).effect));
    const example=(confirmed[0]??pattern.examples[0]).steps;
    const steps=example.map((event,index)=>({kind:event.kind,target:event.target??null,parameter:event.kind==='change'?`input_${index+1}`:null}));
    const examples=confirmed.slice(-5).map(({raw:items})=>({at:items[0].at,eventIds:[...items.map(event=>event.id),...(pairedSubmits.has(items.at(-1).id)?[pairedSubmits.get(items.at(-1).id)]:[])],effect:items.at(-1).effect}));
    const evidenceIds=confirmed.flatMap(({raw:items})=>[...items.map(event=>event.id),...(pairedSubmits.has(items.at(-1).id)?[pairedSubmits.get(items.at(-1).id)]:[])]);
    const assumption=brain?.assumptions?.findLast(item=>[...(item.decision?.evidenceIds??[]),...(item.decision?.skillAssessment?.evidenceIds??[])].some(id=>evidenceIds.includes(id)));
    const possible=assumption?.decision.skillAssessment;
    const model=possible?.evidenceIds?.some(id=>evidenceIds.includes(id))?possible:null;
    const localConfidence=steps.length>1?.88:.82;
    const reusability={reusable:true,confidence:localConfidence,source:'local',reason:'One completed attempt with named replay actions and an observed result is enough to save an inactive skill.'};
    if(model?.reusable){Object.assign(reusability,model,{source:'model'});reusability.reusable=true;}
    const candidate={reusability,qualityVersion:QUALITY_VERSION,key:pattern.key,goalKey:skillGoalKey(pattern.origin,steps.at(-1).target),origin:pattern.origin,steps,examples,evidenceIds,exampleCount:confirmed.length,
      title:model?.reusable?model.title:defaultSkillName(steps),outcome:steps.at(-1).target.label,
      context:assumption?{intent:assumption.decision.intent,confidence:assumption.decision.confidence,status:assumption.decision.status,explanation:assumption.decision.explanation}:null,
      assessment:'Learned from a completed workflow with an observed page change or native form submission. One good attempt is sufficient. Review the steps before activation.'};
    candidate.blockers=skillIssues(candidate);
    learning.push({goalKey:candidate.goalKey,title:candidate.title,observedExamples:confirmed.length,requiredExamples:1,blocked:candidate.blockers.some(issue=>!issue.startsWith('Complete one')),
      evidenceIds:pattern.examples.at(-1).raw.map(event=>event.id),at:pattern.examples.at(-1).raw.at(-1).at,
      blockers:candidate.blockers,modelAssessment:model,
      reason:candidate.blockers[0]??reusability.reason});
    if(!candidate.blockers.length)candidates.push(candidate);
  }
  // One suggestion per site/result, not one for every overlapping click combination.
  const goals=new Set();
  const suggestions=candidates.sort((a,b)=>b.exampleCount-a.exampleCount || a.steps.length-b.steps.length).filter(candidate=>{
    if(goals.has(candidate.goalKey))return false;goals.add(candidate.goalKey);return true;
  });
  const progress=new Map();
  for(const item of learning.sort((a,b)=>Number(a.blocked)-Number(b.blocked) || b.observedExamples-a.observedExamples))if(!progress.has(item.goalKey))progress.set(item.goalKey,item);
  if(episode.length){
    const last=episode.at(-1);
    learning.push({goalKey:skillGoalKey(last.origin,last.target),title:defaultSkillName(episode),at:last.at,
      observedExamples:0,requiredExamples:1,blocked:false,evidenceIds:episode.map(event=>event.id),
      blockers:[],modelAssessment:null,reason:outcomeAction(last)?'Waiting for an observed result.':'Still observing: finish with a supported result action such as Preview, Search, Export or Download.'});
  }
  for(const item of learning)if(!progress.has(item.goalKey))progress.set(item.goalKey,item);
  return {candidates:suggestions,learning:[...progress.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20)};
}
export const discoverSkills=(events,brain=null)=>analyzeSkills(events,brain).candidates;

export function repairSkill(skill,removeSteps){
  const indexes=removeSteps??skill.steps.map((step,index)=>probeTarget(step.target)?index:-1).filter(index=>index>=0);
  if(!Array.isArray(indexes) || !indexes.length || indexes.some(index=>!Number.isInteger(index) || index<0 || index>=skill.steps.length))throw new Error('Choose valid steps to remove.');
  const steps=skill.steps.filter((_step,index)=>!indexes.includes(index));
  const repaired={...skill,steps,active:false,repairedAt:new Date().toISOString(),
    repairHistory:[...(skill.repairHistory??[]),{at:new Date().toISOString(),removed:skill.steps.filter((_step,index)=>indexes.includes(index))}].slice(-5)};
  const issues=skillIssues(repaired);if(issues.length)throw new Error(issues[0]);
  return repaired;
}
