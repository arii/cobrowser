# 001: Selected native window capture, not desktop capture

Date: November 7, 2026. Status: capture/lifecycle proven on synthetic fixture; permission revocation and general binding remain open.

`pnpm build:native` builds a macOS 14+ Swift executable. `pnpm probe:browser --headed --native` provisions the selected synthetic browser window and drives pause/resume/exclusion. Build/runtime versions are in the results manifest. See `evidence/native.json` and `evidence/browser-headed.json` for frames and native/extension context.

The helper uses `SCContentFilter(desktopIndependentWindow:)`, never a desktop/display filter. ScreenCaptureKit permission is checked before enumeration/capture and during frame delivery. The probe emits timestamps, dimensions, content scale and hashes only. Pixel buffers are transient and bounded by queueDepth 3; output is sampled at at most one frame/sec. It drops incomplete frames and stops on permission or identity loss. Pause gates callbacks before stopping the stream. Resume rechecks identity/permission; exclusion invalidates the stream until a fresh process starts.

Initial capture failed with CoreGraphics `CGS_REQUIRE_INIT` / `did_initialize`, despite successful window enumeration and permission preflight. See `evidence/native-initial-failure.json`. Initializing `NSApplication.shared` on the main actor with prohibited activation fixed that crash. The callback gate also opens before `startCapture` to avoid discarding a static window's initial complete frame. The observed initial failure is not attributed to an unproven timing hypothesis.

Native `CGWindowID`, owning PID, window bounds in macOS points, and extension window/tab IDs are different namespaces. The spike matches a unique fixture title marker and cross-checks window metadata. This proves a controlled pairing exists, not general authenticated origin binding. Titles are forgeable; Chrome does not expose its native CGWindowID through the extension windows API. Bounds, timestamps and titles alone are ambiguous across duplicate windows. Native capture includes browser chrome, while CDP screenshots exclude it. Explicit 2× native output sizing also differs from CDP screenshot scale.

Decision: retain separate native/browser identifiers and an explicit binding record. Suspend retained content on ambiguity. Before Phase 3, design a user-confirmed window association plus fresh approved-tab/origin context, race-resistant frame gating, sleep/lock handling and masking. The 250 ms title poll cannot guarantee that a newly selected excluded tab never enters a transient buffer. This probe writes no such pixels to disk or cloud and must not be enabled for real observation.

OS permission was already granted. No privacy settings were changed or bypassed. Live denial/revocation/regrant, lock/sleep, window close, CPU/memory/bytes-hour and a 30-minute session are unmeasured; the README gives the manual revocation procedure. Stream errors invalidate the helper, and macOS may terminate/relaunch the responsible app on revocation. Do not claim seamless permission recovery.

Reference: [Apple ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit), checked November 7, 2026; the local macOS SDK and actual compile/run establish the executable API compatibility.
