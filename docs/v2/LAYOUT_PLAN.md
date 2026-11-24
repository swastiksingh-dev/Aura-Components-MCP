# Repository layout transition plan

Status: **proposed, incremental**. Session 1 deliberately moved no source
modules. The build manifest and stale-dist test now make later moves safe.

## Why not move everything now

`src/` is compact (12 modules) and each module already has one clear domain
responsibility. A cosmetic mass-move would add import churn, make the Session 1
diff hard to review, and risk the hand-maintained concatenation order. The
project rule is: move a module only when the build system can be updated and
verified safely, and when the move buys a real boundary.

## Target layout (from the v2 plan)

```text
src/
  core/       protocol, config, http, server lifecycle
  catalog/    upstream catalogue access, ranking, page URLs
  design/     design contracts, prompts, design-system logic
  motion/     motion plans and motion evidence
  research/   evidence cards, index and retrieval
  reference/  award/reference parsing and index
  browser/    optional CDP/browser adapters
  tools/      registry and thin adapters
  shared/     icons, version, common utilities
test/
  core/ catalog/ design/ motion/ research/ reference/ browser/ packaging/
docs/
  architecture/ decisions/ features/ guides/ research/ v2/
```

## Phased migration

### Phase 0 — foundation (done in Session 1)

- [x] Extract `scripts/bundle.mjs` with an explicit `BUILD_ORDER` manifest.
- [x] Normalise line endings so builds are reproducible.
- [x] Fail the build on unlisted/missing source modules and leaked ESM.
- [x] Add `test/build.test.mjs` (determinism + stale-dist + guardrails).
- [x] Add `docs/architecture/OVERVIEW.md` and ADRs.
- [x] No source module moved; public entrypoint unchanged.

### Phase 1 — tests and docs ownership (Session 2 candidate)

- [ ] Change `npm test` from `node --test ./test/*.test.mjs` to a command that
      discovers nested tests on Windows, macOS and Linux; verify before moving.
- [ ] Move tests domain-by-domain into `test/<domain>/`.
- [ ] Keep the mapping in `docs/architecture/OVERVIEW.md` current.

### Phase 2 — infrastructure modules (Session 2)

Move only low-risk modules with no domain split:

| Current | Target | Preconditions |
| --- | --- | --- |
| `config.mjs` | `src/core/config.mjs` | Build manifest paths support nested files |
| `http.mjs` | `src/core/http.mjs` | Same |
| `protocol.mjs` | `src/core/protocol.mjs` | Same; `dist` version stamp still works |
| `server.mjs` | `src/core/server.mjs` | Entrypoint stays `dist/server.js` |
| `icons.mjs`, `version.mjs` | `src/shared/` | Same |

### Phase 3 — domain modules (Sessions 2–4)

| Current | Target | Notes |
| --- | --- | --- |
| `catalog.mjs` | `src/catalog/catalog.mjs` | Deep module; keep interface stable |
| `guide.mjs` | `src/design/` + `src/catalog/` | Do **not** mechanically split the 42 KB file; split only where tests and change frequency justify it |
| `tools.mjs` | `src/tools/registry.mjs` + adapters | Registry stays thin |
| `awards.mjs` | `src/reference/awards.mjs` | Parser + guarded client |
| `awards-index.mjs` | `src/reference/index.mjs` | Persistence |
| `browser-cdp.mjs` | `src/browser/cdp.mjs` | Stays optional |

## Rules for every move

1. Update `BUILD_ORDER` (or the manifest) in the same commit.
2. Keep `dist/server.js` byte-identical unless source semantics changed.
3. Run `npm run build`, `npm test`, `npm run verify`.
4. Update imports, docs, CI and `.npmignore`/`.gitignore` if affected.
5. Never edit `dist/` by hand; never move it into source.
6. Keep the CLI binary name (`aura-components-mcp` → `dist/cli.cjs`).

## Risks

- Nested build paths require a manifest path change; the current manifest uses
  bare filenames. Do that before Phase 2.
- Nested tests require a test-command change; the current glob misses them.
- A module split that changes the concatenation order can silently change
  identifier-rename scope. The stale-dist and bundle-guard tests catch output
  drift, not semantic drift; keep the existing unit tests per module.
