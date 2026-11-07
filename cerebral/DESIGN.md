# Cerebral: design

A browser agent that learns a web skill from one human demonstration, replays it alone, and proves every run instead of claiming success. Verification is the spine. Everything else is in service of it.

## 1. Thesis

Most browser agents report "done". We do not trust that report. The agent's job is to produce evidence; a separate verifier decides whether the task was achieved. That split gives us three things at once:

- an eval story (every run is scored against fixed, declared checks),
- a co-browsing story (a failed check is the handoff trigger, and the human's fix is a measurable improvement),
- a verifiability story (a run receipt a third party can recompute).

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| Demonstration | One human performance of the task on the shared browser. Captured as (state before, action, state after) triples. |
| Snapshot | Normalized page state: URL, accessibility-tree nodes as (role, name) pairs, visible text, recent network responses. Never raw HTML, never pixels as truth. |
| Assertion | A typed, checkable claim about a snapshot. Four deterministic kinds (URL matches, element visible, text present, network OK) and one semantic kind (judged). |
| Step | One action plus its preconditions and postconditions. |
| Skill | Ordered steps plus task-level goal checks. Versioned. Stored as JSON. |
| Verdict | The result of checking one assertion: pass or fail, the method used (deterministic or judge), and the evidence looked at. |
| Receipt | The run's hash chain. One record per step: pre-state hash, action, post-state hash, verdicts, outcome, link to previous record. |
| Correction | A human fix during handoff, saved as a diff to the skill: new action, new anchor, or new postcondition. Bumps the skill version. |
| Ledger | Append-only per-run metrics. Source for the dashboard. |

## 3. The loop

```
precheck -> act -> postcheck -> pass? -> next step ... -> goal checks -> success decided by verifier
                             \-> fail -> repair decision (bounded, typed) -> act again
                                        \-> handoff -> human fixes on shared session -> correction recorded -> resume
```

Rules that make the loop verifiable:

1. The agent never writes `success`. The verifier writes it after goal checks pass.
2. Deterministic assertions decide. The judge runs only for semantic claims, and its verdict is stored next to the evidence it saw, so the judge is auditable too.
3. Every pass through postcheck appends one sealed record to the receipt, including failures and handoffs. Nothing is skipped.
4. Repairs are bounded (default one attempt per step). Beyond the bound, the only option is handoff.
5. Precondition failures are recorded but do not block. The postcondition is the arbiter, because the demo may have been recorded on a slightly different page.

## 4. Verification levels

Ranked by how much we trust them. The dashboard shows which level each run reached.

- **L0 Deterministic.** Checks computed from the snapshot alone. Cheap, replayable, no model.
- **L1 Side-channel ground truth.** A check that does not depend on the page the agent manipulated: an API read, a confirmation email, a database row, a downloaded file hash. Added per task when available. This is the strongest answer to "the agent faked the page".
- **L2 Judged.** A model reads the evidence and returns a typed verdict with a confidence. Used for semantic goals only. Fails closed when no judge is configured.

A skill's goal checks should include at least one L0 or L1 check. L2 alone is never enough for `success`.

## 5. Receipts

- Snapshot hash: SHA-256 over (host + path, sorted normalized (role, name) pairs). Digits and timestamps are masked, query strings dropped, so volatile pages hash stably.
- Record link: SHA-256 over the record's canonical JSON plus the previous link. Genesis is a fixed zero hash.
- Verify: recompute every link from the records. Any edit to any field breaks the chain from that point on.
- Screenshots are referenced, not inlined. They are evidence for humans; the hashes are evidence for machines.
- Receipts can be published. Anyone with the receipt and the stored snapshots can confirm the run without trusting us.

## 6. Co-browsing protocol

One real browser session, driven over the Chrome DevTools Protocol. Both parties see the same page.

- A control lock says who is driving: `agent` or `human`. The worker refuses agent actions while the human holds it.
- The canvas receives a screencast and, while the human holds control, forwards mouse and keyboard events to the page.
- Handoff flips control to human and marks the receipt record `handed_off`. Nothing in the chain is rewritten.
- The human's actions during handoff are captured as a trace, exactly like a demonstration. When they hand control back, the trace becomes a correction: the step's action and postconditions are replaced, the skill version increments, and the run resumes at the next step.
- "Gets better each run" means: interventions per run go down across versions. This is the headline metric.

## 7. Learning from one demo

Only deterministic assertions are derived from the state diff:

- URL path changed → `url_matches` on the new path (IDs generalized to `\d+`).
- New accessibility nodes appeared → up to three `element_visible` assertions on the most specific ones.
- A non-GET request succeeded → optional `network_ok` on its path.
- The action's own target becomes a precondition of the step.

A model proposes step names and up to three semantic goal checks. Those are tagged `source: model` so the dashboard can show how much of a skill's verification is deterministic versus judged. Human corrections are tagged `source: human`.

Non-goal for now: generalizing a skill across sites. One site, one task, demonstrated once, run three times.

## 8. Eval

Per run: success, steps, assertions total and passed, interventions, self-repairs, judge calls, highest verification level reached, final receipt link.

Per skill, across runs in order: intervention count, assertion pass rate, success. The chart to show is interventions falling to zero while pass rate rises to one.

Two modes:

- **Live.** Against the real site. What the demo uses.
- **Replay.** Against stored snapshots from a previous run. Checks that a skill edit did not regress, in seconds, with no browser.

## 9. Tooling and where each piece earns its place

| Piece | Role | Status |
| --- | --- | --- |
| LangGraph | The harness. A fixed state machine with seven nodes. Chosen over a free-form planning agent because an auditable loop is the product. | Core |
| Stagehand v4 / Playwright CDP | Hands only: execute actions, capture snapshots, screencast, relay input. Its natural-language `act()` is a fallback when a deterministic anchor misses. | Core |
| FastAPI + Next.js | API for the canvas and dashboard; the canvas itself. | Core |
| Subq Decisions API | The hot-path repair decision. Given the failed verdicts and the page state, return probabilities over {retry, wait, re-anchor, handoff}. One fast typed call, with a deterministic policy as fallback. | Fits; wire when a key is in hand |
| Meta AI (Llama) | Step naming, semantic goal proposals, fallback judge. Off the critical path. | Fits as an option |
| Fetch.ai uAgents | Possible: publish receipts so another agent can re-verify a skill before reusing it. Only if it adds something the HTTP verify endpoint does not. | Undecided, not in the core path |

Sponsors are used where they fit the design, not bolted on.

## 10. Demo script (three runs)

1. Demonstrate the task once on the shared canvas. Show the derived skill: steps, assertions, which are deterministic.
2. Run 1: the agent hits a drifted element, repair fails, handoff. Human fixes it in the canvas. Correction recorded, skill v2.
3. Run 2: passes with zero interventions. Show the receipt, then tamper one field and show verify() fail.
4. Run 3: passes. Dashboard shows interventions 1 → 0 → 0 and pass rate rising.

## 11. Open questions

- Which task and site? Needs a stable test target with at least one L1 side channel (an API or email we can read).
- Exact Subq Decisions request body for `choice` questions. Confirm against the console with a key.
- Replay mode: store full snapshots per step or only hashes plus a screenshot reference? Full snapshots enable replay; cost is disk, not complexity.
- Should human corrections during handoff be allowed to add goal checks, or only step checks? Leaning step-only to keep the goal fixed across versions.
