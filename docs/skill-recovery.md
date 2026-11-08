# Skill input recovery and recording provenance

Input planning is read-only. Network timeouts, response-read failures, native-host outages, HTTP 408/429 and HTTP 5xx responses receive at most three attempts, with 500 ms and 1,000 ms backoffs. The Skills view and recording monitor show retry status. Authentication, configuration and invalid-response failures pause immediately. Native-host error envelopes preserve safe HTTP status codes so retryable errors remain distinguishable.

Exhausted provider errors pause with a provider-specific message, not a request to fix the page. Supply an **Exact field value** in the page prompt or **Use exact value** in Skills. Exact values bypass the model, preserve whitespace, and allow empty text to clear a field. Selects require an available visible option label; the actual control is checked again before dispatch. Genuine model questions also offer exact-value entry, or a separate clarification mode which calls the model again. Provider outages reject clarification mode to prevent the original loop.

Input values are cached for the current step across pre-dispatch page corrections. Already completed steps are not replayed. After any partial dispatch, recovery checks the resulting field or outcome instead of automatically dispatching the action again. Prompt tokens reject stale/duplicate answers. Cancellation stops retries; worker restart marks a run interrupted rather than replaying it. Exact answers and instructions are session-only and removed from final run state.

## Independent input planning

A run starts from one goal instruction. The input planner derives field values from that goal, source pages, visible options, the current date/timezone, and previously completed field choices (including explicit overrides). It generates requested text, performs calculations, and chooses conservative defaults for routine preferences, explaining assumptions in the input-source feed. Missing source facts, credentials, and consequential choices without a supported default still require help.

Before returning a clarification, the planner makes one additional read-only model call to reconsider whether it can resolve the field independently. Both results receive the same source and option validation. Page preparation and result checks also get two automatic rechecks before prompting; these checks do not repeat dispatched browser actions. Previous field values remain session-only and are removed with the instruction and answers when the run ends.

## Investigation: “CDP typing probe”

The current fixture puts `#probe` **outside** the Export CSV form. Its export form contains Team, Start inclusive and End exclusive. Therefore current `form.elements` capture cannot by itself add this particular probe to the export dependencies.

An existing local synthetic artifact, `.local/evidence/recording-export.json`, contained probe click/change actions labeled `human`, without form targets. The pre-fix `scripts/recording.ts` deliberately generated those interactions through Playwright. Trusted browser/CDP events satisfy `event.isTrusted`; that flag alone does not establish human provenance. The previous recorder also ignored only the most recent debugger dispatch for 750 ms and did not exclude the assigned debugger tab throughout its lifetime. Learning could therefore include the probe as an ordinary action preceding an export. This establishes a reproducible code path, **not** the provenance of the reported user's saved skill; that would require that skill's original cited action history.

Prevention now has several layers:

- Assigned debugger tabs and skill/playback-owned tabs are excluded from recording, including delayed effects. Ownership remains until the tab closes, including after detach or run completion.
- Explicit `data-cobrowser-probe` / `data-cobrowser-agent` controls and the exact legacy `CDP typing probe` descriptor are excluded from capture. Synthetic DOM events remain excluded.
- The recorder version is bumped so existing tabs replace older capture code. Native form dependencies include only named, visible, enabled, supported editable fields. Probe descriptors are also filtered when older recorded form targets are normalized.
- Learning rejects agent/probe provenance and breaks episodes at those boundaries, preventing actions on opposite sides of automation from being joined.
- Saved skills containing the known probe descriptor are blocked from activation. **Remove probe steps and review** removes those steps. **Repair saved steps** also lets users remove another unrelated step explicitly. Repair retains removed-step metadata, validates supported actions and the observed outcome, and makes the result inactive for review. Stop an active run before editing its saved skill.

The recorder verification now uses a report field rather than the developer probe for ordinary recording assertions. The persistent `--demo` profile no longer receives automatic setup clicks or fills; only the disposable verification profile receives deliberate synthetic demonstrations. Browser tests use disposable profiles and synthetic evidence, so their intentional demonstrations cannot reach the user's library. Unknown external automation on unassigned, unmarked tabs cannot be identified reliably from `isTrusted` alone; integrations must mark or assign their automated targets.

First-attempt creation remains proactive: one supported sequence with an observable outcome creates an inactive skill without waiting for model approval. Repair and provenance checks do not restore a model-confidence gate.

## Verification

`pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm verify:skill-recovery`, `pnpm verify:skills`, `pnpm verify:report-skill`, `pnpm probe:popup`, and `pnpm verify:recording` cover recovery, replay, provenance and the existing monitor. The recovery browser check uses deterministic provider substitutes while exercising real extension messaging, page prompts, CDP input and DOM recording. It does not test live provider availability.

## Ordinary execution result checks

For the local synthetic fixture (loopback origin and exact fixture title), Export CSV runs with explicit Team, Start inclusive and End exclusive overrides intercept the export response through CDP Fetch. The verifier compares all CSV response bytes with the expected synthetic dataset, then fulfills the download with those same bytes. It does not issue a second export. A wrong-week response records a failed verification while preserving completed actions. Missing explicit overrides and other websites record an unverified result. `finished` describes action completion; `run.verification` separately describes the result check. This checks the response delivered to the browser, not persistence of a file on disk. Playwright additionally reads the downloaded file in the isolated browser regression.

Malformed decisions are classified as `invalid-output` before dispatch, independently of page problems and genuine missing-information questions. Exact-value recovery remains available without calling the provider.
