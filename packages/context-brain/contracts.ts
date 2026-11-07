import { z } from 'zod';

const label = z.string().min(1).max(300);
export const BrainEvent = z.object({
  id:label, at:z.iso.datetime(), sessionId:label, origin:z.url().refine(value=>{const url=new URL(value);return ['http:','https:'].includes(url.protocol) && url.origin===value;}), tabId:z.number().int().nonnegative(),
  documentId:label.optional(), provenance:z.literal('human'),
  kind:z.enum(['click','change','submit','scroll','page-visible','pointer','key','screen-change']),
  tag:z.enum(['INPUT','SELECT','TEXTAREA','BUTTON','A','FORM','PAGE','OTHER']),
  x:z.number().min(0).max(1).optional(), y:z.number().min(0).max(1).optional(),
  key:z.enum(['Tab','Enter','Escape','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight']).optional(),
}).strict().superRefine((event, context) => {
  if ((event.x === undefined) !== (event.y === undefined)) context.addIssue({code:'custom',message:'paired-coordinates-required'});
  if (event.kind==='key' && !event.key) context.addIssue({code:'custom',message:'key-metadata-required'});
  if (event.kind==='pointer' && event.x===undefined) context.addIssue({code:'custom',message:'pointer-coordinates-required'});
  if (event.key && event.kind !== 'key') context.addIssue({code:'custom',message:'unexpected-key'});
});
export type BrainEvent = z.infer<typeof BrainEvent>;
export const ContextDecision = z.object({
  intent:label, summary:z.string().min(1).max(1200),
  status:z.enum(['continuing','new_task','uncertain','completed']),
  confidence:z.number().min(0).max(1), evidenceIds:z.array(label).min(1).max(12),
  explanation:z.string().min(1).max(500),
}).strict();
export type ContextDecision = z.infer<typeof ContextDecision>;
export const SnapSignals = z.object({
  taskRelation:z.enum(['same','different','uncertain']),
  relationConfidence:z.number().min(0).max(1),
  screenChanged:z.number().min(0).max(1).nullable(),
  actionClass:z.enum(['editing','navigation','submission','inspection','uncertain']),
  actionConfidence:z.number().min(0).max(1),
  visualTask:z.enum(['report_export','search','editing','communication','checkout','settings','other','unknown']),
  visualState:z.enum(['form_entry','result_ready','download_confirmation','error','unknown']),
  visualConfidence:z.number().min(0).max(1),
}).strict();
export type SnapSignals = z.infer<typeof SnapSignals>;
export type CallResult<T> = {value:T; model:string; mode:'live'|'replay'; latencyMs:number; inputHash:string; usage:Record<string,unknown>; version:string};
export type WorkingContext = {
  taskId:string; scope:string; openedAt:string; updatedAt:string;
  intent:string; summary:string; confidence:number; status:ContextDecision['status'];
};
export type BrainInput = {
  previous:WorkingContext|null; events:BrainEvent[]; signals:SnapSignals|null;
  freshEventIds?:string[];
  candidate?:{intent:string;confirmations:number}|null;
};
export type ContextFrame = {image:import('../model-adapters/index.js').Image;at:string;sessionId:string;origin:string;tabId:number};
export interface BrainProviders {
  readonly contextModel?:string;
  mode:'live'|'replay';
  snap(input:{previous:WorkingContext|null;events:BrainEvent[];images:import('../model-adapters/index.js').Image[];frameTimes:string[]}):Promise<CallResult<SnapSignals>>;
  context(input:BrainInput):Promise<CallResult<ContextDecision>>;
}
