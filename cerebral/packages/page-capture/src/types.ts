// Structural mirrors of apps/api/cerebral/schemas.py (Snapshot, Action, TraceEvent). The worker keeps
// its own zod versions in apps/browser/src/types.ts; these are plain types so the extension can share
// them without a runtime dependency. Keep all three in sync by hand.

export type A11yNode = { role: string; name: string; value: string };
export type NetworkEvent = { method: string; url: string; status: number };

/** How the tree was computed: elements walked, nodes emitted, subtrees dropped as hidden, display:contents
 *  wrappers walked through, and whether MAX_NODES cut the walk short. Diagnostics only: never hashed. */
export type CaptureStats = { scanned: number; emitted: number; hidden: number; boxless: number; truncated: boolean };

/** What the page itself can report about its state. The host adds network + captured_at (and, when it had to
 *  inject the script or got nothing back, `capture.source`). */
export type PageSnapshot = { url: string; title: string; tree: A11yNode[]; text: string; capture?: CaptureStats & { source?: string } };

export type Snapshot = PageSnapshot & {
  network: NetworkEvent[];
  screenshot_ref: string | null;
  captured_at: string;
};

export type ActionKind = "navigate" | "click" | "type" | "select" | "press" | "wait" | "noop";
export type Action = { kind: ActionKind; target?: string | null; value?: string | null; description: string };

export type TraceEvent = { before: Snapshot; action: Action; after: Snapshot };

/** What the page script reports to its host, one per DOM-level interaction. */
export type RawEvent =
  | { type: "click"; role: string; name: string }
  | { type: "input"; role: string; name: string; value: string; secret?: boolean }
  | { type: "select"; name: string; value: string }
  | { type: "key"; key: string };
