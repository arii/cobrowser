# Autonomous skill discovery: plan

Status: proposal, 2026-11-07. Nothing here is built.

## Problem

Today the human decides when a demonstration starts and stops (toolbar button, `apps/extension/src/background.ts`).
That makes Cerebral a recorder with a verifier bolted on. The agent should find the tasks itself:
record continuously, work out after the fact which stretches of activity were tasks, work out which of
those are worth automating, and come to the human with a proposal instead of waiting for a button press.

## Thesis

A task worth automating is one the human **repeats**. Repetition is the signal, for three reasons:

1. It is the only signal that says "automatable" rather than "hard". A one-off task that is hard for the
   human is also hard for an agent learning from a single demonstration.
2. N repetitions are a better demonstration than one. Nodes that appear after the action in every
   repetition are real postconditions; nodes that appear in only some are noise. Values that differ
   across repetitions are **parameters**. The current `derive.py` works from one demo and cannot tell
   these apart.
3. It gives the human nothing to do up front. The first time they hear from Cerebral is "you have done
   this three times, want me to take it from here?"

Everything else (keyboard dynamics, hesitation, a camera) is at best a ranking signal, never the trigger.

## What gets captured, always, on every tab

The sensor already exists (`packages/page-capture/src/page.ts`). Changes:

- Manifest `content_scripts` on `<all_urls>` instead of programmatic injection into one tab.
- One `TraceCoalescer` per tab in the service worker (today there is one, for the recorded tab).
  Coalescer state persisted per tab to `chrome.storage.session` as now.
- Per-tab `webRequest` logs (today: one log for the recorded tab).
- Raw trace events stored locally in IndexedDB (`unlimitedStorage` permission) before anything is
  sent. The service worker dies after ~30 s idle; IndexedDB survives it, the current in-memory `net`
  array does not.
- New cheap signals from the content script, sampled, not every event:
  - idle gaps (`chrome.idle.onStateChanged`, plus no input for N seconds),
  - tab focus changes (`chrome.tabs.onActivated`), omnibox-initiated navigations
    (`webNavigation` transition type `typed`/`auto_bookmark`),
  - clipboard copy/paste events (the classic cross-app automation tell: copy from A, paste into B),
  - back navigation, page find (Ctrl/Cmd+F), re-typing the same field, repeated clicks on the same
    anchor whose after-state hash equals the before-state hash, backspace ratio per field.
    These make up a **friction score** per episode. See "Camera" below for why this replaces it.
- Redaction at the sensor, never later: password fields already; add card-number and SSN-shaped
  values, and a per-site blocklist (banking, health, anything the user adds) that drops the tab
  entirely. Incognito is excluded by Chrome. A visible always-on indicator and a kill switch in the
  toolbar menu. Raw retention 14 days; candidates and approved skills kept.

Cost check: a snapshot is an a11y walk plus a network-quiet wait of up to 4 s. On every click on every
tab that is fine because it is asynchronous and the human is slower than the settle window. Storage is
the real cost: store full before/after snapshots, but drop any event whose before and after hashes are
equal and that produced no non-GET request (it is reading, not acting), and cap per-site storage.

## Where the mining runs

Option A: in the extension (TypeScript). Local-first, nothing leaves the machine until a proposal is
approved. Costs: reimplement derivation, no numeric libraries, service-worker lifetime limits.

Option B: on the API (Python). Reuses `derive.py`, `difflib`/numpy available, easy to test under pytest
with the existing fixtures. The API already runs on localhost in this setup, so nothing leaves the
machine either.

Recommendation: **B**, with a hard rule that the extension sends redacted events only and the API
stores them under `runs/capture/` with the same retention. The extension stays a dumb, resilient
sensor with a ring buffer that flushes to `POST /capture/events` in order (the existing `sendChain`
pattern). Moving mining into the extension later is a port, not a redesign.

## Pipeline (API side)

```
events (per tab, redacted) -> segment -> filter -> normalize -> cluster -> derive (N demos) -> propose
```

1. **Segment** events into episodes. Boundaries, strongest first: idle > 90 s; a "commit" (a
   non-GET request with 2xx after an action, followed by a URL path change); an omnibox navigation;
   a tab closing. Tab switches and domain changes are **not** boundaries: cross-app tasks are the
   ones worth automating. This means a skill's `site` becomes a list, a schema change.
2. **Filter** out episodes with no state-changing action (every before hash == after hash and no
   non-GET request). What remains is "the human did something to the world".
3. **Normalize** each event to a token: `(host, action.kind, anchor with digits masked, url pattern
   from derive._url_pattern, value -> SLOT)`. An episode becomes a token sequence.
4. **Cluster** episodes by sequence similarity. Episodes are short (5 to 30 tokens), so pairwise
   alignment is enough: Needleman-Wunsch over tokens with anchor similarity as the match score, then
   single-linkage at a threshold. No frequent-pattern library needed. A cluster with at least 3
   members inside a 14 day window is a **candidate**. (2 is tempting but produces false positives
   from coincidence; start at 3 and make it a setting.)
5. **Derive** a skill from N demos, `skill_from_demos`. Per aligned position: action from the
   consensus; preconditions and postconditions are the **intersection** of what `derive_postconditions`
   yields across members (tagged `source: derived`, with the count it held in); values that differ
   across members become `parameters` on the skill, filled at run time from the current page or
   asked for. Members where a step is missing become optional steps or split the cluster.
6. **Propose.** `GET /proposals` lists candidates with: inferred name and goal (Meta model, as
   `meta.name_steps` does today), repetitions, time spent per repetition, friction score. The
   extension shows a badge count. The proposals page lets the human approve, rename, or dismiss.
   Approval is the first and only required human input. Dismissals are recorded so the same
   cluster is not proposed again, and they feed the detector's own eval (below).

## Live detection and takeover (the payoff)

Once skills exist, the service worker prefix-matches the current open episode against the skill
library on every event. When the first k tokens of a skill match (k = 2 or 3, tuned on the fixture),
the badge offers "finish this for me". On accept, the run starts from the current step with the
skill's parameters bound from what the human already typed. Precondition checks already exist and
decide whether the page is where the skill expects.

Open design question: who executes the takeover? The worker (Playwright) runs the verified loop but
does not have the human's session. The extension has the session but no loop. Cleanest answer: make
the worker's session interface (`apps/browser/src/session.ts`: act, snapshot, settle) a protocol the
extension can also implement, so the LangGraph loop in the API drives either. This is the largest
single piece of work in the plan and is not needed for discovery itself.

## The toolbar button stays, reframed

Not start/stop. One press means "what I just did was a task": it labels the most recent episode as a
positive example, creates a skill from it immediately (today's one-demo path), and the label trains the
segmenter's boundary heuristics. No need to know in advance that you are about to do something worth
recording. This is also the fallback for tasks that never repeat.

## Camera

Recommendation: do not build it, in any phase before the behavioral friction score has been shown to
be insufficient. Reasons:

- It measures the wrong thing. Facial affect says "this is effortful", not "this is repetitive and
  automatable". Effortful tasks are usually novel ones, where a single demonstration gives the agent
  the least to work with.
- Accuracy of webcam affect detection outside a lab is poor, and the failure mode (recording someone's
  face while they bank) is the one that gets an extension uninstalled and written about.
- MV3 cannot hold a camera stream from the service worker; it needs an offscreen document, which
  Chrome shows as a persistent recording indicator. "Always-on camera" and "always-on browsing capture"
  in one extension is a trust budget we cannot spend before the product has earned it.
- Everything the camera would tell us about struggle has a cheaper behavioral proxy that is already
  in the input stream: backtracking, re-typing, dead clicks, find-in-page, tab churn, dwell time.

If it is ever added, it is an optional ranking signal on proposals, gated behind an explicit opt-in,
processed on device, storing only a scalar per episode. Never pixels.

## Phases

| Phase | Deliverable | Done when |
| --- | --- | --- |
| 0 Always-on sensor | Multi-tab capture, IndexedDB buffer, `POST /capture/events`, redaction, blocklist, kill switch, retention. Manual button becomes "that was a task". | Playwright e2e: two tabs, interleaved actions, events arrive in order with correct tab ids; killing the service worker mid-episode loses nothing. |
| 1 Segment and filter | `capture/segment.py`, friction score, debug timeline page in the extension listing episodes. | Fixture test: scripted noise browsing plus one task yields exactly one state-changing episode with the right boundaries. |
| 2 Mine and propose | normalize, align, cluster, `skill_from_demos` with parameters, `GET /proposals`, proposals page, approve/dismiss. | Fixture test: the same task 3 times with different values plus noise yields one proposal with the right parameter slots and postconditions that hold in all three. |
| 3 Live takeover | Prefix match, "finish this for me", session protocol shared by worker and extension, run from mid-episode with bound parameters. | Fixture test: start the task by hand, accept the offer, run finishes with a verified receipt. |
| 4 Ranking signals | Friction-weighted proposal ordering; camera only if 1 to 3 show the behavioral score is not enough. | Dashboard shows proposals accepted vs dismissed by score band. |

Phases 0 to 2 are the product. Phase 3 is the demo moment. Phase 4 is optional.

## Evaluating the detector itself

Same ethos as the rest of the project: the detector makes claims and something else scores them.

- Proposal precision: accepted / (accepted + dismissed), in the ledger per detector version.
- Segmentation accuracy on the fixture: boundary F1 against the scripted ground truth.
- Time to first proposal per user and per site.
- Over-capture: fraction of stored events that were filtered as non-acting. If it is above ~80%,
  stop snapshotting on those events at the sensor.

## Schema changes

- `Skill.site: str` -> `sites: list[str]`; `Skill.parameters: list[Parameter]` with name, example
  values, and which step and field each fills.
- `Assertion.source` gains `derived` with a `support: int` (how many repetitions it held in).
- New `Episode`, `Candidate`, `Proposal` models and a `capture` store under `runs/`.
- `Demo` stays for the manual path and for phase-3 corrections.

## Decisions needed

1. Mining location: API (recommended) or extension.
2. Repetition threshold: 3 (recommended) or 2.
3. Camera: drop (recommended) or defer to phase 4 behind opt-in.
4. Takeover execution surface: shared session protocol (recommended, large) or worker-only with
   cookie export (fast, fragile).
