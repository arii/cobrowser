# Trust, But Verify — Judge-Ready Eval Rubric

Head-to-head: Agentverse agents (trust) vs cobrowser + independent oracle (verify).
Ground truth is live DOM/bytes checked by `previousWeek` / `inspectCSV` in
[services/verifier/oracle.ts](../services/verifier/oracle.ts); contracts in
[packages/contracts/src/schemas.ts](../packages/contracts/src/schemas.ts).

## Benchmark tasks (hackathon set)

| # | Task | Agentverse side | cobrowser side |
|---|------|-----------------|----------------|
| 1 | Upcoming SF hackathons | @tavily-search via ASI:One / Chat Protocol | live Luma/Cerebral Valley DOM scrape |
| 2 | SF weather + jacket advice | @agent1qfvyd... weather agent | recorded skill replay or live widget scrape |
| 3 | Cheapest in-stock Asics (size filter) | shopping/search agent | context-brain + visual-context grid filter, CSV export |
| 4 | LinkedIn recruiter reply draft | ASI:One draft (live benchmark) | live authenticated LinkedIn tab via bridge |
| 5 | Discord messages → action items | ASI:One summary (live benchmark) | live authenticated Discord tab via bridge |
| 6 | Grocery list, 4 dinners under $60 | ASI:One list (live benchmark) | live store DOM scrape + price check |
| 7 | Job post requirements + tailored bullets | ASI:One draft (live benchmark) | live job page scrape + skill match |

Tasks 1–3 have observed Agentverse baselines; tasks 4–7 are captured live by
`scripts/benchmark-agentverse.ts` and promoted to fixtures after the first
keyed run (see Next steps).

## Metrics & pass/fail thresholds

| Metric | How scored (oracle) | PASS | FAIL |
|--------|---------------------|------|------|
| Temporal freshness | % event/date items with date >= task `asOf` day (`previousWeek` range) | 100% | any stale item (e.g. 2025 dates on 2026-11-07) |
| Constraint/schema adherence | header `team,date,value`, exact ordered rows/team/date/value (`inspectCSV` → `assertions.schema`, `assertions.exactRows`); °F + recommendation present (task 2); `Timezone`/`TaskContract` valid | `verdict: passed`, all required assertions pass | any required assertion `failed`/`missing` |
| Verification proof | DOM snapshot/selector state + screenshot + sha256 bytes present | proof attached, bytes hash recorded | text-only claim, no bytes/screenshot |
| Latency/turns | wall-clock + round trips, logged per run | task 2 in 1 turn; task 3 <= baseline replay | multi-turn repair to reach same answer |
| Interactive reach | completes behind stateful UI (size select, price sort, auth tab) | completes with DOM proof | falls back to public snippets / fails |

Deterministic gate (per [004](../docs/decisions/004-independent-csv-verifier.md)): actual
bytes override any success toast. `inspectCSV` verdict `failed` = task FAIL, no override.

## Reproduce (exact commands)

```sh
# 1. Baseline verify: unit + oracle + deterministic fixture gate
pnpm test                                   # includes tests/oracle.test.ts
pnpm verify:fixtures                        # scripts/verify-fixtures.ts: 3 tasks x {correct, wrong-week}

# 2. Benchmark runner (Agentverse side, live; export key in shell first —
#    scripts never autoload .env)
export ASI1_API_KEY=...
npx tsx scripts/benchmark-agentverse.ts     # writes .local/evidence/agentverse-live.json
# NOTE: test.py is a Selenium recorder scaffold, NOT a benchmark runner.

# 3. Offline eval tests (deterministic, no network/model keys)
pnpm exec tsx --test tests/oracle.test.ts           # LA-Sunday vs Tokyo-Monday boundary + empty-CSV fail
pnpm exec tsx --test tests/agentverse-eval.test.ts  # Agentverse baseline: stale-2025 Tavily fails, SF weather passes
```

## Where artifacts land

- `.local/evidence/` — raw run outputs: `{team}-{tz}-{correct|wrong-week}.csv/.png`,
  `verifier.json` (written by `scripts/verify-fixtures.ts`). Git-ignored working area.
- `.local/evidence/agentverse-live.json` — live-only gitignored benchmark output.
  NOT in the `collect-evidence.ts` allowlist: copy it manually into
  `docs/decisions/evidence/` for the judge packet if needed.
- `docs/decisions/evidence/` — curated judge artifacts: allowlisted copies +
  `manifest.json` (sha256 `evidenceHashes`) via `npx tsx scripts/collect-evidence.ts`,
  which runs no probes itself. Commit this for the demo.
- Expected oracle ranges for the 3 fixture tasks: starts Oct 26 / Oct 19 / Oct 26
  (see 004); DST-crossing week need not equal 168 UTC hours.

## Known check divergences (intentional)

- Freshness format: the live benchmark scans free text for month-name/year mentions
  (`year < asOfYear` = stale); the offline test compares ISO `YYYY-MM-DD` dates
  lexically against `cutoffDate`. Both catch the observed 2025-stale failure.
- Fahrenheit strictness: the live check is lenient (degree-F, `F`, `degrees F`);
  the offline gate is strict (digit + `°F` only, e.g. `64.6°F`). Live is advisory
  (raw output saved for judges); offline is the deterministic gate.

## Next steps

1. ~~Keyed live run~~ DONE 2026-11-07: 7/7 results with latency in
   `.local/evidence/agentverse-live.json` (asi1-mini). Verdicts: hackathons +
   shoes refused (no live data), grocery stale (2025 prices), weather °F+jacket
   pass, 3 text tasks answered. NOTE: `.env` quotes `SUBQ_API_KEY`, so export
   with `tr -d '"'` when sourcing single keys; `ASI1_API_KEY` is unquoted.
2. ~~Promote live outputs~~ DONE 2026-11-07:
   `tests/fixtures/agentverse-live-20261107.json` +
   `tests/fixtures/subq-snap-live-20261107.json`, asserted by
   `tests/sponsor-live.test.ts`. Live Snap probe also passes
   (`subq-snap-1.1`, noul 0.998, 478 ms) after a one-line fix: score-question
   `criteria` must be an array per the Decisions API contract.
3. LinkedIn/Discord (tasks 4–5) need authenticated sessions: exercise the
   interactive-reach column via `scripts/verify-all-tabs.ts` /
   `scripts/probe-browser.ts` with the bridge on a logged-in profile.
4. Judge packet: hand-copy the live JSON into `docs/decisions/evidence/`
   (allowlist gap, see above) and re-run `collect-evidence.ts` on macOS.
