# Visual Harness: foundation and feasibility probes

Read [plan.md](plan.md) first. Phase 1 provides versioned contracts, encrypted SQLite-backed persistence, a minimal Electron/React foundation shell, a WXT/React Chrome extension build, and worker entry points. The extension now includes HTTP/HTTPS tab observation, next-action forecasts, and a live monitor; desktop observation and verifier-backed promotion remain disabled. The extension supports reviewed local workflow suggestions and bounded replay, described below. [Phase 1 results](docs/decisions/006-phase1-foundation.md) and [Phase 0 open gates](docs/decisions/000-phase0-results.md) distinguish implemented behavior from scaffolding and live integrations.

## Record data and see it working

For a quick local test demo, run `pnpm demo`. It opens the reporting dashboard,
downloads real CSVs from a correct fixture and a deliberately wrong-week fixture,
and checks their bytes against the independent oracle. The wrong-week export
must fail verification even though the page says it succeeded. Both tabs stay
open for inspection until you close the demo browser. No cloud credentials are
needed. Use `pnpm verify:demo` for the headless version; evidence is saved under
`.local/evidence/demo*`. The dashboard uses synthetic data and also works with
the recording and skill-learning flows below.

From this `cobrowser` folder:

```sh
pnpm install --frozen-lockfile
pnpm build:extension
pnpm recording
```

This opens a separate Chrome for Testing profile with recording **on**, the local reporting fixture, and a **Cobrowser recording monitor** tab. Click fixture controls, change a field and leave it, or export its CSV; switch to the monitor to see the saved count, last-save timestamp, and recent events. The first few events are an automated setup check, explicitly labeled in the terminal and fixture. The monitor refreshes every second after Chrome confirms persistence. The extension toolbar badge shows `REC` while armed. Close this browser to stop; run `pnpm recording` again to reopen the profile and start a new session.

Use **Pause**, **Start recording**, **Export JSON**, or **Clear saved data** in the monitor. The export contains all retained events, while the table displays the latest 50. Clear pauses recording and deletes saved events. Exported files are managed separately. To use an already installed extension, rebuild/reload `apps/extension/.output/chrome-mv3`, open its popup, and follow **Open live recording monitor**; run `pnpm fixture` separately and press Start recording.

The recorder saves click, committed field-change, submit, throttled scroll/pointer, safe control-key, and page-visible metadata across HTTP/HTTPS origins, from the active tab in a focused browser window. It also reads bounded summaries of open background tabs, described below. Incognito, subframes and browser-internal pages are excluded. Password/payment/marked-sensitive interaction targets are excluded; typed values and printable keystrokes are never recorded. Full URLs and query strings are not saved as metadata. It uses content events without attaching the debugger. Click and change events also save a bounded semantic control label, tag and type for skill discovery; values, CSS selectors, IDs and names are not saved. This recording format now feeds the extension’s local skill discovery; it is separate from the Electron storage dashboard.

Data stays in **unencrypted Chrome extension local storage** in the demo profile at `.local/recording-profile` (ignored by Git). The live monitor window is limited to 24 hours / 2,000 events. A separate IndexedDB archive retains the full captured action history until Clear saved data. Rotation and expiry affect the live window, not this archive. capture stops on a write failure. Browser restart leaves saved events intact and capture paused until Start recording (the demo launcher explicitly starts it). An installed native context host connects recording to the configured cloud providers; without it the recorder continues locally. This profile is separate from your everyday browser.

```sh
pnpm verify:recording        # real-browser recording, privacy, pause, restart, retention, clear, export
pnpm verify:recording --raw  # same checks against the unpacked source extension
```

The checks write synthetic evidence to `.local/evidence/recording.json`, `recording-export.json`, and `recording-monitor.png`. They use a temporary isolated browser profile and remove it afterward.

## Instruction-driven skills

Open **Skills** from the extension or recording monitor. A skill opens its saved websites in tabs in the existing Chrome window; the current tab does not need to be its starting page. Newly learned workflows retain the first observed page address without query strings or fragments. Earlier skills default to their original site's root; edit the address under **Websites and workflow** when the task starts at a different path.

Give an **Instruction for this run** describing the result and where its data should come from. For example: “Use the team and weekly total on the source dashboard to preview the report for the previous calendar week.” The configured context model resolves each field from that instruction, the visible text of the listed pages, available selection options, the current date/timezone, and any clarification answers. Fields no longer all require manual entries. Optional input overrides remain available. If a required fact is missing or ambiguous, or a workflow encounters an issue, the skill pauses and shows a help prompt at the top of its page. Your answer becomes context for the running agent. You can minimize the prompt to fix the page, then continue. Unavailable providers pause the run before entering an inferred value. Checks after an action never automatically repeat that action; you can also stop the run from the prompt. The Skills library provides the same question when a page cannot display the prompt.

Under **Websites and workflow**, list the starting URL followed by any source pages. To perform actions on another site, append another learned skill's steps and save the combined workflow. Review and activate it after changes. A workflow supports up to eight pages and 48 steps, with each step assigned to its own website. Execution follows those reviewed steps; the instruction controls the input data rather than generating arbitrary browser actions. Redirects to unlisted origins stop the run. Sign in to required sites before running.

Skill instructions and bounded visible text from the listed websites are sent to the configured model through the existing native host. Password, payment, marked-sensitive and editable field contents are excluded from source reads. Website addresses and saved instruction templates stay in the local skill library. Clarification answers are removed from session run state when the run ends. Stop prevents later steps; completed effects remain. Review pages or downloaded artifacts to confirm results.

```sh
pnpm build:extension
pnpm install:context-host --runtime-only  # update installed host; preserve credentials
pnpm exec tsx scripts/verify-skills.ts   # isolated real-browser execution; model stub for reasoning checks
```

The separate Agent playback panel has been removed. Use skills for instruction-driven workflows.

## All open tabs and next-action predictions

Observation now covers HTTP and HTTPS tabs in the browser where this extension is installed. The fixed localhost origin and execution-tab assignment no longer restrict passive observation. Incognito and browser-internal pages remain excluded. Rebuild/reload the extension at `chrome://extensions` and allow its HTTP/HTTPS site access when Chrome requests it. The standalone source extension and the WXT build both declare these permissions.

While recording is enabled, the extension inventories up to 200 recent supported tabs, reads each tab's title, up to three headings, and a 1,200-character visible-text excerpt, and shows read status in the monitor. Existing tabs receive the content script without requiring a page reload. Inventory refreshes on tab changes, during monitor polling (at most once every five seconds), and through the extension's periodic alarm. Password/payment/editable/marked-sensitive elements are excluded from excerpts; printed page content can still contain personal information. In live mode these tab summaries are sent to the configured context model alongside action metadata and Snap signals.

Interaction events are retained from the active tab in the focused browser window. Screenshots follow that active tab on any HTTP/HTTPS origin, with editable/sensitive elements and iframes masked. Background tabs contribute text summaries instead of screenshots. The standalone runner observes its own Chrome profile. Install the native context host below to connect your main Chrome profile directly.

The context model now returns a **next-action guess**: kind, description, target tab ID, confidence, and supporting event IDs. The monitor displays it below the current task. Unknown evidence IDs and invented target tabs are rejected. A tab/origin switch may continue the same task; a confirmed semantic topic change archives the active task and starts another. Idle periods, tab changes, completion and observation-session restarts do not erase the task history. Guesses do not execute browser actions, and confidence is not calibrated accuracy. Synthetic mode explicitly reports that no real prediction was made. Authentication failures are visible in the monitor.

The recorder rotates its oldest events at the 2,000-event cap so observation can continue; storage failures still pause capture. Clear removes tab summaries and recorded events as well as the connected brain's derived context. Exports and stopped-runner log files are managed separately.

```sh
pnpm build:extension
pnpm verify:all-tabs        # two origins, background summaries, field exclusion, pause, rotation, clear
pnpm verify:all-tabs --raw  # same checks against the source extension
```

## Visual context and interval assumptions in main Chrome

```sh
pnpm build:extension
pnpm install:context-host
```

The installer reads this folder's `.env`, validates the selected providers, and installs a Chrome native messaging host restricted to this extension. It copies only the required model settings to an owner-only configuration under `~/Library/Application Support/Cobrowser/context-host`. Rerun the installer when keys or model settings change. Chrome launches the host automatically; no separate browser runner is needed. Reload the unpacked extension from `apps/extension/.output/chrome-mv3`, open **Open live recording monitor**, and press **Start recording**.

While a supported web page is focused, the extension captures a masked screenshot about every 10 seconds. Snap supplies narrow visual signals; Gemini Flash summarizes up to two chronological screenshots. The rolling context model receives that summary, normalized movement samples and click/scroll/control-key counts, plus bounded before/after DOM snapshots. “Before” is the preceding observation of the same tab and origin; the first observation has no baseline. Background tabs provide text summaries. Intervals can run slower when a model is busy or Chrome suspends its worker.

The monitor shows the current processing stage and **Context assumptions over time**: timestamp, tentative intent, confidence, concise evidence explanation, likely next action, image summary, motion counts, and expandable DOM snapshots. These are model conclusions, not hidden reasoning, and can be wrong. The latest 30 assumptions are retained (12 displayed), filtered to 24 hours. Task retirement removes stale context from subsequent model input while retaining the full task action history locally.

Inputs, editable regions, marked sensitive regions and iframes are masked in screenshots; typed values and printable keys are excluded. Ordinary visible page text can still contain personal information. Raw screenshots stay transiently in extension/host memory and are sent to the configured cloud image models; they are not saved in extension storage or exports. DOM excerpts, movement metadata, image summaries and assumptions are saved in unencrypted local extension storage and included in exports. Pause stops capture; Clear removes the saved data and connected brain state. The screenshot API requires the manifest's all-sites host permission; runtime capture remains limited to non-incognito HTTP/HTTPS tabs.

```sh
pnpm verify:visual-context  # isolated real browser + native host, synthetic model responses
```

## Learn and repeat skills from the extension toolbar

Rebuild with `pnpm build:extension` and reload **apps/extension/.output/chrome-mv3** at `chrome://extensions`. Open Cobrowser from the Extensions toolbar to see **Your skills** and **Suggested from your activity**. A full library is linked from the popup and recording monitor.

1. Choose **Start learning** in the toolbar popup and complete a supported workflow once.
2. A completed attempt can become a skill immediately. The context model can accept/reject reuse, provide a concrete name, confidence and explanation, and cite the actual evidence. When the model is unavailable, a conservative local assessment accepts supported named actions with an observed page change or native form submission. The UI labels the assessment source; confidence is a policy estimate, not calibrated accuracy.
3. Accepted skills are saved automatically, inactive, under **Your skills**. Use **Rename → Save name** to change the default title. Empty, unsupported, unsafe and unobserved sequences are excluded; each site/outcome gets one skill. Deleting a learned skill also prevents recreation from the same outcome history.
4. Review the steps, check the review box, and activate the skill. Open its starting page, provide the requested inputs and choose **Run skill**. Replay opens a separate tab and checks for an observed result action. Activation and execution remain explicit user actions.

Discovery uses complete sequences of 1–12 supported actions, not arbitrary overlapping click windows. Named form inputs become explicit parameters without retaining recorded values. Repeated attempts are deduplicated, and are never a prerequisite for a first skill. Earlier saved skills remain available if their actions and result evidence are valid.

Replay supports uniquely labeled buttons, same-origin links and explicit input/select parameters. Missing, ambiguous, covered, sensitive and unsupported controls stop the run. Known irreversible-action labels and unsupported form submissions block activation or execution. These checks are bounded heuristics, not general proof of arbitrary site safety. No automatic activation, retries after dispatched actions, or background scheduling is enabled. Stop prevents subsequent dispatches; completed effects remain. Worker interruption is reported and never automatically resumed. Agent input is excluded from human demonstrations.

Skills are stored separately in unencrypted extension local storage (maximum 30 saved entries). They contain control labels, derived steps and bounded evidence references; clearing raw recordings leaves deliberately saved skills in the library until **Delete skill**. Full local action history is retained until explicit deletion; only the live monitor window expires after 24 hours. This local replay path does not publish or promote skills into the versioned verifier-backed registry, and finished runs require an observed page-content change or uncancelled native submission after the result action. A submission is evidence of the action, not proof of a completed or correct download. This is evidence of an effect, not independent proof of task correctness. No observed change is reported as a failed run. Blank inputs and empty skill names are rejected.

```sh
pnpm verify:skills          # real isolated browser, synthetic site; no provider calls
pnpm verify:skills --raw    # same flow with the source extension
pnpm verify:report-skill   # actual reporting fixture: repeated exports, learning progress, replayed CSV bytes
```

The check records actual examples, saves/reviews/activates through the toolbar UI, verifies parameterized replay against page output, checks typed-value exclusion and agent exclusion, rejects no-op demonstrations and replay, verifies renaming and dismissal, blocks empty legacy skills, and checks failure before dispatch when a target is missing. Evidence is written under `.local/evidence/skills.json` and `skills.png`.

## Rolling context brain: Snap + Gemini Flash (SubQ Preview selectable)

The context pipeline is implemented in `packages/context-brain/` and `packages/model-adapters/context.ts`:

- **SubQ Snap (`subq-snap-1.1`)** classifies images and narrow action questions: screen change, task relation, editing/navigation/submission/inspection, visible task affordances (such as reporting/search/editing), and visible workflow state. It returns typed evidence signals, not a generated task narrative. See the [Decisions API](https://docs.subq.ai/endpoints/decisions-api/).
- **Gemini Flash** currently owns the recursive context update: previous compact summary + recent events + Snap signals → tentative intent, replacement summary, confidence, cited evidence, and continue/new-task/uncertain/completed. Set `CONTEXT_PROVIDER=gemini` (default), `GEMINI_API_KEY`, and `GEMINI_MODEL` (default `gemini-3.8-flash`) to use structured output on the [Gemini API](https://ai.google.dev/gemini-api/docs/structured-output). To switch back after approval, set `CONTEXT_PROVIDER=subq`; that uses `subq-preview` on the [SubQ Chat Completions API](https://docs.subq.ai/endpoints/chat-completions-api/) with strict structured output, `store: false`, and reasoning effort `none` for short rolling updates.
- Pointer movement and scrolling alone take a local path with no model calls, except when a new visual observation interval is available. Meaningful action batches go through the selected context model. Action-only Snap analysis is bypassed after three measured calls when its average latency exceeds the context model's; images always go through Snap, and pending task candidates force corroboration. This is a routing heuristic, not a claim that one provider is universally faster.

The model receives a bounded recent window (12 events / 90 seconds), the current rolling summary, and up to six relevant older actions retrieved from the active task. A model `historyQuery` triggers one additional retrieval/update call when an older detail is needed. Only supplied evidence IDs are accepted, and every update must cite a fresh event. The full history is retained locally rather than appended to each prompt.

Task histories persist across host restarts in private, unencrypted JSONL files under `~/Library/Application Support/Cobrowser/context-history/<profile-id>/tasks.jsonl`; the standalone live runner uses `.local/context-brain/task-history`. Histories include filtered actions, rolling summaries and DOM/image-summary interval metadata, never raw screenshot bytes or typed field values. The extension separately archives captured actions in IndexedDB and feeds the native host an acknowledged backlog, so the monitor's rotating live window is not the transport or history limit. Export JSON includes the full locally retained action archive.

Only a confirmed semantic topic change archives the current task: two matching candidate intents with context confidence ≥ 0.8 and Snap different-task confidence ≥ 0.8. The new history starts at the first candidate's actions; the old history keeps its preceding actions. Archived tasks remain on disk, are inspectable in the local JSONL, and are excluded from retrieval for the new task. Idle time, completion, tab changes and new recording sessions preserve task history. Clear saved data deletes the local action archive and clears the connected native task histories on its next message. This changes the former 24-hour working-memory retention policy; saved skill entries and separately exported files are managed independently.

The recorder now also samples normalized mouse coordinates (at most once per second) and control keys: Tab, Enter, Escape, Backspace, Delete, and arrows. It excludes printable keys and typed values. In the browser brain runner, screenshots follow the active, focused HTTP/HTTPS tab; editable/sensitive elements and iframes are masked. Screenshots are sampled every four seconds and after meaningful actions; changed frame hashes trigger reassessment even without clicks. Unchanged periodic frames produce no provider calls. At most two timestamped frames go to Snap. Images stay in memory; only hashes and timestamps reach local logs. The context model receives action metadata and Snap signals, without screenshots. Native desktop capture is not wired into this runner.

```sh
pnpm build:extension
pnpm brain:demo             # terminal-only synthetic task changes and context retirement
pnpm brain:preview          # visible browser + real recorder input + synthetic model responses
pnpm verify:brain           # headless browser/monitor check; synthetic model responses
```

The recording monitor now shows the current intent, summary, confidence, retired-context count, provider timings, and a decision log. Synthetic mode is explicitly labeled and does not call either API. To use the actual providers, export private shell variables (scripts do not automatically load `.env`): `HARNESS_CLOUD_ENABLED=1`, `SUBQ_API_KEY`, and `GEMINI_API_KEY` for the default Gemini configuration, then run:

```sh
node --env-file=.env --import=tsx scripts/context-brain.ts --record
# Or analyze a recorder export without screenshots:
pnpm brain --input /absolute/path/to/recording-export.json
```

Live mode makes billable cloud requests. Keys stay in the Node runner and never enter extension storage or logs. Missing credentials fail startup; provider failures remain explicit and never fall back to synthetic responses. Provider responses are schema-checked; truncated context-model output, unknown evidence IDs, model mismatches, and invalid Snap choices are rejected.

Use one standalone brain runner at a time. It uses `.local/context-brain-profile`, separate from your everyday Chrome profile. The monitor state and journal remain bounded diagnostic snapshots in `.local/context-brain/`; durable task history is stored separately as described above and restores its active rolling summary after restart. A disconnected feed is marked in the monitor; it does not delete stored task history. Already expired or rotated evidence from older versions cannot be recovered.


## Setup

Tested on Apple silicon macOS 26.5.2, Xcode command-line Swift 6.3.3, Node **24.13.0**, pnpm **11.25.0**, Playwright **1.65.0**, bundled Chrome for Testing **158.0.8127.18**. Dependencies are exact-pinned in `package.json` and `pnpm-lock.yaml`. `.node-version` selects Node; pnpm itself ran under a separate bundled Node 24.22.1 on the original machine. Docker is absent. Use a Node version manager and Corepack or an existing pnpm installation; this repo does not install global tooling.

```sh
cd /Users/tolui/Documents/GitHub/cobrowser
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
