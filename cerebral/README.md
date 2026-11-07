# Cerebral

A browser agent that learns a web skill from one human demonstration, replays it alone, and **proves** every run instead of claiming success.

Read [DESIGN.md](DESIGN.md) first. Short version:

- A **skill** is a typed program: ordered steps, each with a precondition and a postcondition, plus task-level goal checks.
- A **run** produces a **receipt**: a hash chain of step records (normalized page-state hash before, action, hash after, verdicts). Anyone can recompute it.
- Deterministic assertions decide. A judge is a fallback for semantic claims only, and its verdict is stored next to the evidence it saw.
- A failed postcondition is the **co-browsing handoff**: the agent stops, the human fixes the step on the shared live session, and the fix is saved as a diff to the skill.
- The **eval ledger** tracks every run. Human interventions trending to zero across skill versions is the headline chart.

## Status

Scaffold. The Python core is tested. Demonstration capture through the Chrome extension runs end to end against a fixture site (extension → API → derived skill) under Playwright; the worker's replay and the web canvas have not been run against a real site yet. No task or target site is chosen (see the open questions in DESIGN.md).

## Layout

```
apps/api         Python: FastAPI + LangGraph run loop, verifier, receipts, ledger, adapters (Subq, Meta), optional uAgents
apps/browser     TypeScript: Playwright worker (Stagehand v4 optional). Normalized a11y snapshots, actions, screencast, input relay, demonstration recorder
apps/extension   TypeScript: Chrome extension (MV3). One toolbar button: press to demonstrate in your own browser, press again to teach the agent
apps/web         TypeScript: Next.js co-browse canvas, receipt view, eval dashboard
packages/page-capture  Source shared by the worker and the extension: the page-side a11y tree + event capture, and the trace coalescer
skills/        Stored skills (JSON, one per skill)
runs/          Run records + ledger.jsonl
runs/demos/    Recorded demonstration traces (JSON, one per demo), written as each event arrives; GET /demos lists them
DESIGN.md      The idea, solidified
```

## Run it

Prereqs: `uv`, Node 22, pnpm (`corepack enable`).

```bash
cp .env.example .env
```

API:

```bash
cd apps/api && uv sync && uv run uvicorn cerebral.api:app --reload --port 8000
```

Browser worker (Playwright drives the page; Stagehand attaches for the natural-language fallback when a model key is set):

```bash
cd apps/browser && pnpm install && pnpm exec playwright install chromium && pnpm dev
```

Web canvas:

```bash
cd apps/web && pnpm install && pnpm dev
```

Chrome extension (demonstrations in your own browser):

```bash
cd apps/extension && pnpm install && pnpm build
```

Then `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/dist`. Pin the Cerebral button. The API URL defaults to `http://localhost:8000` (change it in the extension's options).

Tests:

```bash
cd apps/api && uv run pytest
```

## Flow

1. **Demonstrate.** Open the site in your own Chrome and press the Cerebral button. The extension calls `POST /demos/start` with the tab's URL as the site, injects the page-capture script into that tab (and again on every navigation), and records: the script listens to click, input, change and keydown on the real DOM, resolves each to an accessibility anchor (`role=button name=Add to cart`), and reports it to the extension's service worker, which coalesces keystrokes into one `type` per field, waits for the tab to finish loading and the network to go quiet, snapshots the page (tree, text, URL, webRequest log), and emits a `(before, action, after)` trace event to `POST /demos/{id}/events`. Press the button again: a page lists the steps, you name the skill and state the goal in one sentence, and `POST /demos/{id}/finish {name, goal}` derives assertions and writes `skills/<id>.json`. Nothing is inferred from pixels; password fields are recorded with the value redacted. The worker keeps the same recorder (`POST /record/start`) for corrections during a run, and the `/demo` canvas page still works as a fallback.

   Demonstration and replay compute snapshots with the same code (`packages/page-capture/src/page.ts`): the worker injects it with Playwright instead of using Playwright's own ARIA snapshot, so a `(role, name)` tree captured in your Chrome hashes identically to one the worker captures at replay.
2. **Run.** `POST /skills/{id}/run`. LangGraph loop: precheck, act, postcheck, then advance on pass or bounded repair on fail, then handoff. Every step appends a sealed record to the receipt.
3. **Correct.** On handoff the canvas unlocks and the worker starts recording (handing control to the human always does). The human fixes the step, then `POST /runs/{run_id}/correction` with the recorded `trace` merges the fix into the skill: the last recorded action becomes the step's action and postconditions are derived from the state change, unless given explicitly. Version bump, history entry, run resumes.
4. **Verify.** `GET /runs/{run_id}/receipt` returns the chain; `POST /receipts/verify` recomputes it. `GET /ledger` powers the dashboard.

## Known limitations

- **Recorder settle window.** Both recorders (worker and extension) snapshot the after-state about 250 ms plus a network-idle wait after an action. Two actions inside that window record the first action's after-state on the second's page. Humans do not act that fast; scripted demos must pace themselves.
- **Receipts are tamper-evident, not signed.** `verify()` recomputes the step chain and the receipt seal, so any edit to a persisted receipt is detectable, but anyone holding the bytes could regenerate a whole receipt. Exchanging receipts between parties needs a signing key.
- **Subq latency is unmeasured.** The Decisions API is on the repair/handoff hot path with a deterministic fallback, but Subq publishes no latency figures; measure before calling it realtime.
- **Semantic assertions depend on a judge.** Without a Subq or Meta key every `semantic` assertion fails closed, so goal checks proposed by the model will fail until a key is set.
- **Review history.** `docs/review-2026-11-07.md` lists the 34 defects found by the adversarial review of the scaffold and how each was closed.

## Tools

| Tool | Role | Where |
| --- | --- | --- |
| LangGraph | The harness: a fixed seven-node state machine, gated by the verifier | `apps/api/cerebral/graph.py` |
| Playwright (Stagehand v4 optional) | Hands: actions, snapshots, screencast, input relay; Stagehand's natural-language `act()` only as a fallback when a model key is set | `apps/browser/src/session.ts` |
| page-capture | Eyes on the demonstration: one page-side script computes the a11y tree and captures DOM-level actions; one coalescer turns them into typed trace events. Shared by the extension and the worker | `packages/page-capture/src/` |
| Chrome extension | The demonstration surface: a toolbar toggle in the user's own browser, with their sessions and native input. Service worker hosts the coalescer; content script is the sensor | `apps/extension/src/` |
| Subq Decisions API | Hot-path typed decisions: semantic judge (probability) and repair-or-handoff choice. Deterministic fallback when no key | `apps/api/cerebral/adapters/subq.py` |
| Meta AI (Llama) | Step naming, goal-check proposals, fallback judge. Off the critical path | `apps/api/cerebral/adapters/meta.py` |
| Fetch.ai uAgents | Optional extra (`uv sync --extra agents`): peers re-verify published receipts. Not on the run path; undecided | `apps/api/cerebral/uagent.py` |
