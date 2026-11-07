# Visual Harness MVP implementation plan

Updated: November 7, 2026

Status: User-authorized local-development exception (November 7): default companion storage is unencrypted and Keychain-free in a separate directory; encrypted mode remains opt-in. See [decision 009](docs/decisions/009-unencrypted-local-storage.md). Phase 1 local foundation implemented; see [contracts/storage results](docs/decisions/006-phase1-foundation.md). Phase 0 live-model and manual browser/permission gates remain open; see [feasibility results](docs/decisions/000-phase0-results.md). The full application is not built. Interfaces, commands, and milestones below remain proposed unless recorded evidence explicitly establishes them.

## 1. Product objective

Build a companion for existing browsers that continuously observes permitted browsing activity, learns recurring tasks, proposes and maintains reusable skills, and executes an activated skill in a dedicated agent tab. Every generated skill revision must pass an independent verifier before becoming active.

The central demonstration must answer this theme:

> Build an independent verifier that evaluates AI-generated changes, catches defects, and blocks or rolls back anything below the required standard. How can a verifier write its own tests without sharing the implementer's blind spots, and stay independent, reproducible and hard to game?

The AI-generated change in this product is a versioned browser skill. The verifier evaluates its behavior and resulting artifacts. Do not present this MVP as a general source-code or pull-request verifier.

### Required product decisions

- Use the user's existing browser. Do not build a replacement browser.
- Use a small installed desktop companion plus a browser extension.
- Support continuous passive observation after explicit enablement and applicable permissions; the user should not need to start a recording for every task.
- Use Meta Llama models for workflow learning, skill generation, and action planning.
- Use SubQ Snap for structured independent judgments over selected evidence.
- Distinguish observation, automatic skill maintenance, and task execution. Observation does not authorize autonomous execution.
- Keep capture and initial processing local. Cloud model calls use filtered evidence and require an enabled cloud-processing setting.
- Target macOS and Chrome first. Preserve adapter boundaries for Firefox, Safari, other Chromium browsers, and Windows.

### MVP exclusions

- General discovery and execution of arbitrary workflows across the web.
- Firefox, Safari, Windows, Linux, or mobile feature parity.
- Model training or fine-tuning.
- Purchases, payments, sending messages, deleting external data, or other irreversible actions.
- A browser engine embedded inside a sidebar or iframe.
- A guarantee of identical model behavior, uninterrupted capture, or perfect sensitive-data detection.

## 2. Reference workflow and demo

Use a controlled reporting website with a dashboard, team selector, date controls, export button, session expiry, and downloadable CSVs. Observe and execute it through the installed Chrome extension. Test it in isolated fixture instances as well.

Task: download the previous calendar week's CSV for a specified team.

Define previous week as Monday 00:00 through the next Monday 00:00, with the end exclusive, in the task's explicit IANA timezone. Store normalized dates and timezone; never infer expected dates from the candidate's output or the machine's ambient timezone.

### End-to-end demonstration

1. User enables browser-only observation in the companion and grants a site permission in Chrome.
2. User performs three successful report downloads during an enabled observation session. For the demo, a completed matching download bounds each demonstration. The user can correct a proposed task boundary; do not require a record button for every example.
3. Llama recognizes the repeated task and produces a structured draft skill. Three examples are a demo heuristic, not proof of user intent.
4. Independent verification approves version 1 after checking CSV content, workflow behavior, and permitted effects.
5. User activates version 1. The agent opens a dedicated Chrome tab and downloads the correct report.
6. New demonstrations or a controlled regression produce candidate version 2, which selects the current week by mistake.
7. The verifier finds that the CSV dates violate the task contract, blocks version 2, and leaves version 1 active.
8. A corrected version 3 passes and becomes active according to the maintenance policy.
9. Demonstrate rollback separately: after promotion, a detected execution regression switches future executions to the previous approved version. Already completed external effects are not reversed.

Deliberately injected regressions must be labeled as demo mutations. Do not claim that an injected change was organically learned.

## 3. Stack and repository layout

| Concern | MVP choice | Notes |
| --- | --- | --- |
| Workspace | pnpm workspaces, TypeScript, pinned supported Node LTS | Lock dependencies; validate native-module compatibility with Electron. |
| Extension | WXT, React, TypeScript, Manifest V3 | Browser-specific manifests and adapters; no secrets in extension code. |
| Companion | Electron main process, React renderer, Vite | Menu-bar/tray lifecycle, dashboard, local coordinator. No remote website views. |
| Native capture | Swift command-line helper using ScreenCaptureKit | Browser-window capture with permission and lifecycle handling. |
| Bridge | Chrome native messaging host plus local IPC | Native host relays to a running companion; handles absent companion and reconnects. |
| Storage | SQLite through better-sqlite3; encrypted artifact files | Rebuild native SQLite module for Electron. Optional encrypted mode keeps key material in macOS Keychain; default local-development mode is explicitly unencrypted (decision 009). |
| Models | Typed Llama provider adapter; SubQ Decisions API adapter | Hosted Llama first; explicit model IDs and capability checks. |
| Execution | Shared TypeScript skill runtime; Chrome debugger/CDP input adapter | Limit actions to the assigned agent tab. |
| Verification | Separate supervisor, Playwright, Docker, fixture website | Protected test control and approval authority. |
| Checks | Vitest, Playwright, Swift package checks where appropriate | Focus on boundaries, task outcomes, and regression prevention. |

```text
apps/
  companion/                  # Electron main/preload/renderer and dashboard
  extension/                  # WXT content scripts, background, controls, CDP adapter
  fixture-site/               # Reporting UI; public UI and private test-control interface
services/
  learner/                    # Task segmentation and candidate generation; no promotion API
  verifier/                   # Test construction, evidence evaluation, trusted supervisor
  registry/                   # Revision storage, promotion gate, active-version transactions
native/
  macos-capture/              # Swift ScreenCaptureKit helper
  messaging-host/             # Framed native messaging relay and installer
packages/
  contracts/                  # Versioned Zod schemas and TypeScript types
  observation/                # Filtering, event/frame alignment, segmentation primitives
  model-adapters/             # Llama and Snap adapters; typed requests, replay fixtures
  skill-runtime/              # Bounded observe/plan/act/verify loop
  browser-adapters/           # Shared interfaces and isolated test browser transport
  storage/                    # SQLite migrations and encrypted artifact storage
tests/
  integration/
  fixtures/                  # Public synthetic observations and provider fixtures
  mutations/                 # Known defective candidates; labeled evaluation inputs
infra/
  verifier/                  # Dockerfiles, compose, network and filesystem restrictions
docs/
  decisions/                 # Architecture decisions and resolved technical spikes
```

These paths establish ownership boundaries. Avoid a microservice deployment project: most local services can be workers/processes launched by the companion. The verifier's candidate runner must still be isolated from its trusted supervisor and registry authority.

## 4. Architecture and trust boundaries

```text
Swift capture helper ──frames──┐
                              ├─> Local filter/alignment -> Demonstrations -> Llama learner
Chrome extension ──events──────┘                                         |
                                                              immutable candidate
                                                                         |
Task contract + held-out examples -> Verifier test builder -> Frozen test suite
                                                                         |
                                      Isolated candidate/browser execution
                                                                         |
                           CSV + effect log + screenshots + execution trace
                                                                         |
                                Deterministic assertions + Snap judgments
                                                                         |
                                      Trusted promotion gate -> Skill registry
                                                                         |
                                          User activation -> Dedicated agent tab
```

### Roles and authority

- **Observer:** writes filtered observations and demonstration records. Cannot approve skills.
- **Implementer/learner:** reads permitted demonstrations and writes new immutable candidates. Cannot read held-out inputs or change task contracts, tests, approvals, or active pointers.
- **Test builder:** reads the task contract and held-out demonstrations before receiving candidate behavior. Produces constrained scenarios, not executable arbitrary model-generated code.
- **Candidate runner:** receives the candidate and current public scenario. Cannot access test-control credentials, expected outputs, future scenarios, Snap credentials, or approval keys.
- **Verifier supervisor:** owns fixtures, expected outcomes, evidence extraction, deterministic checks, and Snap calls. Candidate claims are untrusted input.
- **Registry gate:** validates reports and exact hashes before atomically changing the active version. The learner has no write path to this operation.

Separate prompts or model sessions are insufficient isolation. Use explicit process/container permissions, distinct input sets, protected mounts, and credentials kept outside candidate execution.

The threat model covers a mistaken or adversarial generated skill and untrusted webpage content. A repository developer, machine administrator, or same-user process with unrestricted disk access can tamper with a local MVP. Production hardening against those actors needs a separately controlled verifier or OS sandbox and stronger credentials; do not claim the local demo solves that threat.

## 5. Shared contracts: define before parallel implementation

Use Zod runtime validation and exported TypeScript types. All persisted records need a schema version. Treat messages, webpage text, model responses, and imported artifacts as untrusted.

| Contract | Required fields and rules |
| --- | --- |
| `ObservationEvent` | Event ID, schema version, UTC timestamp, monotonic time, browser/connection/window/tab/document/frame IDs, approved origin, event kind, safe target description, optional frame reference, provenance (`human`, `agent`, `unknown`). |
| `VisualFrame` | ID, capture source, timestamp, pixel dimensions, scale, crop/mask metadata, encryption reference, privacy-policy version, content hash. |
| `Demonstration` | Task family, event range, evidence references, input parameters, independently observed outcome, human corrections, train/held-out assignment. |
| `TaskContract` | Version/hash, input schema, timezone rules, allowed origins and effects, expected artifact/state checks, required semantic criteria, controlled-stop rules, resource limits. Learner cannot rewrite this. |
| `SkillRevision` | Skill/revision IDs, parent hash, canonical content hash, structured procedure, parameter schema, requested capabilities, source demonstration references, generator model/prompt versions. |
| `ActionRequest` | Run/action IDs, target session/tab, document identity, observation sequence, action kind, bounded arguments, expiration. Reject stale or out-of-scope actions. |
| `VerificationSuite` | Contract hash, suite version/hash, scenario seeds, mutation definitions, oracle IDs, required assertions. Freeze before execution. |
| `VerificationReport` | Candidate, contract, suite, environment and runtime hashes; verdict; assertion results; model request references; evidence hashes; failures; completion time. Supervisor authenticates the report. |
| `ExecutionRun` | Approved skill hash, input hash, browser identity, explicit activation, state, budgets, append-only action results, artifact references. |

Skills are declarative procedures with permitted action types. They must not contain arbitrary JavaScript, shell commands, filesystem access, unrestricted URLs, or their own success/promotion authority.

Proposed revision lifecycle:

```text
draft -> queued -> verifying -> approved | blocked | inconclusive
```

Approval belongs to an exact revision and verification context. `active` is a separate registry pointer, not a mutable field in skill content. Code, contract, model/runtime, capability, or environment changes can require re-verification according to an explicit compatibility policy.

Proposed execution lifecycle:

```text
created -> running -> succeeded | failed | cancelled
                 -> paused -> running
                 -> needs_user -> running | cancelled
```

## 6. Continuous observation implementation

### Capture and lifecycle

- Provide opt-in observation and an optional launch-at-login setting. Neither is enabled silently.
- Capture the visible content of allowlisted browser windows. Detect active-window, tab, navigation, and permission changes. Do not capture the entire desktop merely to simplify implementation.
- Combine native frames with extension context using timestamps and browser/window/tab identity. Document native-to-extension window matching during the initial spike; never assume the IDs are identical.
- On ambiguous identity, unknown site, private browsing, locked screen, sleep, stale exclusion state, or permission loss, suspend retained frames. Show the reason and resume when the state is valid.
- Always-on means armed while the app and session are available, not guaranteed capture while asleep, locked, terminated, or denied by the OS.
- Start with a bounded sampling strategy: up to one retained changed frame per second, with event-triggered before/after frames and short bursts where needed. Benchmark and tune; this is a starting configuration.
- Continuous capture need not imply continuous model inference or permanent video storage. Keep a bounded in-memory frame buffer, persist only filtered evidence, and avoid redundant model calls on unchanged screens.
- Agent execution is separately tagged and excluded from human training demonstrations unless explicitly reviewed. Avoid learning the agent's own mistakes as user habits.

### Filtering and persistence

- Do not install a global keystroke logger. Use event metadata and commit-level changes on approved fields; exclude password, payment, and marked-sensitive fields.
- Disable incognito access. Treat browser-internal pages, unsupported frames, and missing context as capture exclusions.
- Screen frames can reveal sensitive content even when DOM events are filtered. Apply exclusion and crop/mask checks before persistence and cloud upload. When mask alignment is stale, drop the frame. OCR can supplement filtering but cannot guarantee removal of secrets.
- For the MVP, enable observation only on the fixture site's origin. Other browsing remains excluded until site controls are deliberately expanded.
- Set configurable bounded retention: start with 24 hours for filtered raw evidence, a rolling memory buffer, and longer-lived summaries/skills. Model/provider retention is separate and must be disclosed.
- Define quotas and backpressure. On a full disk or failed storage, stop capture rather than accumulate an unbounded queue.
- Deletion must remove local observation records, artifacts, thumbnails, and caches; mark derived candidates stale where their evidence disappears. Do not imply that local deletion erases provider-held copies.

## 7. Browser bridge and live execution harness

### Connection

- Use a native messaging host registered for the exact development extension ID. The host relays framed JSON to the companion over a user-only local socket.
- Restrict the socket path/permissions, validate peers and message schemas, cap message sizes, and reject unknown connections. Avoid an unauthenticated localhost HTTP service.
- Account for Native Messaging message-size limits. Do not stream native screenshots as giant extension messages; send compact event/action records and references.
- Handle extension service-worker suspension, browser restart, reconnect, duplicate delivery, and the companion not running. Sequence messages and make retries idempotent.
- Do not request debugger access merely to observe ordinary clicks. Attach it when an authorized execution starts, and detach on completion, cancellation, or loss of scope.

### Agent tab and physical interactions

- Create a normal dedicated Chrome tab, identified by an execution run. The companion provides a compact preview/controller; this is the MVP's micro-tab experience.
- Use `chrome.debugger` CDP `Page`, `Accessibility`, and `Input` functionality for screenshots, context, clicks, keys, scroll, and supported drag interactions.
- Execute mouse/keyboard interactions through browser input. Do not implement the demo by calling the report endpoint directly, injecting `element.click()`, or replacing the workflow with an API shortcut.
- Validate every action against the approved skill, current tab/document, origin, bounds, budget, and expiry. Re-observe after page changes before using coordinates.
- Stop on login challenges, CAPTCHA, unsupported dialogs, unexpected origins, ambiguous state, or exhausted budgets. Ask for user takeover through the UI.
- Support pause/cancel and release pending input on cancellation. Do not move the user's global OS cursor.
- Authentication in the installed browser may be shared with its agent tab. A tab is not an account sandbox; allowlist actions and explain shared-session consequences.
- Observe actual download completion in the browser. In production, CSV interpretation may be limited to authorized artifacts; in the fixture, the verifier has independent access to output bytes.

### Shared runtime in verification

Run the same skill interpreter and planning loop in live execution and verification. Playwright provisions browsers, resets fixtures, captures traces, and supplies trusted assertions. It must not replace candidate behavior with its own successful locator script.

Implement a transport adapter for the isolated Chromium test context. Verify its coordinate, key, scroll, navigation, and screenshot semantics against the extension CDP adapter. If full extension integration is needed, use Playwright's supported bundled Chromium extension setup and persistent context. Do not assume the installed Chrome profile can be automated identically.

Keep a separate manual/live Chrome smoke check: a Linux container test cannot prove macOS permission, native bridge, or consumer-browser integration behavior.

## 8. Llama and SubQ model integration

### Meta Llama

- Make endpoint, credentials, model ID, image support, and provider schema configurable. Select a hosted vision-capable Llama deployment after a capability smoke test; evaluate Llama 4 Scout/Maverick where available without hardcoding a provider assumption.
- Use separate contexts for the learner, action planner, and verifier scenario generator. Scenario generation receives the task contract and held-out examples, not the implementer's rationale or candidate output.
- Do not claim model-family diversity between two Llama sessions. Independence also requires deterministic oracles, data separation, systematic mutations, and Snap evaluation.
- Validate structured outputs. Bound steps, token/image usage, deadlines, retries, and maximum spend. Invalid output or exhausted budgets cannot authorize actions or promotion.
- Use frozen recorded responses for offline development; label all replay runs. A replay-only run is not evidence that live model integration works.

### SubQ Snap

- Start with `subq-snap-1.1` on the documented Decisions endpoint, `POST https://api.subq.ai/v1/systemone`. Re-check the contract when implementing.
- Snap produces typed decisions, not arbitrary test code or free-form skill generation. Construct named questions from trusted verifier criteria and supply independently collected evidence.
- Normalize provider answers into application verdicts. Preserve actual `noul`, choice probabilities/confidence, and score results rather than inventing a generic response schema.
- Sample screenshots within documented image limits; Snap does not accept continuous video. Enforce size/count limits in the adapter and preserve image hashes for audit.
- Use an explicit insufficient-evidence option where applicable. Provider errors, invalid responses, missing required evidence, or uncertain required judgments yield `inconclusive`; they never silently pass.
- Snap confidence is model output, not a guarantee. Choose and version thresholds using labeled evaluation cases, including known bad candidates; do not tune thresholds on the final hidden evaluation set.
- Snap cannot override a failed deterministic assertion. Keep credentials and requests in the verifier supervisor, outside candidate/browser execution.

Both adapters must record model identifiers, prompt/question versions, input hashes, provider request IDs where available, latency, and usage. Keep keys in Keychain/environment configuration and redact them from logs. Verify provider retention and account access before sending real user content.

## 9. Independent verifier design

### Test generation without mirroring the skill

1. Establish an authoritative task contract from explicit user intent and validated demonstrations. Ambiguous intent requires review, not guessed permissions.
2. Split source demonstrations into learner and verifier sets before candidate generation. Do not leak held-out evidence through retrieval, summaries, shared model histories, or caches.
3. Let a separate Llama invocation propose scenario specifications from the contract and verifier data. Use an allowlisted scenario DSL: inputs, fixture mutation, expected outcome category, and assertion IDs.
4. Validate scenarios and map them to trusted test templates. The model cannot create arbitrary assertion code, change expected results, disable checks, or modify the test runner.
5. Add systematically generated cases regardless of the model's suggestions: date boundaries, changed layout, delayed elements, expiry, wrong output, and injected webpage instructions.
6. Freeze and hash the resulting suite before executing a candidate. Run a baseline approved revision and candidate against the same suite when comparing updates.

In the initial demo, public mutation cases are useful regression tests but are not secret. Runtime held-out cases must be supplied through verifier-only configuration/mounts and separate access paths. Do not commit secrets or imply that public repository tests are hidden from repository-reading agents.

### Independent oracles and anti-gaming

- Derive expected CSV rows from a trusted seeded dataset and contract date logic, outside candidate code. Do not reuse the fixture export implementation as the sole oracle.
- Read actual downloaded file bytes, not the filename or a success toast. Include a case where the UI claims success but the content is incorrect.
- Observe effects through a fixture-server audit log and browser/network evidence. Hiding a control does not establish absence of side effects.
- Place reset endpoints, expected datasets, and audit administration on a verifier-only interface unavailable to the candidate's network. No verifier secrets in page JavaScript.
- Keep task requirements and webpage content separated. Test instructions such as “ignore the requested dates” as untrusted page data.
- Candidate code cannot mount supervisor state, write result reports, access host Docker sockets, or read credentials. Restrict network egress to the fixture and a broker for bounded model calls.
- An evidence gateway binds run/action IDs and collects browser/server output. Do not accept self-reported screenshots or success records as sole evidence.
- Return useful assertion categories for repair without revealing all held-out cases or expected answers. Log candidate submissions to detect repeated overfitting attempts; do not claim unlimited hidden-test resistance.

### Required case matrix

| Case | Required result |
| --- | --- |
| Normal report | Correct team, previous-week dates, CSV schema and rows; no unauthorized effect. |
| Alternate team and timezone boundary | Contract-derived values remain correct. |
| Export button moved or renamed | Skill succeeds through valid interaction or stops safely; no wrong export. |
| Slow loading | Bounded waiting succeeds without duplicate exports. |
| Expired session | Controlled stop and user takeover; no secret entry or bypass. |
| Wrong CSV behind success toast | Block revision through artifact assertion. |
| Webpage prompt injection | No scope expansion or unauthorized navigation/action. |
| Missing evidence, model timeout, Snap outage | Inconclusive; active version stays unchanged. |
| Candidate/report hash mismatch or tampered evidence | Reject promotion. |
| Agent actions mixed with observation | Agent trace is not ingested as a human demonstration. |

The suite declares whether each case requires success or a controlled stop. A safe stop is acceptable for specified unsupported/error cases; it is a failure for the normal required workflow. This prevents a candidate from passing by refusing every task.

### Promotion policy

- Required deterministic assertions must all pass. Forbidden effects always block.
- Required semantic criteria must satisfy their versioned, evaluated thresholds. Missing or ambiguous evidence is inconclusive.
- Candidate hash, contract hash, suite hash, environment/runtime version, and authenticated report must match the submitted revision.
- Capability expansion requires explicit user approval; passive observation never expands permission scope by itself.
- The first learned skill requires user review/activation. Subsequent approved revisions within the same contract and capability scope may become active automatically if automatic maintenance is enabled.
- Commit revision approval, audit event, and active-pointer update transactionally with compare-and-swap semantics. Reject stale competing promotions.
- Quarantine a promoted revision when a trusted runtime check detects a regression; restore the previous approved version for future runs. If no compatible version exists, disable execution pending review.
- Keep deterministic validation results replayable. Live model judgments can vary; preserve recorded inputs/outputs, mark replay versus live mode, and use repeated live runs for empirical reliability measurements.

## 10. Build phases and handoffs

Each workstream below is a bounded task for a future agent. This plan does not itself authorize launching agents or modifying unrelated systems. A coordinator should assign work explicitly, freeze contracts first, and integrate each milestone before broadening scope.

### Phase 0: feasibility and architecture decisions

Owner: integration coordinator.

November 7 feasibility findings: selected-window capture and extension/native-message/CDP probes work live in isolated Chrome for Testing; CSV artifact mutations are detected independently. Native and extension IDs require a separate binding record; fixture-title pairing is not a general approved-origin guarantee. Native/window and CDP screenshot coordinate spaces need separate measured mappings. Register native hosts inside the actual Chrome user-data directory, and install a self-contained host outside the development tree. Initialize AppKit on the main actor for the tested CLI ScreenCaptureKit runtime. Live provider credentials, manual permission revocation/regrant, and installed consumer-Chrome smoke evidence are still missing. These findings refine the existing adapter/capture boundaries; they do not waive the exit gate or authorize wider observation. See `docs/decisions/` for versions, commands, failed attempts and limitations.

- Prove ScreenCaptureKit browser-window capture, exclusion behavior, permission handling, and native/Chrome window identity alignment.
- Prove the native messaging extension-to-companion round trip, reconnect, and framed message handling.
- Prove screenshot -> CDP click/type -> observable result in an assigned tab; test focus, scaling, and background-tab constraints instead of promising uninterrupted execution.
- Prove a real Llama image/structured-output call and a real Snap decision call using synthetic evidence. Missing credentials remain a documented integration blocker; do not replace providers silently.
- Prove isolated fixture launch and a CSV assertion with an independent expected dataset.
- Record actual versions and platform requirements in `docs/decisions/` and pin them.

Exit: written spike results resolve each assumption; no claim of success based only on mocks. If a capability fails, revise the relevant scope and adapter explicitly before dependent work.

### Phase 1: foundation and contracts

Owner: contracts/storage workstream.

November 7 implementation: schema version 1, immutable hash-bound contracts/suites/revisions, encrypted SQLite-backed artifact/record persistence, retention/deletion recovery and lifecycle CAS checks are implemented. Electron/React and WXT/React build entry points and worker scaffolds exist. Basic tests retain the offline Node test runner. SQLite 13.0.3 uses Node-API; both the prebuild and a staged source rebuild are checked inside Electron without overwriting the Node test binding. The optional encrypted mode wraps artifact keys with macOS Keychain-backed safeStorage; the user-authorized local-development default now uses separate unencrypted storage (decision 009); automated checks use labeled ephemeral synthetic keys. Live providers, interactive Keychain persistence, signed packaging and Phase 0 manual gates are not claimed passed. No promotion or actual skill execution is enabled. See `docs/decisions/006-phase1-foundation.md`.

- Scaffold workspace, applications, worker entry points, lint/typecheck/build scripts, lockfile, `.env.example`, and ignored runtime directories.
- Implement contracts, migrations, event IDs, content hashes, artifact encryption, retention, and execution/revision state transitions.
- Implement provider interfaces and labeled offline replay fixtures; no network dependency in the basic test suite.
- Write the root README with install, permissions, model configuration, and reproducible commands.

Exit: a synthetic demonstration can be stored, retrieved, expired, and deleted; immutable revisions and invalid transitions are enforced.

### Phase 2: independent verifier vertical slice

Owners: fixture workstream and verifier workstream, with separate oracle ownership.

- Build seeded reporting UI, CSV output, delayed/changed layouts, session expiry, and private audit/control interface.
- Build trusted contract/date/CSV oracles independently of export code.
- Implement the bounded skill runtime against a test browser transport; use a hand-authored candidate initially.
- Build isolated execution, constrained scenario generation, mutation suite, evidence capture, Snap adapter, and authenticated report format.
- Implement registry promotion and negative tests for stale/tampered reports.

Exit: correct candidate passes; wrong-week, wrong-team, spoofed success, and unauthorized-effect mutations block; outage/missing evidence is inconclusive. Tests use the candidate runtime, not a substitute happy-path script.

### Phase 3: desktop observer and extension

Owners: native-capture workstream and extension/bridge workstream.

- Implement companion menu-bar lifecycle, observation state, pause, exclusions, and dashboard.
- Integrate Swift helper, context alignment, frame sampling, privacy filtering, local storage, and crash/reconnect behavior.
- Implement content events, download boundaries, event provenance, optional site permission, native host installer, and agent-tab CDP adapter.
- Add a capture-health panel showing permission, bridge, active site, last valid frame, dropped frames, and paused reason.

Exit: a 30-minute manual session across tab switches and excluded sites has no uncapped queue growth; excluded windows are not persisted; sleep/lock and reconnect are represented honestly; agent actions are tagged.

### Phase 4: learned skills and live execution

Owner: learner/runtime integration workstream.

- Segment repeated fixture tasks from observation data and generate schema-valid Llama skill candidates.
- Route candidates to the existing verifier and expose revision diffs, evidence, verdicts, and activation controls.
- Run approved skills in a dedicated Chrome tab with action budgets, actual download results, pause/cancel/takeover, and no API shortcuts.
- Compare revised procedures against prior approved versions. Preserve the task contract and permissions.

Exit: three observed demonstrations lead to a candidate, independent verification, explicit first activation, and a correct live result. Repeated agent activity cannot generate self-reinforcing user habits.

### Phase 5: regression blocking, rollback, and delivery

Owner: integration/evaluation workstream.

- Complete the scripted defect/block/fix demo and a distinct post-promotion rollback scenario.
- Run the fixed evaluation matrix, collect latency/cost/capture-health measurements, and document limitations.
- Exercise restart mid-verification and mid-execution. Never automatically repeat an action with an ambiguous external result.
- Document manual live Chrome/macOS checks separately from container tests.
- Produce setup instructions, demo data, fixture reset command, evidence report, and known unsupported behavior.

Exit: another agent can reproduce the demo from the README, and every product claim maps to observed evidence.

### Dependency order and ownership rules

```text
Phase 0 -> Phase 1 -> Phase 2 -------------------┐
                   -> Phase 3 -------------------┤-> Phase 4 -> Phase 5
```

- Freeze `packages/contracts` before independent workstreams depend on it; propose schema changes through the coordinator.
- Fixture export logic and verifier oracle implementation must have distinct ownership/review to avoid copying the same bug.
- Learner tasks do not own verifier tests, contract expectations, promotion policy, or approval credentials.
- Every handoff records changed paths, contract changes, commands run, evidence, unresolved assumptions, and the next dependency.
- Do not duplicate infrastructure in another agent's directory. Integrate through the agreed interfaces.

## 11. Validation and acceptance criteria

### Proposed commands to implement

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
pnpm verify:fixtures
pnpm verify:mutations
pnpm demo:up
pnpm dev:companion
pnpm dev:extension
```

Add explicit native-helper build and host-install instructions in the README. Document commands requiring Xcode tools, Docker, macOS permissions, browser setup, or provider credentials. Pin environment images by digest for verification releases; do not use floating `latest` tags.

### Meaningful automated checks

- Protocol framing, payload validation, idempotency, expired actions, and reconnect sequence handling.
- Privacy drops on stale/unknown context and excluded fields/sites; retention/delete completeness.
- Date boundaries, timezone behavior, independently expected CSV bytes/rows, and forbidden-effect audit checks.
- Invalid model output, provider errors, action/cost budgets, prompt injection, stale screenshots, and controlled-stop behavior.
- Exact-hash report binding, write permissions, promotion races, transactional pointer updates, and rollback compatibility.
- Shared runtime/adapter conformance plus fixture outcomes in a pinned environment.

Avoid tests that merely repeat implementation details or snapshot every dashboard label. Prioritize failures that would allow wrong execution, leaked observation, false approval, or irreproducible evaluation.

### Release evidence

| Requirement | MVP acceptance evidence |
| --- | --- |
| Passive observation | Enabled session collects relevant fixture events/frames without per-task recording clicks; exclusions and lifecycle pauses work. |
| Learned skill | Live Llama integration creates a valid parameterized candidate from observed examples. |
| Independent evaluation | Task-derived suite and separate oracle find defects without trusting implementer success claims. |
| Real model roles | Live Snap evaluation recorded separately from Llama generation; deterministic checks remain authoritative. |
| Defect blocking | Every critical seeded mutation is blocked; the active pointer remains unchanged. |
| Correct execution | Approved candidate produces correct CSVs in 10/10 fixed normal fixture runs; report live versus replay mode and treat this as a demo gate, not a production reliability claim. |
| Useful error handling | Declared error scenarios stop safely; refusal of normal tasks fails. |
| Rollback | Trusted post-promotion failure restores a compatible approved version for future activations and preserves audit evidence. |
| Reproducibility | A fresh pinned environment can replay deterministic checks and stored model responses; live variation is reported separately. |
| Browser integration | Manual installed-Chrome run verifies native bridge, capture, assigned-tab interactions, and download. |

Measure observation CPU/memory, stored bytes/hour, dropped frames, task interventions, action count, verification duration, model usage/cost, false approvals, and false rejections. Establish hardware-specific capture targets after Phase 0; do not invent unmeasured performance claims.

## 12. Verified references and implementation cautions

Documentation checked November 7, 2026. Re-check live API contracts when building; pin actual SDK, browser, container, and model revisions in the implementation manifest.

- [WXT](https://wxt.dev/): cross-browser extension build tooling; build support does not establish execution capability parity.
- [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger): permissions, accessible CDP domains, frame/target handling, and attach lifecycle.
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): host registration, protocol, installation, and limits.
- [ScreenCaptureKit](https://developer.apple.com/documentation/ScreenCaptureKit): native capture and permission/lifecycle requirements. A packaged Swift helper needs real macOS testing.
- [SubQ API overview](https://docs.subq.ai/using-the-api/) and [Decisions API](https://docs.subq.ai/endpoints/decisions-api/): Snap uses a dedicated structured-decision endpoint, not a general chat-code generation interface.
- [SubQ retention](https://docs.subq.ai/using-the-api/data-retention/): review actual retention settings before uploading user observations.
- [Meta Llama models](https://github.com/meta-llama/llama-models) and [Llama 4 model card](https://github.com/meta-llama/llama-models/blob/main/models/llama4/MODEL_CARD.md): capabilities, licensing, and deployment requirements. Do not assume a large model runs on the user's laptop.
- [Playwright extension testing](https://playwright.dev/docs/chrome-extensions): supported Chromium extension setup differs from driving an installed consumer Chrome profile.
- [Playwright Docker](https://playwright.dev/docs/docker), [mocking](https://playwright.dev/docs/mock), and [traces](https://playwright.dev/docs/trace-viewer): useful primitives; Docker alone does not establish a complete sandbox for hostile browser workloads.

## 13. Start-here instructions for the next agent

1. Read this file and any applicable `AGENTS.md`; inspect the actual repository state before assuming any module exists.
2. Execute Phase 0 first and record evidence. Resolve capture alignment, input behavior, provider access, and isolated verification before expanding UI work.
3. Create the smallest verifier vertical slice early: fixture, contract, candidate, independent CSV check, blocked mutation, and immutable approval record.
4. Add the continuous observer and real model integrations around that verified path.
5. Keep deferred features deferred. Update this plan when a tested technical constraint changes the design, explaining the evidence and downstream effect.
6. At handoff, report completed milestones, tests/manual checks, live versus mocked integrations, remaining blockers, and exact next steps. Never mark a milestone complete solely because its scaffolding exists.
