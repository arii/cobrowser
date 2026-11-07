# Agent Contract (low-token guardrails for coding agents)

1. The UI is an Interactive Live Co-Browsing Viewport Canvas with human
   takeover/handback controls. Never build a static dashboard as the main feature.
2. Whole-task commands only: `pnpm dev`, `pnpm lint`, `pnpm test`.
   Never run a package binary directly or guess a targeted variant.
3. Python lives in `services/agent-orchestrator/` (managed with `uv`).
   TypeScript lives in `packages/` (managed with `pnpm`).
4. Python tests live in `services/agent-orchestrator/tests/` and are named `test_*.py`.
5. Secrets go in `.env` (never committed). Only `.env.example` is tracked.
6. Keep every file slop-gate clean: no swallowed exceptions, no unimplemented
   placeholders, no leftover debug logs (see `.agents/scripts/audit-ai-slop.py`).
