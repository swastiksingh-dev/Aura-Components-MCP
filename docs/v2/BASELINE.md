# Session 1 baseline — Aura Components MCP v2.0

Recorded 23 November 2026 before implementation changes.

## Repository state

| Item | Value |
| --- | --- |
| Branch at inspection | `main` |
| Latest commit | `b9b8ceed646b754f596219b1a2290e4870eb5996` — Merge pull request #4 |
| Package | `aura-components-mcp` 1.7.3 |
| Runtime dependencies | none (`dependencies` absent) |
| Node engine | `>=22` |
| Observed toolchain | Node v24.22.3, npm 11.19.1 (Windows) |
| Worktree | Clean except the supplied, untracked `.aura-components version 2.0/` package |
| Working branch created | `feat/aura-v2-foundation` from `main` |

Repository tree at baseline: `src/` 12 modules, `test/` 20 flat test files,
`scripts/` build/verify/repro, generated `dist/server.js` + `dist/cli.cjs`,
root docs and `assets/`. No `AGENTS.md`, `docs/`, or `.opencode/` existed.

## Command baseline

| Command | Result | Notes |
| --- | --- | --- |
| `npm test` | **275 pass, 0 fail** (~4.1 s) | Hermetic, no network |
| `npm run build` | **exit 0** | Emitted 315,562 chars / 315,933 bytes from a mixed CRLF/LF checkout |
| `npm run verify` | **45 pass, 0 fail** (~14.9 s) | Live catalogue + award validation; network required |

The build output differed from the committed `dist/server.js` (312,561 chars /
312,932 bytes, LF) only by line endings: 3,001 of 4,587 lines were checked out
with CRLF and the build wrote them through unchanged. This is the
reproducibility defect fixed in Session 1.

## Live catalogue counts (observed via `aura_status`)

| Count | Value |
| --- | --- |
| `components_free` | 2,495 |
| `components_pro` | 336 |
| `assets` (all) | 30,688 |
| `assets_free` | 30,688 |
| `assets_pro` | 0 |
| `skills` | 194 |
| `design_systems` | 725 |

`freshness.skills` was `null`; the skills table does not expose `updated_at` to
this query, and `getStatus` records that honestly instead of failing. The
README's "192 skills" line is stale relative to the live 194 and belongs to the
Session 5 README rebuild, not this session.

## Audit leads — re-verified against current code

| Lead | Verdict | Evidence |
| --- | --- | --- |
| `themeWord` null dereference when the theme appears only in `visualDirection` | **Confirmed** | `src/tools.mjs` tested `goal + visualDirection` but dereferenced `goal.match(...)`, which is `null`. The surrounding `catch` turned the TypeError into `auraUnavailable` and dropped every catalogue match. Fixed + regression test. |
| `aura_status` asset counts mix free and premium | **Confirmed semantic gap** | `assets` was unfiltered. Live values happen to be 30,688 free / 0 Pro, so the bug was latent. Added `assets_free`/`assets_pro` and `counts_note`; `assets` keeps its upstream-total meaning. |
| Slug-less component rows produce a malformed page URL | **Confirmed** | `isWellFormedRow` accepts a component with an id and title but no slug; `pageUrl` concatenated `row.slug`, yielding `/component/undefined`. Fixed with a catalogue-search fallback; regression test. |
| Award index lock read-then-write race | **Confirmed TOCTOU window** | `existsSync` + `writeFileSync` allowed two processes to pass the check. Replaced with `openSync(..., "wx")`. Busy/stale behaviour retained; cross-process contention is not integration-tested (documented limitation). |
| `aura_inspo_compare` aggregates incomparable fields | **Deferred** | Session 1 file explicitly assigns this external-mapping concern to Session 2. No change made. |
| Version strings aligned | **Confirmed drift** | `SETUP.md` and `llms.txt` still said v1.7.2 while package/README/dist said v1.7.3. Aligned. |
| Build relies on explicit order + identifier renames | **Confirmed reproducibility gap** | Extracted `scripts/bundle.mjs`, normalised line endings, added manifest completeness + bundle guards, and a stale-dist test. |

## Baseline differences from the supplied plan

- The supplied snapshot says 275 hermetic + 45 live checks; re-verified exactly.
- README says 192 skills; live count is 194. Not changed in Session 1.
- The package described a flat `test/` layout; confirmed, and nested test
  discovery is not currently supported by the `npm test` glob.
- `dist/` is committed (the plan's target layout lists it as generated); this is
  intentional so users can run without building. It remains generated.

## Session 1 changes and verification

See `PROGRESS.md` for the session report and exact post-change command output.
