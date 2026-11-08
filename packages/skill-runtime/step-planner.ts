import { z } from 'zod';
// Intent-aware replay: the model picks which visible control realizes a step's intent on the current page.
const Target=z.object({tag:z.enum(['BUTTON','A','INPUT','SELECT','TEXTAREA']),label:z.string().min(1).max(100),type:z.string().max(30)}).strict();
const Control=z.object({target:Target,options:z.array(z.string().max(500)).max(100)}).strict();
export const SkillStepRequest=z.object({
  v:z.literal(1),kind:z.literal('skill-step'),seq:z.number().int().positive(),
  instruction:z.string().max(4000),at:z.iso.datetime(),timezone:z.string().max(100),
  skill:z.object({title:z.string().max(80),summary:z.string().max(400),outcome:z.object({kind:z.string().max(40),description:z.string().max(300)}).nullable(),step:z.number().int().nonnegative(),total:z.number().int().min(1).max(48)}).strict(),
  step:z.object({kind:z.enum(['click','change']),intent:z.string().max(200),recordedTarget:Target.nullable(),parameterDescription:z.string().max(300).nullable()}).strict(),
  page:z.object({siteId:z.string().max(60),origin:z.string().max(2000),title:z.string().max(160),text:z.string().max(12000),controls:z.array(Control).max(100)}).strict(),
  answers:z.array(z.object({question:z.string().max(500),answer:z.string().max(2000)}).strict()).max(12),
}).strict();
export type SkillStepRequest=z.infer<typeof SkillStepRequest>;
export const SkillStepDecision=z.object({
  action:z.enum(['act','skip','done','needs_input']),
  target:Target.nullable(),value:z.string().max(2000).nullable(),
  explanation:z.string().min(1).max(500),question:z.string().max(500).nullable(),
}).strict();
export type SkillStepDecision=z.infer<typeof SkillStepDecision>;
export function validateStepDecision(raw:unknown,input:SkillStepRequest):SkillStepDecision{
  const decision=SkillStepDecision.parse(raw);
  if(decision.action==='act'){
    if(!decision.target || decision.question!==null)throw new Error('skill-step-invalid-action');
    const control=input.page.controls.find(item=>JSON.stringify(item.target)===JSON.stringify(decision.target));
    if(!control)throw new Error('skill-step-target-not-on-page');
    const inputTags=['INPUT','SELECT','TEXTAREA'];
    if(input.step.kind==='click' && inputTags.includes(decision.target.tag))throw new Error('skill-step-kind-mismatch');
    if(input.step.kind==='change'){
      if(!inputTags.includes(decision.target.tag) || decision.value===null)throw new Error('skill-step-kind-mismatch');
      if(decision.target.tag==='SELECT' && !control.options.includes(decision.value))throw new Error('skill-step-invalid-option');
    } else if(decision.value!==null)throw new Error('skill-step-unexpected-value');
  } else if(decision.action==='needs_input'){
    if(!decision.question?.trim() || decision.target!==null || decision.value!==null)throw new Error('skill-step-invalid-question');
  } else if(decision.target!==null || decision.value!==null || decision.question!==null)throw new Error('skill-step-invalid-action');
  return decision;
}
export function skillStepHandler(resolve:(input:SkillStepRequest)=>Promise<unknown>){
  return async(raw:unknown)=>{const input=SkillStepRequest.parse(raw);return {v:1,kind:'skill-step-result',seq:input.seq,decision:validateStepDecision(await resolve(input),input)};};
}
