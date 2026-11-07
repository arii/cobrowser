# Visual Harness: foundation and feasibility probes

Read [plan.md](plan.md) first. Phase 1 provides versioned contracts, encrypted SQLite-backed persistence, a minimal Electron/React foundation shell, a WXT/React Chrome extension build, and worker entry points. Observation, learning, task execution and promotion are not enabled. [Phase 1 results](docs/decisions/006-phase1-foundation.md) and [Phase 0 open gates](docs/decisions/000-phase0-results.md) distinguish implemented behavior from scaffolding and live integrations.

## Setup

Tested on Apple silicon macOS 26.5.2, Xcode command-line Swift 6.3.3, Node **24.13.0**, pnpm **11.25.0**, Playwright **1.65.0**, bundled Chrome for Testing **158.0.8127.18**. Dependencies are exact-pinned in `package.json` and `pnpm-lock.yaml`. `.node-version` selects Node; pnpm itself ran under a separate bundled Node 24.22.1 on the original machine. Docker is absent. Use a Node version manager and Corepack or an existing pnpm installation; this repo does not install global tooling.

```sh
cd /Users/tolui/Documents/ChatGPT/Harness
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm build:native
```

Generated files go in ignored `.local/`, `dist/`, `.wxt/` and `.output/`. Only curated synthetic evidence is checked into `docs/decisions/evidence/`. No `.env` file is loaded automatically. Never place credentials in commands saved to source, fixtures, screenshots, or logs.

## Phase 1: reproduce the foundation

```sh
pnpm verify:foundation       # encrypted synthetic store/reopen/expire/delete lifecycle
pnpm verify:phase1           # full measured check sequence, records actual exit codes
```

`pnpm test` is an offline Node test suite: no provider credentials, browser, Docker or live model calls. Installation still needs registry access and native build prerequisites; integration probes need the Playwright browser installed. The existing Node test runner is retained rather than migrating the Phase 0 tests to another framework.

The full check sequence runs lint, three TypeScript projects, tests, all build outputs, a staged Electron SQLite source rebuild, Electron smoke, the storage acceptance script, CSV downloads, both raw and built extension popups, and worker starts. It stores actual logs/exit codes and source/evidence hashes in `docs/decisions/evidence/phase1/`. All evidence is synthetic. A failed command stops the sequence. The checks do not request OS capture permission, access Keychain, or make live model calls.

```sh
pnpm rebuild:electron        # after build; rebuilds dist/companion's native module only
pnpm smoke:companion        # hidden real Electron renderer/preload/SQLite; ephemeral test key
pnpm dev:companion          # desktop shell; unencrypted local storage, no Keychain required
pnpm dev:extension          # WXT Chrome development mode
pnpm build:extension        # production MV3 extension output
pnpm worker:learner         # one-shot scaffold status; requires build
pnpm worker:verifier
pnpm worker:registry
```

Load **`apps/extension/.output/chrome-mv3`** using Chrome → `chrome://extensions` → Developer mode → Load unpacked. The built extension keeps the same pinned development ID and reuses the Phase 0 probe handlers. Do not open the HTML as a website. The raw `apps/extension` folder remains available for historical Phase 0 probes; use one version at a time. `pnpm probe:popup --built` exercises the built popup's real handlers, screenshot and CDP input, plus missing-host error feedback. Chrome profile installation and debugger permission remain explicit user setup steps.

The desktop shell exposes storage status and initialization retry over an isolated preload bridge. It loads local assets, rejects new windows/navigation, and offers no observation or execution enablement.

Hackathon storage note: the companion saves data **unencrypted** in `~/Library/Application Support/Visual Harness/foundation-unencrypted`. No Keychain or administrator access is required. Files are readable to anyone with access to that directory; owner-only permissions, retention, deletion and integrity checks remain enabled.

To reproduce: run `pnpm build`, then `pnpm smoke:companion:unencrypted`, then `pnpm dev:companion`. The unencrypted smoke saves synthetic bytes, closes and reopens the store, and reads them back inside Electron; it checks renderer/preload IPC too. Quit any older companion window before restarting the new build.

The existing encrypted store in `foundation` is preserved and is not migrated or opened by default. `pnpm dev:companion --keychain` opts into the original encrypted mode, which still requires functioning macOS Keychain. There is no automatic fallback between modes. Keychain failure keeps that mode unavailable; see [startup diagnostics](docs/decisions/007-keychain-startup.md) and [recovery notes](docs/decisions/008-keychain-restart-recovery.md). Do not reset or delete the keychain. Signed packaging and interactive Keychain persistence remain manual acceptance work. See [unencrypted local storage decision](docs/decisions/009-unencrypted-local-storage.md).

SQLite 13.0.3 uses a Node-API native binding. Both its packaged prebuild and a source rebuild were exercised in Electron 45.2.3 (embedded Node 24.22.2), separately from Node 24.13.0 tests. `pnpm build` stages a copy of SQLite under `dist/companion/node_modules`. `pnpm rebuild:electron` removes only that copy's prebuilds and rebuilds against the pinned Electron headers; it never overwrites the binding used by Node tests. Running `build` again resets the staged copy, so rerun `rebuild:electron` for a source-rebuilt runtime. This is not a signed application distributable.

### Storage and contract boundaries

`packages/contracts/src/schemas.ts` (re-exported by `index.ts`) freezes schema version 1 for observations, frames, demonstrations, task contracts, declarative skills, actions, suites, reports, runs and action results. UUID IDs and canonical SHA-256 hashes bind immutable content. Browser code imports `@harness/contracts/schemas` to avoid Node-only crypto helpers; `build` verifies browser bundles too. Unknown fields, arbitrary executable skill steps, stale/out-of-scope actions and invalid transitions are rejected. Report parsing validates structure; signature verification and promotion belong to Phase 2. The store explicitly refuses approval transitions until that gate exists. Run records are bookkeeping, not proof of skill approval or permission to execute.

`HarnessStore.open(root, keyProvider, options)` requires a private macOS-owned directory, a 32-byte key and a single writer. Schema migrations are hash-checked. SQLite contains IDs, hashes, states, dependencies and retention metadata; in this encrypted API, record bodies, action-result bodies and artifacts are AES-256-GCM encrypted files. Metadata is not fully hidden. The optional `--keychain` Electron mode wraps the artifact key using async `safeStorage`. Default Electron startup instead calls `HarnessStore.openUnencrypted(root)`: record bodies and artifacts use readable `.plain` files with a `VH00` header and catalog SHA-256 checks. It stores no key. The encrypted API and ephemeral synthetic tests remain available. A mode marker rejects opening an unencrypted catalog in encrypted mode; an existing encrypted catalog cannot be opened in unencrypted mode.

Default raw retention is 24 hours, demonstration retention 7 days, artifact quota 64 MiB, maximum artifact size 16 MiB. API options can shorten raw retention (maximum 24 hours) and set demonstration retention (maximum 30 days). The quota covers managed encrypted artifacts, not all database/disk usage. The shell sweeps every minute, and reads reject expired sources immediately. Revisions/contracts/suites remain immutable longer-lived metadata with encrypted payloads. Removing source evidence marks dependent revisions stale; it does not edit their hashes or approve them.

`deleteDemonstration(id)` removes the demonstration and its source events/frames and associated artifacts, invalidating other dependents sharing that evidence. Deletion also works after evidence expiry. `deleteEvidence(id)` removes a selected record and its artifacts. Pending filesystem deletions are cataloged before unlinking; reads and subsequent writes fail closed if cleanup cannot complete. An exclusive reopen retries deletion and collects unregistered crash files. There are no thumbnail/cache stores in Phase 1. File removal does not promise forensic erasure from SSDs, filesystem snapshots/backups, or provider storage.

Workers are one-shot entry scaffolds with no learner/promotion APIs. Provider interfaces require explicit live/replay mode and separate role context, reject replay fallback in live mode, and currently expose the Phase 0 synthetic capability calls. Generic skill-generation/planning prompts and task-specific decision questions remain later work. Public replay fixtures are hand-authored synthetic responses.

## 1. Native observation

```sh
# Permission check and explicit browser-only window metadata listing:
native/macos-capture/.build/debug/CaptureProbe --list
# Only when you choose to request macOS Screen Recording permission:
native/macos-capture/.build/debug/CaptureProbe --request-permission

# Automated synthetic-window capture and bridge/input matrix; creates visible
# isolated Chrome for Testing windows, then closes them. Does not request permission.
pnpm probe:browser --headed --native
```

The combined probe launches its own fixture on port 3210, opens an assigned tab, matches its unique fixture title to a ScreenCaptureKit browser window, captures metadata, pauses, resumes, then changes the synthetic title to test exclusion. It records native/extension IDs and window bounds separately. The helper retains **no image files or video**: bounded transient buffers produce hashes, UTC/monotonic/PTS timestamps, dimensions and content scale. Native output includes window chrome; extension screenshots include page content. Native output pixels cannot be used directly as CDP coordinates.

For manual capture, run `pnpm fixture`, load the extension as below, create its agent tab, list windows, then:

```sh
native/macos-capture/.build/debug/CaptureProbe --window NATIVE_ID --marker phase0-agent-7f3a91
# stdin: pause, resume, quit (one command per line); EOF also stops.
```

Only Chrome/Chrome for Testing/Chromium windows are eligible. Selection requires a single matching title plus a native window ID. Identity loss stops capture and requires a new helper process. This fixture-only marker is a spike binding, not authenticated origin evidence. The 250 ms identity poll has a race; do not use this helper to retain real browsing images or enable continuous observation. No pixels from other native windows are requested or stored.

**Permission-loss check, still manual:** start capture; in System Settings → Privacy & Security → Screen & System Audio Recording revoke permission for the responsible app/helper. Record `stopped` (`permission-lost` or stream-error), or OS termination, and verify no subsequent frames. Relaunch if macOS requires it. Run `--list` while denied and expect `blocked/screen-recording-permission`; grant again explicitly and start a fresh helper. The probe never revokes/grants permissions automatically. This branch has not been claimed as tested.

## 2. Browser connection and physical input

**Do not open `apps/extension/popup.html` directly.** A `file://` page has no extension APIs. Load the folder as an unpacked extension and open it from Chrome's Extensions menu using the manual setup below. Directly opening the HTML now shows setup instructions and disables its controls.

```sh
pnpm probe:browser
# Optional real-window/focus matrix:
pnpm probe:browser --headed
```

The script uses a fresh persistent profile per device scale, loads the real MV3 extension, registers the actual native host **inside that temporary profile**, and starts the local coordinator after an initial unavailable interval. It checks duplicate acknowledgment and coordinator restart/reconnect. The host is installed as self-contained modules in the temporary runtime; no default user Chrome profile is modified. Cleanup removes profiles, socket, token, launcher and registration. An interrupted run may leave an OS-temp `harness-phase0-*` directory; remove only the directory reported for that run after its processes exit.

The extension creates a normal assigned tab at exactly `http://127.0.0.1:3210/`, attaches `chrome.debugger`, captures a screenshot, then uses **`Input.dispatchMouseEvent` and `Input.insertText`**. Neither DOM clicks nor site APIs implement these actions. Assertions read the resulting input value. Tested matrix: DPR 1/2 × zoom 1/1.25 × active/background, headed and headless. Screenshots, CSS viewport measurements, focus metadata, and results are saved in `.local/evidence/`. Screenshots expire in 10 seconds and are single-use; changed viewport, loader, assignment or origin invalidates input.

To test the installed **consumer Chrome**, enable Developer mode at `chrome://extensions`, Load unpacked → this repository's `apps/extension`. Its pinned development extension ID is `afchllcepipgheklaapddihncbpmfocl` (public manifest key; no private key). Then:

```sh
pnpm exec tsx scripts/install-host.ts afchllcepipgheklaapddihncbpmfocl Chrome
# Installer prints the absolute runtime path. In a separate shell:
HARNESS_RUNTIME_DIR="$HOME/Library/Application Support/VisualHarnessPhase0/relay" pnpm relay
pnpm fixture
```

Open the extension popup: Relay ping → Create agent tab → Screenshot/context → Click and type (default CSS x=65,y=425). Screenshot and act within 10 seconds. Inspect the text in the assigned tab. The popup displays the screenshot/context and detach control. Test switching tabs, browser zoom, and another focused app; record results, do not assume OS foreground behavior from headless results. Use the background worker console's `phase0.ping()` for repeated connection probes. Reopening the popup loses its observation ID, so capture again.

The manual installer writes a user-specific native host manifest with `flag: wx` and refuses to overwrite a registration. It installs modules/launcher under `~/Library/Application Support/VisualHarnessPhase0`. To uninstall, stop the relay and remove that directory plus `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.visual_harness.phase0.json`. No secrets are installed. The socket directory is mode 0700, socket/token 0600, with token authentication. Same-user processes remain trusted; this is not an OS sandbox. Deduplication is a bounded in-memory **ping** cache, not durable action idempotency. Pending pings are not recovered after worker termination; browser restart/MV3 suspension are open cases.

## 3. Model connectivity

```sh
pnpm probe:models              # offline hand-authored responses; explicitly replay
# Set private environment variables outside source control:
# HARNESS_CLOUD_ENABLED=1, LLAMA_SCHEMA=openai-chat, LLAMA_ENDPOINT,
# LLAMA_MODEL (explicit vision Llama deployment/revision), LLAMA_API_KEY, SUBQ_API_KEY
pnpm probe:models --live       # exits 2 if either capability check is inconclusive
```

Use `.env.example` only as a variable-name reference. The Llama adapter explicitly supports an HTTPS **OpenAI chat-completions wire format** with image input and JSON-schema response output; `LLAMA_ENDPOINT` is the full endpoint URL. It is not a claim that every hosted Llama provider supports that format. Configure a vision-capable Meta Llama deployment, verify its provider contract and retention, and add a separate adapter if its wire format differs. No provider is selected or substituted automatically. Exact response model mismatch is rejected; configure the pinned resolved revision rather than an alias if necessary.

The probe generates a local PNG containing a red background and PHASE0, then makes at most one request per provider (no retry), with a 30 s deadline, 128 Llama output tokens, 1 MiB response limit, and explicit cloud-processing gate. Set provider-side spend caps before live calls; no monetary usage can be calibrated without account access. Snap uses `subq-snap-1.1` at `https://api.subq.ai/v1/systemone`, one image and named noul/choice/score questions. The adapter enforces documented image/body limits, validates answers and distributions, preserves answer fields, and returns inconclusive on uncertain evidence. Probe thresholds are not product approval thresholds.

Results include mode/provenance, model/question versions, input/image hashes, latency, usage and hashed request IDs. Provider error bodies, request headers, credentials and endpoint URLs are not logged. Fixtures are **hand-authored synthetic**, not recordings of real provider success. Tests mock transport errors; those tests establish failure handling only. Missing credentials never fall back from live to replay. No real provider call has yet succeeded.

## 4. Independent downloaded-artifact verification

```sh
pnpm verify:fixtures
# Interactive mutation for inspection:
pnpm fixture --wrong-week
```

The automated command launches local fixture instances, a Playwright browser and a fresh context per case; routes page traffic only to that fixture; submits through UI controls; waits for the real download; reads its saved bytes; compares against a separately authored oracle snapshot. Contract dates are calculated from explicit task input (`asOf`, team, IANA timezone), never from the page, toast, filename, CSV or ambient timezone. Previous week is local Monday through next Monday, end exclusive. A local-calendar calculation handles the DST Sunday boundary without assuming seven 24-hour UTC days represent a zoned week.

Three input contracts cover red/blue and Los Angeles/Tokyo on opposite sides of Monday. Each runs with normal output and a labeled **wrong-week-demo** mutation. All six pages claim success; the three wrong artifacts must fail exact schema/row/team/date assertions. `.local/evidence/verifier.json` includes expected/actual CSV text, hashes and server-observed export parameters; CSVs/screenshots are also retained. The verifier imports no fixture data or export calculation. Both were authored in this task; distinct-owner review remains a Phase 2 gate.

This driver proves artifact inspection, not a learned/shared skill runtime, promotion gate, hidden evaluation, or hostile-candidate sandbox. Its Playwright form driver is separate from the CDP extension input probe and is not presented as the eventual candidate. Docker and protected supervisor/candidate separation are deferred. Repository tests and datasets are public.

## Current boundary and next milestone

Phase 1’s local foundation is implemented; see [results and evidence](docs/decisions/006-phase1-foundation.md). Phase 0 live-model, permission-revocation and installed consumer-Chrome gates remain open. The next implementation milestone is Phase 2’s independently supervised reporting verifier: a bounded shared skill interpreter, protected candidate/browser process, frozen mutation suite and authenticated promotion gate. Keep the learner, full dashboard and general workflow discovery deferred.
