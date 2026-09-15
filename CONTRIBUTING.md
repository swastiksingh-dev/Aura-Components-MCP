# Contributing

1. Fork, branch, `npm run build`, `npm test`, `npm run verify` (needs network).
2. Keep tools thin: validation in `src/tools.mjs`, logic in `src/catalog.mjs` / `src/guide.mjs`.
3. Every catalogue change needs a hermetic test in `test/` (stub fetcher, no network).
4. Free-only stays default. Never leak Pro/paid rows or invent licenses.
5. PRs: what changed, which tool, before/after counts. Small PRs merge faster.
