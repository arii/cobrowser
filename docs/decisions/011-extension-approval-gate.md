# Extension activation and execution require native approval

November 7, 2026. Follow-up to decision 010: the extension now consumes the independent local gate. This does not complete the entire project plan.

## Supported workflow

The first supported contract is the synthetic weekly CSV report: an explicitly reviewed team, as-of timestamp and IANA timezone define the previous calendar week independently of the candidate. The oracle dataset covers weeks starting October 19 and October 26, 2026. The UI defaults to the November 7 synthetic task date and labels it accordingly.

A single HTTP localhost reporting page and its observed form descriptors may be submitted. Arbitrary websites, composed workflows and unsupported controls cannot obtain approval. Generic workflow learning, saving and editing remain available, but unsupported workflows stay inactive. Previous active flags are not grandfathered in. This intentionally replaces the earlier review-only activation policy. The user explicitly confirmed that networking must follow the same rule: networking recipes may be saved but manual review cannot enable or execute them without an independent verifier.

## Flow and authority

1. **Verify and activate** submits only a bounded executable projection: skill UUID, configured sites, descriptor steps and saved instruction, plus the separately reviewed report task. Screenshots, recorded values and model conclusions do not enter the gate request.
2. The native host validates requests, constructs and freezes a task-derived suite, and imports the reviewed workflow as an immutable revision. `reviewedImport` binds the projection hash. Imported revisions do not claim a Llama generation or fabricate human observation/demonstration records; provenance is explicitly replay/hand-authored adapter data.
3. A trusted local supervisor launches fresh browser contexts. Browser traffic for the reviewed localhost origin is routed to a supervisor-owned seeded reporting fixture, rather than executing candidate tests against the user's page. The candidate's own descriptor sequence drives browser mouse/keyboard input through the bounded shared interpreter. Actual downloaded bytes and the independent server-side export audit determine the signed result. Ten fixed normal runs must pass.
4. Only an authenticated approved report can atomically promote the revision. Blocked or inconclusive candidates cannot replace an approved active pointer. The extension displays the verdict and enables **Run approved skill** only after approval.
5. Before opening tabs, **Run approved skill** obtains a host-owned run authorization for the exact saved workflow and task. Caller input overrides or changed instructions must match that task. The approved parameter values come from independent date/team logic, with no model guess.
6. Before each descriptor step and debugger input command, the host revalidates the active approval, signature, runtime context, workflow hash and run lease. Local `active` or approval fields are display caches and cannot authorize browser actions. Editing/repairing/deleting/deactivating a workflow revokes its host approval. Cancellation and worker interruption release the run authorization; expired leases stop further execution.

The authority key, registry database and lease state live under `~/Library/Application Support/Cobrowser/skill-registry/<profile-uuid>` with owner-only permissions. The key never enters extension storage, page JavaScript, native responses or logs. This remains the user-authorized unencrypted local development storage mode. Only the installed extension ID can invoke the native host. Separate Chrome profiles receive separate registry namespaces.

## Reproduce

```sh
pnpm build:extension
pnpm verify:extension-gate
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

`pnpm verify:skills` and `pnpm verify:report-skill` now run the gated acceptance check. `pnpm verify:skill-recovery` runs the retry/cancellation runtime unit checks followed by gated acceptance. The older direct `scripts/verify-skills.ts`, `verify-report-skill.ts` and `verify-skill-recovery.ts` are historical tests of the previous generic execution flow; they are not current gate acceptance commands.

The acceptance script packages the real host and dependencies, registers it only inside a temporary Chrome profile, uses the real **Verify and activate** and **Run approved skill** controls, and reads a completed browser download. It asserts ten candidate runs, rejection of unsupported workflows and old active flags, exact input/step binding, revoked approval, and offline-host failure before creating tabs. It removes the temporary browser profile, key and registry. Evidence is `.local/evidence/extension-gate.json`.

To update an already-installed runtime while preserving model credentials:

```sh
pnpm install:context-host --runtime-only
```

Reload the unpacked extension after rebuilding. The native runtime now stages `better-sqlite3`, Playwright and their required resource/native packages; it does not depend on resolving modules from the checkout. New installations still use `pnpm install:context-host` and need the existing provider setup. The verifier itself makes no cloud calls. The Playwright Chromium binary must be installed for this user (`pnpm exec playwright install chromium`).

## Remaining limits

This is a trusted local supervisor and declarative candidate, not an OS/container sandbox. No held-out secret scenario mount, live Llama skill generation or Snap semantic judgment is claimed. Ten repeated normal fixture runs are not the complete mutation matrix. Existing localhost pages are not certified as identical to the supervisor fixture by approval; changed pages may fail or pause safely at execution.

The extension still uses its existing assigned-tab descriptor loop for live execution, with host authorization layered around it. It does not yet use the exact same transport/interpreter module as the candidate runner. The supported adapter maps the same approved descriptors and parameters; general adapter conformance remains work.

Live export response checks remain extension-side observations. A live check failure marks the run failed, but is not accepted as a supervisor-authenticated regression report and does not automatically trigger registry rollback. Decision 010's trusted rollback API/demo still works; supervising actual installed-browser artifacts and routing trusted runtime failures into rollback remain open. A tab is also a shared browser account session, not an account sandbox. This implementation does not claim protection from a same-user administrator tampering with private host files.
