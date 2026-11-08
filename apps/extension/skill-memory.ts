type Action = {id:string;sessionId:string;tabId:number;origin:string;at:string};
type Frame = {at:string;sessionId:string;tabId:number;origin:string;image:{mediaType:string;base64:string}};
type LearnedSkill = {
  evidenceIds:string[];outcome:string;context?:{intent?:string}|null;
  steps:{kind:string;target?:{label:string}|null;parameter?:string|null}[];
  instruction?:string;family?:string;
  memory?:{intent:string;howTo:string[];expectedResult:string;screenshots:Frame[]};
};
// Copy only already masked captures belonging to this demonstration, never another tab/task.
export function attachSkillMemory(skill:LearnedSkill,events:Action[],visual?:{frames?:Frame[]}){
  const evidence=events.filter(event=>skill.evidenceIds.includes(event.id));
  const intent=skill.context?.intent?.trim() || skill.outcome;
  const screenshots=(visual?.frames??[]).filter(frame=>{
    const matching=evidence.filter(event=>event.sessionId===frame.sessionId && event.tabId===frame.tabId && event.origin===frame.origin);
    if(!matching.length)return false;
    const times=matching.map(event=>Date.parse(event.at)),at=Date.parse(frame.at);
    return at>=Math.min(...times)-10000 && at<=Math.max(...times)+10000
      && ['image/jpeg','image/png','image/webp'].includes(frame.image.mediaType) && frame.image.base64.length<=100000;
  }).slice(-2).map(frame=>({...frame,image:{...frame.image}}));
  skill.memory={intent,howTo:skill.family==='guest-list-linkedin-v1'?[
    'Read the configured guest list, paginate within its origin, and deduplicate guests.',
    'Review the extracted guest batch before sending connection requests.',
    'Find each guest on LinkedIn using their full name and affiliation or source profile link; clarify ambiguous matches.',
    'Skip existing connections and pending invitations; preserve dispatch progress across runs.',
    'Send one connection request per confirmed profile and require an observed pending invitation before reporting success.'
  ]:skill.steps.map(step=>step.kind==='change'
    ? `Choose ${step.target?.label} from the current instruction and source pages (${step.parameter}).`
    : `Click ${step.target?.label}.`),expectedResult:skill.outcome,screenshots};
  skill.instruction ||= intent;
  return skill;
}

export function confirmSkillIntent<T extends LearnedSkill>(skill:T,intent:unknown):T{
  if(typeof intent!=='string' || !intent.trim() || intent.trim().length>4000){
    throw new Error('Describe what this skill should accomplish in 1 to 4,000 characters.');
  }
  const confirmed=intent.trim();
  return {...skill,instruction:confirmed,memory:{
    intent:confirmed,howTo:skill.memory?.howTo??[],expectedResult:skill.outcome,
    screenshots:skill.memory?.screenshots??[],
  }};
}
