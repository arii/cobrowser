# Local authenticated verifier and registry vertical slice

November 7, 2026. Partial implementation of plan phases 2, 4 and 5; full MVP acceptance remains open. [Decision 011](011-extension-approval-gate.md) subsequently connects the extension to the gate for the synthetic reporting contract.

Run:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:promotion
```

The promotion demo launches isolated browser contexts against public synthetic reporting fixtures. It runs declarative candidates through `executeProcedure`; `SkillRegistry.execute` uses that same interpreter and revalidates the active approval/context before each step. The fixture transport resolves semantic controls and uses browser mouse/keyboard input; it never substitutes direct export requests or DOM click injection. The supervisor reads completed download bytes and independently checks expected rows and the fixture's server-side export audit. Duplicate exports fail even if downloaded bytes are correct.

The suite is frozen before candidates run. Normal cases use ten explicit seeds as repeated fixed runs, not ten distinct randomized scenarios. v1 passes verification and then ten approved executions. Deliberate wrong-week fixture output and wrong-team candidate input each block their candidate and preserve v1. Corrected v3 passes verification and promotion. A separately injected post-promotion wrong-week regression quarantines v3 and restores v1. Negative candidates can stop after one demonstrated failure; the remaining cases are recorded as missing, and a known failure still blocks approval. Missing evidence without a known failure is inconclusive.

Evidence is written to `.local/evidence/promotion.json`: signed reports, browser/environment and runtime source hashes, evidence hashes and ordered promotion/rollback audit. The demo's database and HMAC key are temporary and removed afterward; persisted restart behavior is covered separately by registry tests. The evidence file does not contain a signing key and is not a portable proof of signature authenticity. Normal use supplies a supervisor-owned stable authority key; no key is added to extension storage, page code or source control.

## Implemented boundaries

- HMAC-SHA256 authenticates the report body and key identifier with a versioned domain prefix. Canonical hashes bind candidate, contract, suite, environment and runtime.
- Approval requires all contract/suite assertions, nonempty evidence hashes, unique assertion IDs and no failed/missing results. The reporting supervisor cannot invent missing semantic judgments; required semantic criteria yield inconclusive reports.
- SQLite migration 2 persists reports, active pointers, quarantine and ordered audit. Approval, revision state, active pointer and audit commit in one transaction. Revision and active-pointer generations reject races; report IDs reject replay.
- Every promotion currently requires explicit review. Automatic maintenance is not enabled.
- Quarantine requires a supervisor-authenticated blocked report containing a failed assertion for the exact active revision/context. Fallback must have a compatible authenticated approval, unchanged contract/runtime/environment/suite, available evidence and no expanded capabilities. Otherwise execution is disabled.
- The shared interpreter bounds procedure actions and elapsed time, checks origins and declared capabilities, stops on cancellation or revoked approval, and detaches the transport on every exit. The adapter owns the assigned tab and must cancel outstanding browser operations on detach. Action budgets count procedure actions, not every low-level mouse/key event.
- Evidence expiry/deletion makes active approval unavailable for execution.

## Remaining limits

The verifier and candidate are in one trusted local process in this demo. Fresh browser contexts and fixture-only request routing do not constitute a hostile-candidate sandbox. There is no Docker runner, protected held-out configuration, model scenario generation, or independent Snap semantic evaluation. There are no live Llama/Snap requests; candidate provenance is explicitly replay/hand-authored. The fixture task and all mutations are public.

Decision 011 subsequently adds native-host approval and per-input authorization to the installed extension for synthetic reporting. General workflow verification and sharing the exact physical-action adapter with installed Chrome remain required. The local interpreter's adapter contract also does not replace installed-browser document identity and coordinate validation.

The complete mutation matrix (layout, slow-loading, session expiry, injection, permission/lifecycle failures), manual desktop session, packaging, resource/cost measurements and provider acceptance remain open. This decision does not claim full compliance with `plan.md`.
