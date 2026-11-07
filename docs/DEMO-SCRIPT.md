# Demo Script — Trust, But Verify (1-minute video)

**Format:** 60-second video, voiceover + kinetic scoreboard visuals.
Remotion source: `remotion-video/src/`. Render: `npx remotion render TrustButVerify`
from `remotion-video/`.
**Thesis (first and last line):** we didn't build the AI that does the task —
we built the independent verifier that decides whether its work is safe to
accept. **We are not the system that gets better. We say no — with evidence.**

**Sponsor rule:** every sponsor claim below is backed by a live run in this repo.
Fetch.ai ASI:One via `scripts/benchmark-agentverse.ts`
(`tests/fixtures/agentverse-live-20261107.json`); SubQ Snap via
`packages/model-adapters/index.ts` live probe
(`tests/fixtures/subq-snap-live-20261107.json`).

---

| Time | Voiceover (~140 words total) | Visual |
|---|---|---|
| 0–8s | "AI writes faster than any team can check. So we stopped grading the AI — and built the thing that grades it instead." | Title card: **TRUST, BUT VERIFY**. Subtitle: *an independent verifier for AI browser agents*. |
| 8–20s | "Exhibit A, from Fetch.ai's Agentverse. Asked for upcoming San Francisco hackathons, the agent answered with 2025 dates — seven months stale — and nothing flagged it." | Chat bubble with the 3 stale dates (2025-03-14, 2025-06-21, 2025-09-05), each stamped **STALE**. Caption: *observed Agentverse output, 2026-11-07*. **Sponsor tag: Fetch.ai Agentverse.** |
| 20–35s | "So we benchmarked Fetch.ai's ASI:One live — seven tasks, just now. On anything needing live truth — hackathons, prices — it declined or guessed stale. Text drafts passed. Our verifier graded every answer in one run." | Live scoreboard animating in row by row: 7 tasks with ✅ / ❌ / ⚠️ + latency. Footer: *api.asi1.ai · asi1-mini · live*. **Sponsor tag: Fetch.ai ASI:One.** |
| 35–48s | "Then the hard gate. SubQ Snap independently judged our screenshots — match, ninety-nine percent. And on real browser downloads, the oracle read the actual bytes: three correct CSVs passed, three wrong-week fakes blocked — even though every page claimed success." | Split screen: **SubQ Snap card** (noul 0.998, match 0.99, 478 ms, PROBE-PASSED) + **bytes gate** (3 PASS / 3 BLOCKED, toast "Export successful" crossed out). **Sponsor tag: SubQ Snap.** |
| 48–60s | "Fetch.ai does the work fast. SubQ judges what it sees. Our verifier makes it safe to accept. Trust — but verify." | Sponsor strip: **Fetch.ai · SubQ** + pipeline diagram Trust → Verify → Block/Pass. End card: *Trust, but verify.* |

---

## Line-by-line evidence (for judges / description box)

- Stale dates: `tests/fixtures/agentverse-baseline.json` (`tavily` output),
  graded offline by `tests/agentverse-eval.test.ts` → FAIL.
- Live 7-task run: `npx tsx scripts/benchmark-agentverse.ts` with `ASI1_API_KEY`
  → `.local/evidence/agentverse-live.json`; frozen verdicts in
  `tests/fixtures/agentverse-live-20261107.json`, asserted by
  `tests/sponsor-live.test.ts`: hackathons + shoes refused, grocery stale,
  weather °F+ jacket pass, 3 text tasks answered.
- Live Snap: `HARNESS_CLOUD_ENABLED=1 pnpm probe:models --live` →
  `subq-snap-1.1` probe-passed (noul 0.998, match @ 0.99, 478 ms).
- Bytes gate: `pnpm verify:fixtures` → 3 passed / 3 `wrong-week-demo` blocked.

## Narrator notes

- Pronounce "ASI:One" as "A-S-I One".
- Never say the verifier "fixes", "heals", or "improves" the agent. It blocks.
- If a number changes on re-run (latency), re-render the scoreboard scene only.
