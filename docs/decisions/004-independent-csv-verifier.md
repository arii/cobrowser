# 004: Actual downloaded bytes override a success toast

Date: November 7, 2026. Status: artifact feasibility check passed; production candidate isolation deferred.

Command: `pnpm verify:fixtures`. Evidence: `evidence/verifier.json`. Real local HTTP servers, Playwright downloads, saved CSV bytes and browser screenshots were used. No CSV result was mocked. Wrong-week behavior is an intentionally labeled server mutation, not a learned regression.

The fixture accepts form input and exports its synthetic dataset. Separately, the supervisor oracle derives the previous Monday-to-Monday range from the task's explicit instant and IANA timezone, and chooses rows from an independently authored literal facts snapshot. It imports neither the fixture export implementation nor its dataset generator. This separation catches independent date/row errors; it does not claim independent authorship (one agent built both), secret tests, or adversarial isolation.

Three tasks: red as of November 7 in Los Angeles; blue as of November 2 00:30 UTC in Los Angeles (still Sunday); blue at that same instant in Tokyo (Monday). Expected previous-week starts are October 26, October 19, October 26 respectively. All dates are calendar labels in the named timezone, end exclusive; the interval crossing DST need not be 168 UTC hours.

Each task ran against correct output and wrong-week-demo output. All pages displayed `Export successful`. Three correct artifacts passed and three wrong artifacts failed. The oracle checks exact header/ordered row/team/date/value content; empty, duplicate, extra or wrong-team rows also cannot equal the expected bytes. Trusted server-side audit parameters and artifact hashes are captured in the supervisor report. There is no public fixture reset/admin endpoint.

Isolation is a fresh browser context per case with fixture-only page routing and isolated downloads, not Docker or an OS boundary. Docker is not installed. The server/supervisor are trusted task-local code, and there is no untrusted candidate process yet. The UI form driver is intentionally not represented as the eventual shared candidate skill runtime. No registry approval/promotion logic exists in Phase 0.

Decision: retain an independently maintained expected dataset and task-calendar oracle outside the fixture implementation. Use actual download bytes as a mandatory deterministic gate, and never let Snap or page success override failure. Phase 2 must add separate-owner review, protected supervisor/candidate processes, frozen suites, shared-runtime CDP execution, and authenticated report binding before promotion claims.
