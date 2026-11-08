import { z } from 'zod';
const Target=z.object({tag:z.enum(['INPUT','SELECT','TEXTAREA']),label:z.string().min(1).max(100),type:z.string().max(30)}).strict();
export const SkillInputRequest=z.object({
  v:z.literal(1),kind:z.literal('skill-input'),seq:z.number().int().positive(),
  instruction:z.string().min(1).max(4000),at:z.iso.datetime(),timezone:z.string().max(100),
  skill:z.object({title:z.string().max(80),step:z.number().int().nonnegative(),total:z.number().int().min(1).max(48)}).strict(),
  target:Target,options:z.array(z.string().max(500)).max(100),
  pages:z.array(z.object({siteId:z.string().max(60),origin:z.string().max(2000),title:z.string().max(160),text:z.string().max(12000)}).strict()).min(1).max(8),
  answers:z.array(z.object({question:z.string().max(500),answer:z.string().max(2000)}).strict()).max(12),
}).strict();
export type SkillInputRequest=z.infer<typeof SkillInputRequest>;
export const SkillInputDecision=z.object({
  status:z.enum(['resolved','needs_input']),value:z.string().max(2000).nullable(),
  explanation:z.string().min(1).max(500),question:z.string().max(500).nullable(),
  sourceSiteIds:z.array(z.string().max(60)).max(8),
}).strict();
export type SkillInputDecision=z.infer<typeof SkillInputDecision>;
export function validateInputDecision(raw:unknown,input:SkillInputRequest):SkillInputDecision{
  const decision=SkillInputDecision.parse(raw);
  if(decision.sourceSiteIds.some(id=>!input.pages.some(page=>page.siteId===id)))throw new Error('skill-input-unknown-source');
  if(decision.status==='resolved'){
    if(decision.value===null || decision.question!==null)throw new Error('skill-input-invalid-resolution');
    if(input.target.tag==='SELECT' && !input.options.includes(decision.value))throw new Error('skill-input-invalid-option');
  }else if(!decision.question?.trim() || decision.value!==null)throw new Error('skill-input-invalid-question');
  return decision;
}
export function skillInputHandler(resolve:(input:SkillInputRequest)=>Promise<unknown>){
  return async(raw:unknown)=>{const input=SkillInputRequest.parse(raw);return {v:1,kind:'skill-input-result',seq:input.seq,decision:validateInputDecision(await resolve(input),input)};};
}
