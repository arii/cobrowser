# Phase 0 feasibility results

Date: November 7, 2026. **Scaffolding implemented; Phase 0 exit is still open.** No dependent full-product work was started. No subagents were used. The source plan remains authoritative, with a scoped status clarification linked below.

| Check | Result | Evidence / exact remaining prerequisite |
| --- | --- | --- |
| Swift build and selected native browser-window frames | **Passed live** | [Native events](evidence/native.json); 2004×1652 frame buffers with UTC, monotonic and PTS timestamps, dimensions, hashes. No native image files retained. |
| Stop/pause/resume and title/identity exclusion | **Passed live** | No frames during pause or after fixture title binding loss; resumed frame before exclusion. |
| Native permission revocation/denial/regrant | **Unverified, manual gate** | Permission already granted. Requires explicit System Settings revocation/regrant for the responsible app/helper; no OS privacy changes were automated. README procedure records stream stop or OS termination. |
| Native ↔ Chrome identity | **Controlled match passed; general match unresolved** | [Headed browser report](evidence/browser-headed.json) records both namespaces, title, bounds and tab ID. Native and extension IDs differ. Need robust approved-origin/context binding before real observation. |
| Extension → native host → local process | **Passed live** | Actual Chrome `connectNative`, framed Node host and user-only authenticated Unix socket. No native messaging mocks in browser probe. |
| Absent coordinator, duplicate ping, restart/reconnect | **Passed live** | Both browser reports contain acknowledgments, duplicate result, recovered sequence. Cache is in-memory ping-only; browser restart/MV3 suspension untested. |
| Assigned-tab screenshot → CDP click/type | **Passed live** | [Headless](evidence/browser-headless.json) and headed reports; 8 combinations each: DPR 1/2 × zoom 1/1.25 × active/background. Stale reuse and off-scope navigation rejected. Different macOS app foreground/minimized/locked behavior remains unmeasured. |
| Installed consumer Chrome | **Unverified, browser setup gate** | Chrome 156.0.8078.80 exists. Load unpacked extension in Developer mode and register native host; no existing user profile was changed. Automated browser was Chrome for Testing 158.0.8127.18. |
| Llama image + structured output | **Blocked live** | `LLAMA_SCHEMA`, `LLAMA_ENDPOINT`, `LLAMA_MODEL`, `LLAMA_API_KEY` missing. Must configure a vision Meta Llama deployment with supported wire format; no hosting provider silently chosen. |
| Snap Decisions | **Blocked live** | `SUBQ_API_KEY` missing. Adapter targets `subq-snap-1.1` Decisions API. [Missing-prerequisite report](evidence/models-live.json), command exit 2. |
| Provider replay/validation/outage handling | **Passed offline** | [Replay report](evidence/models-replay.json) is hand-authored synthetic; [tests](evidence/unit-tests.log) mock HTTP errors and malformed responses. These do not establish provider connectivity. |
| Real CSV download and independent oracle | **Passed live local fixture** | [Verifier report](evidence/verifier.json): 3 correct cases pass; 3 labeled wrong-week artifacts fail although all six pages claim success. Includes team, explicit timezone calendar ranges, exact CSV rows and audit/hash evidence. |
| Hostile candidate/container isolation | **Not established** | Fresh Playwright contexts and restricted page routing only. Docker missing; no candidate process/runtime yet. Separate protected supervisor and candidate execution belongs to Phase 2. |

Reproduction commands are in the root [README](../../README.md). [Manifest](evidence/manifest.json) records exact versions, reproduction commands, source hashes and evidence hashes. Run `pnpm exec tsx scripts/collect-evidence.ts` only after reproducing the listed checks and reviewing its evidence allowlist. Native pixel hashes are measurements, not replayable pixel fixtures. Browser PNGs/CSVs remain in ignored `.local/evidence/`; the checked-in JSON embeds only curated synthetic content and metadata.

Implemented paths: Swift ScreenCaptureKit executable; raw MV3 extension/popup; dependency-free native messaging host, installer and local coordinator; typed Llama/Snap adapters; synthetic replay and error tests; reporting fixture, separate date/data oracle and Playwright download probe; reproducibility scripts and pinned dependencies. The Node coordinator stands in for a future companion process. No Electron/dashboard/registry/learning service is implemented.

Evidence-backed decisions:

1. Native and extension window IDs require an explicit binding record, and native/window screenshot coordinates require a separate mapping from CDP viewport coordinates. Unique-title pairing suffices only for this synthetic spike. See [001](001-native-capture.md).
2. CLI ScreenCaptureKit capture needs AppKit/CoreGraphics initialization on this tested environment. Install the native host as self-contained modules and register inside the actual user-data profile. Keep retry/dedup semantics distinct from durable action execution. See [002](002-browser-bridge-input.md).
3. Keep a dedicated Snap Decisions parser and an explicit configured Llama provider wire format; require successful live probes before provider-dependent work. See [003](003-model-connectivity.md).
4. Make actual downloaded bytes plus a separately maintained calendar/data oracle a mandatory gate. A page success message and model judgment cannot approve a wrong artifact. See [004](004-independent-csv-verifier.md).

No broad scope change is justified by these probes. The plan's Phase 0 exit must remain open until live Llama/Snap calls and manual permission/consumer-Chrome gates are recorded. The concrete next implementation milestone is to close those gates, then Phase 1's minimal versioned contracts and shared CDP transport boundary feeding the Phase 2 isolated reporting verifier. General workflow discovery, dashboard UI, other browsers, and automatic observation remain deferred.
