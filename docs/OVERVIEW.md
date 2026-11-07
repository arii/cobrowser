# Cobrowser — Trust, But Verify: System Overview

**Hackathon track:** Trust but Verify — *"AI writes code faster than teams can check
whether it's safe to merge. Build an independent verifier that evaluates
AI-generated changes, catches defects, and blocks or rolls back anything below
the required standard."*

**Our position in one sentence:** we built the **verifier**, not the implementer —
an independent gate that grades AI-generated browser behavior against its own
tests and blocks anything below standard. **We are not building the system that
gets better** (no learner, no self-improvement loop, no auto-repair); we are
building the system that **says no with evidence**.

Start here: [plan.md](../plan.md) (authoritative), [evals/trust-but-verify.md](../evals/trust-but-verify.md)
(judge rubric), [DEMO-SCRIPT.md](./DEMO-SCRIPT.md) (5-minute demo).

## 1. What the verifier verifies

The "AI-generated change" in this product is a **versioned browser skill**:
a declarative procedure that drives a real browser tab (click, type, scroll,
export) to complete a task such as *"download last week's CSV for team red"*.

Two implementers feed the verifier:

| Implementer ("trust") | What it produces | Example failure we catch |
|---|---|---|
| Agentverse / ASI:One agents (`@tavily-search`, weather agent) | Text answers, drafts, lists | Stale 2025 "upcoming" hackathons returned on 2026-11-07 |
| Candidate browser skill (fixture driver today, learned skill in Phase 4) | Real CSV downloads + browser effects | Wrong-week CSV behind an "Export successful" toast |

The verifier treats **both as untrusted input** and grades them against ground
truth it derives itself: live DOM/bytes, explicit task calendars, and a
separately authored dataset.

## 2. How the verifier stays independent, reproducible, hard to game

These are the three questions the track asks. Each maps to a concrete mechanism
already in the repo — not a roadmap promise.

**Own tests, no shared blind spots** (`services/verifier/oracle.ts`)

- `previousWeek(task)` derives the expected Monday→Monday range from the task's
  explicit `asOf` + IANA timezone — never from the page, toast, filename, CSV,
  or machine timezone. It correctly splits the LA-Sunday vs Tokyo-Monday
  boundary (`tests/oracle.test.ts`).
- `inspectCSV(bytes, task)` compares **actual downloaded bytes** against an
  independently authored literal facts table. It imports neither the fixture's
  export code nor its dataset generator. Different code, different data, same
  contract — so a bug copied in one place fails in the other.
- Page claims zero weight: all six fixture pages display `Export successful`;
  three wrong artifacts still fail. Bytes override toast, always
  ([decision 004](./decisions/004-independent-csv-verifier.md)).

**Independent process** (`scripts/verify-fixtures.ts`, `scripts/benchmark-agentverse.ts`)

- Fresh Playwright browser context per case; page traffic routed to the fixture
  origin only; isolated downloads per run.
- Mutation (`wrong-week-demo`) is supervisor construction-time config — there is
  no page-accessible reset/admin endpoint the candidate could touch.
- A trusted server-side audit log records the actual export parameters the
  server saw, independent of what the page claims.
- The benchmark runner writes only to gitignored `.local/evidence/`; promotion
  to curated `docs/decisions/evidence/` is an explicit human copy step.

**Reproducible** (`scripts/collect-evidence.ts`, `docs/decisions/evidence/`)

- Pinned toolchain (Node 24.13.0, pnpm 11.25.0, Playwright 1.65.0, Chrome for
  Testing 158.0.8127.18), exact-pinned lockfile.
- Offline deterministic tests need no keys, browser, or network:
  `tests/oracle.test.ts`, `tests/agentverse-eval.test.ts`.
- Evidence manifest (`manifest.json`) records SHA-256 of every curated artifact
  plus hashes of all source files, so a judge can confirm what code produced
  what verdict.

**Hard to game**

- Expected answers live outside candidate reach (no shared imports, no fixture
  internals in the oracle, no verifier secrets in page JS).
- The suite declares per-case whether success or *controlled stop* is required,
  so a candidate cannot pass by refusing every task.
- Report binding is hash-based: candidate hash + contract hash + suite hash must
  match the submitted revision (contract schema frozen at v1; registry gate
  itself is still a scaffold — see §5).

## 3. What we have (working today)

**Verification core — the demo.**

- `services/verifier/oracle.ts` — `previousWeek` + `inspectCSV` deterministic oracle.
- `scripts/verify-fixtures.ts` — 3 tasks × {correct, wrong-week} live local
  fixture runs, real downloads, real bytes compared. `pnpm verify:fixtures`.
- `tests/agentverse-eval.test.ts` + `tests/fixtures/agentverse-baseline.json` —
  offline grading of observed Agentverse outputs: stale-2025 Tavily list FAILS,
  2-turn SF weather transcript (64.6°F + jacket advice) PASSES.
- `scripts/benchmark-agentverse.ts` — live 7-prompt ASI:One benchmark
  (hackathons, weather, shoes, LinkedIn, Discord, grocery, job post) with inline
  temporal-freshness and Fahrenheit checks. Needs `ASI1_API_KEY`; offline tests
  cover the same failure modes without keys.
- `evals/trust-but-verify.md` — the scoring rubric: freshness, schema/constraint
  adherence, verification proof, latency/turns, interactive reach.

**Browser observation + execution harness — the evidence source.**

- `apps/extension/` (WXT MV3) — recording (clicks, committed field changes,
  throttled scroll/pointer, safe control keys; never typed values or printable
  keystrokes), all-HTTP/HTTPS-tab summaries, masked screenshots, live monitor,
  agent playback (direct-literal + filtered-decided modes with human-input pause).
- `apps/fixture-site/server.ts` — seeded reporting UI with CSV export, labeled
  wrong-week mutation, server audit log.
- `native/macos-capture/` — Swift ScreenCaptureKit browser-window probe
  (metadata + hashes, no retained images).
- `packages/context-brain/` + `packages/model-adapters/` — Snap + Gemini Flash
  rolling context with bounded evidence, two-candidate task-switch rule,
  synthetic-vs-live labeling.

**Foundation.**

- `packages/contracts/` — frozen schema v1 (observations → reports → runs),
  UUID IDs, SHA-256 content binding, lifecycle transition guards.
- `packages/storage/` + `apps/companion/` (Electron) — SQLite + artifact store,
  encrypted (Keychain opt-in) and unencrypted local-dev modes, retention/deletion.
- `services/learner/`, `services/registry/`, `services/verifier/index.ts` —
  one-shot worker scaffolds that report their disabled state honestly
  (`learningEnabled:false`, `promotionEnabled:false`).

## 4. What we are NOT (explicit non-goals)

- **Not the system that gets better.** There is no learning loop, no
  self-improvement, no auto-repair, no "version 3 fixes itself." The learner
  worker is a scaffold. If a candidate fails, the verifier blocks it and the
  previous approved version stays active — that is the entire policy.
- **Not a general PR/code verifier.** The verified artifact is browser-task
  behavior + downloaded bytes, per plan §1. Do not present it as source-code review.
- **Not a hosted security sandbox.** Isolation today is fresh browser contexts +
  routed traffic, not Docker or an OS boundary. Same-user disk tampering,
  hidden-eval resistance, and adversarial candidates are Phase 2 work.
- `test.py` is a Selenium record/replay scaffold, **not** a benchmark runner and
  not a uAgent. The Agentverse bridge is `scripts/benchmark-agentverse.ts`.

## 5. Honest status / open gates

| Area | State |
|---|---|
| CSV oracle + fixture matrix (3×2) | Passing live, locally |
| Agentverse offline evals (Tavily FAIL / weather PASS) | Passing, no keys needed |
| Live 7-task ASI:One benchmark | Done 2026-11-07: 2 refused, 1 stale, 1 pass, 3 text-only (see `tests/sponsor-live.test.ts`) |
| Recording / playback / all-tabs / visual context / brain | Working in extension + runners |
| Registry promotion gate, learner, rollback automation | Scaffolds / policy only — narrate, don't claim |
| Live Llama + Snap provider calls | Snap LIVE and passing (2026-11-07, 478 ms); Llama still blocked on credentials, replay only |
| Docker isolation, hidden evals, signed packaging | Deferred to Phase 2 |

Phase 0 exit stays open until live provider + manual permission/consumer-Chrome
gates are recorded ([decision 000](./decisions/000-phase0-results.md)).

## 6. Repo map (where to look)

```text
services/verifier/oracle.ts      deterministic oracle (the verifier's brain)
scripts/verify-fixtures.ts       6-run fixture gate (the verifier's hands)
scripts/benchmark-agentverse.ts  live Agentverse benchmark (the "trust" side, measured)
tests/agentverse-eval.test.ts    offline Agentverse grading (no keys)
tests/oracle.test.ts             timezone-boundary + empty-CSV gate
evals/trust-but-verify.md        judge rubric + reproduce commands
apps/fixture-site/server.ts      reporting UI + wrong-week mutation + audit log
apps/extension/                  recorder, monitor, playback, visual context
packages/context-brain/          rolling intent + next-action guesses (advisory only)
packages/contracts/              frozen schema v1 + lifecycle guards
docs/decisions/                  ADRs 000–009 + curated evidence/
docs/DEMO-SCRIPT.md              5-minute judge demo, line by line
```

## 7. Reproduce in 3 commands

```sh
pnpm install --frozen-lockfile
pnpm test                                    # offline suite incl. oracle + agentverse evals
pnpm verify:fixtures                         # live local fixture: 3 pass, 3 blocked
```

With a key: `export ASI1_API_KEY=...` then
`npx tsx scripts/benchmark-agentverse.ts` for the live 7-task comparison.
