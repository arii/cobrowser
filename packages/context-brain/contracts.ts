import { z } from 'zod';

const label = z.string().min(1).max(300);
export const BrainEvent = z.object({
  id:label, at:z.iso.datetime(), sessionId:label, origin:z.url().refine(value=>{const url=new URL(value);return ['http:','https:'].includes(url.protocol) && url.origin===value;}), tabId:z.number().int().nonnegative(),
  documentId:label.optional(), provenance:z.literal('human'),
  kind:z.enum(['click','change','submit','scroll','page-visible','pointer','key','screen-change','page-content']),
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
export const TabContext = z.object({
  tabId:z.number().int().nonnegative(),origin:z.url().refine(value=>{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&u.origin===value;}),
  title:z.string().max(160),headings:z.array(z.string().max(120)).max(3),excerpt:z.string().max(1200),
  active:z.boolean(),observedAt:z.iso.datetime(),readStatus:z.enum(['ready','empty','unavailable']),readError:z.string().max(100).optional(),
}).strict();
export type TabContext=z.infer<typeof TabContext>;
export const DomSnapshot=z.object({
  documentId:label,at:z.iso.datetime(),origin:z.string().max(300),title:z.string().max(160),
  headings:z.array(z.string().max(120)).max(3),excerpt:z.string().max(1200),
  viewport:z.object({width:z.number().positive(),height:z.number().positive(),scrollX:z.number(),scrollY:z.number()}).strict(),
  nodes:z.array(z.object({tag:z.string().max(20),role:z.string().max(40),text:z.string().max(80)}).strict()).max(40),
}).strict();
export type DomSnapshot=z.infer<typeof DomSnapshot>;
export const MotionSummary=z.object({
  samples:z.array(z.object({at:z.iso.datetime(),x:z.number().min(0).max(1),y:z.number().min(0).max(1)}).strict()).max(30),
  distance:z.number().nonnegative(),clicks:z.number().int().nonnegative(),scrolls:z.number().int().nonnegative(),keys:z.number().int().nonnegative(),
}).strict();
export const VisualSummary=z.object({summary:z.string().min(1).max(800),changes:z.array(z.string().max(200)).max(5),confidence:z.number().min(0).max(1)}).strict();
export type VisualSummary=z.infer<typeof VisualSummary>;
export const IntervalEvidence=z.object({
  id:label,tabId:z.number().int().nonnegative(),at:z.iso.datetime(),reason:z.enum(['interval','tab-change']),
  before:DomSnapshot.nullable(),after:DomSnapshot,motion:MotionSummary,
  imageHashes:z.array(z.string().max(100)).max(2),visualSummary:VisualSummary.nullable(),
}).strict();
export type IntervalEvidence=z.infer<typeof IntervalEvidence>;
export const NextAction=z.object({
  kind:z.enum(['click','type','scroll','switch-tab','navigate','submit','wait','unknown']),
  description:z.string().min(1).max(300),targetTabId:z.number().int().nonnegative().nullable(),
  confidence:z.number().min(0).max(1),evidenceIds:z.array(label).min(1).max(12),
}).strict();
export type NextAction=z.infer<typeof NextAction>;
export const ContextDecision = z.object({
  intent:label, summary:z.string().min(1).max(1200),
  status:z.enum(['continuing','new_task','uncertain','completed']),
  confidence:z.number().min(0).max(1), evidenceIds:z.array(label).min(1).max(12),
  explanation:z.string().min(1).max(500),nextAction:NextAction,
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
  intent:string; summary:string; confidence:number; status:ContextDecision['status'];nextAction:NextAction;
};
export type BrainInput = {
  previous:WorkingContext|null; events:BrainEvent[]; signals:SnapSignals|null;
  tabs?:TabContext[];
  observation?:IntervalEvidence;
  freshEventIds?:string[];
  candidate?:{intent:string;confirmations:number}|null;
};
export type ContextFrame = {image:import('../model-adapters/index.js').Image;at:string;sessionId:string;origin:string;tabId:number};
export interface BrainProviders {
  readonly contextModel?:string;
  mode:'live'|'replay';
  snap(input:{previous:WorkingContext|null;events:BrainEvent[];images:import('../model-adapters/index.js').Image[];frameTimes:string[]}):Promise<CallResult<SnapSignals>>;
  vision?(frames:ContextFrame[]):Promise<CallResult<VisualSummary>>;
  context(input:BrainInput):Promise<CallResult<ContextDecision>>;
}
