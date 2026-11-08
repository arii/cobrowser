import { z } from 'zod';

// Browser-safe execution projection. Presentation, screenshots and cached active flags
// are intentionally excluded; every field used to execute a workflow is included.
export const GateWorkflow = z.object({
  id:z.uuid(), instruction:z.string().max(4000),
  sites:z.array(z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),url:z.url().max(2000)}).strict()).min(1).max(8),
  steps:z.array(z.object({kind:z.enum(['click','change']),siteId:z.string().max(60),parameter:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/).nullable(),target:z.object({tag:z.enum(['BUTTON','A','INPUT','SELECT','TEXTAREA']),label:z.string().min(1).max(100),type:z.string().max(30)}).strict()}).strict()).min(1).max(48),
}).strict();
export type GateWorkflow=z.infer<typeof GateWorkflow>;
export const ReportingTask=z.object({family:z.literal('synthetic-weekly-report-v1'),team:z.enum(['red','blue']),asOf:z.iso.datetime(),timezone:z.string().min(1).max(100).refine(value=>{try{return value.includes('/')&&!!new Intl.DateTimeFormat('en',{timeZone:value});}catch{return false;}})}).strict();
export type ReportingTask=z.infer<typeof ReportingTask>;
const base={v:z.literal(1),seq:z.number().int().positive(),profileId:z.uuid(),workflow:GateWorkflow};
export const GateRequest=z.discriminatedUnion('kind',[
  z.object({...base,kind:z.literal('skill-gate:activate'),task:ReportingTask,reviewed:z.literal(true)}).strict(),
  z.object({...base,kind:z.literal('skill-gate:begin'),runId:z.uuid(),parameters:z.record(z.string(),z.string().max(2000)),instruction:z.string().max(4000)}).strict(),
  z.object({...base,kind:z.literal('skill-gate:check'),runId:z.uuid(),step:z.number().int().min(0).max(48)}).strict(),
  z.object({...base,kind:z.literal('skill-gate:finish'),runId:z.uuid(),status:z.enum(['finished','failed','cancelled'])}).strict(),
  z.object({...base,kind:z.literal('skill-gate:deactivate')}).strict(),
]);
export type GateRequest=z.infer<typeof GateRequest>;
