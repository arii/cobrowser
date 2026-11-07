// Mirrors apps/api/cerebral/schemas.py. Keep in sync by hand; both sides are small.
import { z } from "zod";

export const A11yNode = z.object({ role: z.string(), name: z.string().default(""), value: z.string().default("") });
export const NetworkEvent = z.object({ method: z.string().default("GET"), url: z.string(), status: z.number() });
// Diagnostics from the page script's walk (packages/page-capture) plus how the worker obtained the snapshot.
// Logged, never hashed: an empty tree is explained by these numbers.
export const CaptureStats = z.object({
  scanned: z.number(), emitted: z.number(), hidden: z.number(), boxless: z.number(), truncated: z.boolean(),
  source: z.string().optional(),
});
export const Snapshot = z.object({
  url: z.string(),
  title: z.string().default(""),
  tree: z.array(A11yNode),
  text: z.string().default(""),
  capture: CaptureStats.optional(),
  network: z.array(NetworkEvent),
  screenshot_ref: z.string().nullable().default(null),
  captured_at: z.string(),
});
export const Action = z.object({
  kind: z.enum(["navigate", "click", "type", "select", "press", "wait", "noop"]),
  target: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  description: z.string().default(""),
});
export type Snapshot = z.infer<typeof Snapshot>;
export type Action = z.infer<typeof Action>;
export type A11yNode = z.infer<typeof A11yNode>;
export type NetworkEvent = z.infer<typeof NetworkEvent>;
