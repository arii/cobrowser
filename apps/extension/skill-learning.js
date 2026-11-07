// Conservative local discovery: complete examples with an observed visible result.
export const QUALITY_VERSION=3;
export const riskyAction=/\b(send|pay|purchase|buy|checkout|delete|remove|destroy|publish|transfer|unsubscribe|confirm order|sign out|log out)\b/i;
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
export function defaultSkillName(steps){
  const label=steps?.at(-1)?.target?.label?.replace(/\s+/g,' ').trim();
  if(!label)return 'Workflow needs new examples';
  const templates={export:'Export report',download:'Download report',preview:'Preview report',search:'Search records',filter:'Filter results',generate:'Generate report',calculate:'Calculate results'};
  return (templates[label.toLowerCase()]??label).slice(0,80);
}
export function skillIssues(skill){
  const issues=[];
  if(!Array.isArray(skill.steps) || !skill.steps.length || skill.steps.length>12)return ['This workflow has no complete, supported action sequence.'];
  for(const [index,step] of skill.steps.entries()){
    if(!validTarget(step?.target) || !['click','change'].includes(step.kind))issues.push(`Step ${index+1} has no supported, named action.`);
    if(step?.target && riskyAction.test(step.target.label))issues.push(`Step ${index+1} may have an irreversible effect.`);
    if(step?.kind==='change' && (!['INPUT','SELECT','TEXTAREA'].includes(step.target?.tag) || !/^input_\d+$/.test(step.parameter??'')))issues.push(`Step ${index+1} has no usable input parameter.`);
    if(step?.kind==='click' && !['BUTTON','A'].includes(step.target?.tag))issues.push(`Step ${index+1} only focuses a field.`);
    if(step?.target?.type==='submit' && !/\b(export|download|search|filter)\b/i.test(step.target.label))issues.push(`Step ${index+1} has an unsupported form submission.`);
  }
  if(!outcomeAction(skill.steps.at(-1)))issues.push('This workflow does not end with a supported result action.');
  if(![2,QUALITY_VERSION].includes(skill.qualityVersion) || !Array.isArray(skill.examples) || !skill.examples.some(example=>['content-changed','form-submitted'].includes(example.effect)))issues.push('Complete one workflow with an observed result or form submission to learn this skill.');
  if(skill.reusability && (skill.reusability.confidence<.8 || skill.reusability.reusable!==true))issues.push('This attempt is not yet supported as a reusable skill.');
  return [...new Set(issues)];
}
const targetKey=target=>target?[target.tag,target.label,target.type]:null;
export const skillGoalKey=(origin,target)=>JSON.stringify([origin,targetKey(target)]);
const signature=event=>JSON.stringify([event.kind,targetKey(event.target)]);
function normalizeExample(items){
  const outcome=items.at(-1),fields=outcome.formTargets??[];
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
    if(event.provenance!=='human')continue;
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
    const awaitingModel=brain?.mode==='live' && brain.modelAvailable!==false && !model;
    const reusability=model?{...model,source:'model'}:{reusable:!awaitingModel,confidence:awaitingModel?0:localConfidence,source:'local',reason:awaitingModel?'Waiting for the context model to assess this attempt.':'A completed, named workflow with an observed result and supported replay actions.'};
    const candidate={reusability,qualityVersion:QUALITY_VERSION,key:pattern.key,goalKey:skillGoalKey(pattern.origin,steps.at(-1).target),origin:pattern.origin,steps,examples,evidenceIds,exampleCount:confirmed.length,
      title:model?.reusable?model.title:defaultSkillName(steps),outcome:steps.at(-1).target.label,
      context:assumption?{intent:assumption.decision.intent,confidence:assumption.decision.confidence,status:assumption.decision.status,explanation:assumption.decision.explanation}:null,
      assessment:'Learned from a completed workflow with an observed page change or native form submission. One good attempt is sufficient. Review the steps before activation.'};
    candidate.blockers=skillIssues(candidate);
    learning.push({goalKey:candidate.goalKey,title:candidate.title,observedExamples:confirmed.length,requiredExamples:1,blocked:candidate.blockers.some(issue=>!issue.startsWith('Complete one')),
      reason:awaitingModel?reusability.reason:candidate.blockers[0]??(confirmed.length?'Skill ready from this attempt.':'Waiting for an observed task result or native form submission.')});
    if(!candidate.blockers.length)candidates.push(candidate);
  }
  // One suggestion per site/result, not one for every overlapping click combination.
  const goals=new Set();
  const suggestions=candidates.sort((a,b)=>b.exampleCount-a.exampleCount || a.steps.length-b.steps.length).filter(candidate=>{
    if(goals.has(candidate.goalKey))return false;goals.add(candidate.goalKey);return true;
  }).slice(0,3);
  const progress=new Map();
  for(const item of learning.sort((a,b)=>Number(a.blocked)-Number(b.blocked) || b.observedExamples-a.observedExamples))if(!progress.has(item.goalKey))progress.set(item.goalKey,item);
  return {candidates:suggestions,learning:[...progress.values()].slice(0,3)};
}
export const discoverSkills=(events,brain=null)=>analyzeSkills(events,brain).candidates;
