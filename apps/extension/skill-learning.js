// Conservative local discovery: complete examples with an observed visible result.
export const QUALITY_VERSION=2;
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
  if(skill.qualityVersion!==QUALITY_VERSION || !Array.isArray(skill.examples) || skill.examples.filter(example=>example.effect==='content-changed').length<3)issues.push('Record three complete examples with an observed result to use this workflow.');
  return [...new Set(issues)];
}
const signature=event=>JSON.stringify([event.kind,event.target??null]);
export function discoverSkills(events,brain=null){
  const episodes=[];let episode=[];let previous;
  for(const event of events){
    if(event.provenance!=='human')continue;
    // Never mine arbitrary sliding windows: a boundary or an outcome closes an example.
    if(previous && (event.sessionId!==previous.sessionId || event.tabId!==previous.tabId || event.origin!==previous.origin || Date.parse(event.at)-Date.parse(previous.at)>30000 || event.kind==='page-visible'))episode=[];
    previous=event;
    if(!['click','change','submit','key'].includes(event.kind))continue;
    if(event.kind==='change' && episode.at(-1)?.kind==='click' && JSON.stringify(episode.at(-1).target)===JSON.stringify(event.target))episode.pop();
    if(event.kind==='submit' && !episode.length)continue; // paired submit after a completed outcome click
    if(event.kind==='submit' && episode.at(-1)?.kind==='click' && episode.at(-1)?.target?.type==='submit')continue;
    episode.push(event);
    if(outcomeAction(event)){
      if(event.effect==='content-changed' && episode.length<=12)episodes.push(episode);
      episode=[];
    }
  }
  const patterns=new Map();
  for(const example of episodes){
    const origin=example[0].origin,key=JSON.stringify([origin,example.map(signature)]);
    if(!patterns.has(key))patterns.set(key,{key,origin,examples:[]});
    patterns.get(key).examples.push(example);
  }
  const candidates=[];
  for(const pattern of patterns.values()){
    if(pattern.examples.length<3)continue;
    const example=pattern.examples[0];
    const steps=example.map((event,index)=>({kind:event.kind,target:event.target??null,parameter:event.kind==='change'?`input_${index+1}`:null}));
    const examples=pattern.examples.slice(-5).map(items=>({at:items[0].at,eventIds:items.map(event=>event.id),effect:items.at(-1).effect}));
    const evidenceIds=pattern.examples.flatMap(items=>items.map(event=>event.id));
    const assumption=brain?.assumptions?.findLast(item=>item.decision?.evidenceIds?.some(id=>evidenceIds.includes(id)));
    const candidate={qualityVersion:QUALITY_VERSION,key:pattern.key,goalKey:JSON.stringify([pattern.origin,steps.at(-1).target]),origin:pattern.origin,steps,examples,evidenceIds,exampleCount:pattern.examples.length,
      title:defaultSkillName(steps),outcome:steps.at(-1).target.label,
      context:assumption?{intent:assumption.decision.intent,confidence:assumption.decision.confidence,status:assumption.decision.status,explanation:assumption.decision.explanation}:null,
      assessment:'A complete workflow repeated at least three times, each ending with an observed page-content change. Review the steps and check the task result after replay.'};
    candidate.blockers=skillIssues(candidate);
    if(!candidate.blockers.length)candidates.push(candidate);
  }
  // One suggestion per site/result, not one for every overlapping click combination.
  const goals=new Set();
  return candidates.sort((a,b)=>b.exampleCount-a.exampleCount || a.steps.length-b.steps.length).filter(candidate=>{
    if(goals.has(candidate.goalKey))return false;goals.add(candidate.goalKey);return true;
  }).slice(0,3);
}
