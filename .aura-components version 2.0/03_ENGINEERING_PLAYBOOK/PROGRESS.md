# Aura Components MCP 2.0 — Progress

> The coding agent must update this file at the end of every session. Preserve dated history rather than replacing earlier reports.

## Current status

- Overall status: **Session 1 complete (implementation + local verification); awaiting user review.**
- Active session: Session 1 — Foundation & repository reorganisation.
- Current release base: v1.7.3 (re-verified at start).
- Working branch: `feat/aura-v2-foundation` (created from `main`, commit `b9b8ceed646b754f596219b1a2290e4870eb5996`).
- Worktree: changes are uncommitted on the feature branch. No user work was modified or removed.
- Last verified commit: `b9b8ceed646b754f596219b1a2290e4870eb5996` + Session 1 working-tree changes.

## Session checklist

- [x] Session 1 — Foundation & repository reorganisation
- [ ] Session 2 — MCP intelligence & context efficiency
- [ ] Session 3 — Design Intelligence & research
- [ ] Session 4 — Motion, responsive design & verification
- [ ] Session 5 — Documentation, brand & release readiness

## Latest session report

### Date
2026-11-23

### Completed

**Baseline and audit**
- Recorded branch, commit, Node v24.22.3, npm 11.19.1, package 1.7.3, zero dependencies, file tree and clean/dirty status in `docs/v2/BASELINE.md`.
- Baseline commands: `npm test` 275 pass / 0 fail; `npm run build` exit 0; `npm run verify` 45 pass / 0 fail.
- Traced the request path and mapped all 12 source modules and 35 tool contracts in `docs/architecture/OVERVIEW.md`.
- Re-verified all seven audit leads. Four were confirmed and fixed (themeWord null dereference, asset count semantics, slug-less page URL, version drift); the lock TOCTOU was confirmed and hardened; the Inspo compare mapping is deferred to Session 2; build reproducibility was confirmed and fixed.

**Foundation**
- Added `scripts/bundle.mjs`: `BUILD_ORDER` manifest, LF normalisation, manifest-completeness check, ESM/version guardrails, pure `bundleFrom` seam, `bundleSource`.
- Reduced `scripts/build.mjs` to package-version read + `bundleSource` + file writes.
- Added `test/build.test.mjs`: LF/CRLF byte equality, committed-dist equality (stale-dist gate), guardrails, manifest uniqueness.
- Added root `AGENTS.md` and `.opencode/agents/` starter files (no existing targets were overwritten).
- Added `docs/architecture/OVERVIEW.md`, `docs/v2/BASELINE.md`, `docs/v2/LAYOUT_PLAN.md`, ADRs 0001–0003.
- Added a factual `[Unreleased]` CHANGELOG entry.
- Aligned `SETUP.md` and `llms.txt` from v1.7.2 to v1.7.3.
- No source module was moved; the layout transition plan is staged and starts with the build manifest, which is now in place.

**Confirmed fixes**
- `aura_design_blueprint`: theme extraction now matches the same combined `goal + visualDirection` string it tests. Previously a theme word only in `visualDirection` threw, was swallowed, and dropped every catalogue match.
- `pageUrl("components")`: slug-less rows fall back to `/components?q=<title>` instead of `/component/undefined`.
- `aura_status`: adds `assets_free`/`assets_pro` and `counts_note`; `assets` keeps its upstream-total meaning.
- Award index lock: `openSync(lockFile, "wx")` replaces `existsSync` + `writeFileSync`; live lock → `INDEX_BUSY`, stale/corrupt → remove + one retry, second loss → `INDEX_BUSY`.

### Tests run

| Command | Exact result |
| --- | --- |
| `npm run build` | exit 0; `built dist/server.js (314779 chars) + dist/cli.cjs` |
| `npm test` | **281 pass, 0 fail**, 0 cancelled, 0 skipped (~4.05 s) |
| `npm run verify` | **45 pass, 0 fail** (~12.15 s, live network) |
| `npm pack --dry-run` | exit 0; 8 package files (`LICENSE`, `README.md`, `SETUP.md`, `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`, `dist/cli.cjs`, `dist/server.js`, `package.json`); zero bundled dependencies |
| Tarball install smoke | packed `aura-components-mcp-1.7.3.tgz`, installed in a clean temp project, CLI `initialize` returned `{"name":"aura-components-mcp","version":"1.7.3"}` |

**Fail-before/pass-after evidence**
- A HEAD snapshot (`git archive`) with the new tests copied in produced:
  - `test/catalog.test.mjs`: 58 pass, **2 fail** — `pageUrl never publishes /component/undefined...`, `getStatus freshness keys present...`;
  - `test/award-fixes.test.mjs`: 32 pass, **1 fail** — `blueprint: theme word only in visualDirection still queries the catalogue`.
- The same tests pass on the branch (included in the 281).
- The build line-ending defect was measured directly: committed `dist/server.js` was 312,561 chars / 312,932 bytes LF; the first build emitted 315,562 chars / 315,933 bytes because 3,001 of 4,587 lines were CRLF.

### Not tested / environment blockers

- **Independent subagent review was not completed.** Two attempts failed at the provider layer: `reviewer` hit "Free usage limit reached"; `code-review` hit "Model unavailable: ollama/fastcoder". The implementer performed a manual diff review instead. A fresh reviewer should still inspect the diff before merge if a capable model is available.
- Cross-process award-index lock contention is not integration-tested. Busy/stale behaviour is covered by the existing lifecycle tests; the exclusive-create guarantee is structural.
- Live browser capture/motion paths were not exercised (no Chrome requirement in this session); `npm run verify` only asserts honest `BROWSER_UNAVAILABLE` shapes.
- `npm pack` tarball install was smoke-tested, but not on a second OS/Node version; CI matrix (22.x/24.x) remains the cross-version gate.

### Known risks / limitations

- `freshness.skills` is `null` because the skills table does not expose `updated_at` to the current query. This is reported honestly, not invented.
- README still says 192 skills while the live count is 194; README/brand claims are Session 5 scope.
- Tests are still flat under `test/`; `npm test` uses `./test/*.test.mjs`, so nested test folders are not discovered. The layout plan makes changing the command a precondition for moving tests.
- The award index lock's stale takeover is best-effort: a process that read a stale lock can remove a fresh lock created by a racing process before retrying. Documented in ADR-0003; closing it fully needs a second guard or OS advisory lock.
- `dist/server.js` is regenerated and now LF; Git may warn about CRLF conversion on Windows checkouts, but the committed blob and fresh build are LF and byte-identical.
- `BUILD_ORDER` still holds bare filenames; nested source paths need a manifest path change before any layout move.

### Modified / added files

Modified: `CHANGELOG.md`, `SETUP.md`, `llms.txt`, `dist/server.js`, `scripts/build.mjs`, `src/awards-index.mjs`, `src/catalog.mjs`, `src/tools.mjs`, `test/award-fixes.test.mjs`, `test/catalog.test.mjs`.

Added: `AGENTS.md`, `.opencode/agents/{architect,implementer,motion-specialist,reviewer,test-engineer}.md`, `scripts/bundle.mjs`, `test/build.test.mjs`, `docs/architecture/OVERVIEW.md`, `docs/v2/BASELINE.md`, `docs/v2/LAYOUT_PLAN.md`, `docs/v2/decisions/0001-deterministic-bundler.md`, `docs/v2/decisions/0002-catalogue-page-url-and-counts.md`, `docs/v2/decisions/0003-award-index-lock.md`.

### Next action

1. User reviews the Session 1 diff and decides whether to commit it on `feat/aura-v2-foundation`.
2. If a capable reviewer model is available, run the independent diff review and resolve only substantiated findings.
3. Do **not** start Session 2 until Session 1 is accepted. Session 2 begins with the `aura_diff`/Inspo/retrieval contract work and the flat-test-command change described in `docs/v2/LAYOUT_PLAN.md`.
