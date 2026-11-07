# page-capture

Source-only TypeScript shared by `apps/browser` (Playwright worker) and `apps/extension` (Chrome extension).
No build, no package.json: both consumers import `../../../packages/page-capture/src/*.ts` directly
(tsx at runtime for the worker, esbuild for the extension).

- `page.ts` runs inside a web page: computes the accessibility tree as `(role, name, value)` nodes and
  captures click / input / change / keydown as raw events. One algorithm, so a demonstration recorded
  in the user's Chrome and a replay snapshot taken by the worker hash identically.
- `coalescer.ts` turns raw events into `(before, action, after)` trace events. The host supplies
  `snapshot()` and `settle()`.
- `types.ts` mirrors `apps/api/cerebral/schemas.py`.
