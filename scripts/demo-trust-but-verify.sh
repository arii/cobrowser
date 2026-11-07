#!/usr/bin/env bash
# Trust, But Verify — offline demo runner (no keys, no network for Acts 2 gate).
# Act 3 needs the Playwright chromium binary; Act 4 (live) is NOT run here.
set -u
pass=0; fail=0
say() { printf '\n===== %s =====\n' "$1"; }
run() { if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); fi; }

say "Act 2a: oracle timezone gate (LA-Sunday vs Tokyo-Monday)"
run pnpm exec tsx --test tests/oracle.test.ts

say "Act 2b: Agentverse offline eval (stale-2025 FAILs, weather PASSes)"
run pnpm exec tsx --test tests/agentverse-eval.test.ts

say "Act 3: live local fixture gate (3 pass / 3 blocked)"
run pnpm verify:fixtures

say "RESULT: pass=$pass fail=$fail (expect pass=3 fail=0)"
[ "$fail" -eq 0 ]
