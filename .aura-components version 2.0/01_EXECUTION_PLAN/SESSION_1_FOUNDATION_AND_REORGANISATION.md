# Session 1 — Foundation, baseline and repository reorganisation

## Outcome

Make the codebase easier to understand and change without breaking the working v1.7.3 behaviour. Establish the v2 engineering foundation before adding new capabilities.

## Read first

- `PROJECT_CHARTER.md`
- `03_ENGINEERING_PLAYBOOK/REPO_REORGANISATION.md`
- `03_ENGINEERING_PLAYBOOK/QUALITY_SECURITY_AND_COMPATIBILITY.md`
- Current `README.md`, `DIRECTION.md`, `package.json`, `scripts/build.mjs`, `scripts/verify.mjs`, all `src/*.mjs`, and test inventory.

## Work sequence

1. Record exact main SHA, branch, Node/npm versions, clean/dirty status, package metadata and current file tree.
2. Run the baseline commands (`npm test`, `npm run build`, `npm run verify`) and record exact exit codes and relevant output. If live checks require network and fail, separate environmental failure from product regression.
3. Map the current request path: process entry → transport → protocol dispatch → tool registry → domain handler → catalogue/browser/upstream code → response formatter.
4. Produce a dependency map and tool inventory. Include the exact public name, args, output shape, side effects, data sources, and test file for every tool.
5. Inspect current code-review leads listed below. Reproduce each issue before changing it.
6. Establish `AGENTS.md`, concise architecture docs, ADR directory, and a `PROGRESS.md`.
7. Reorganise docs and test ownership first. Move source modules only where the build system can be updated and verified safely. Do not perform a cosmetic mass-move.
8. Fix confirmed correctness defects with regression tests.
9. Re-run build, tests, package checks and git diff review.

## Audit leads to re-verify (not assumed production incidents)

- In `src/tools.mjs`, an earlier review identified a possible `themeWord` parsing/null-dereference edge case when a theme appears in `visualDirection` but not in `goal`. Reproduce using current code before fixing.
- `aura_status` asset counts may need to explicitly distinguish free from premium assets. Verify count semantics against access policy.
- Catalogue rows without a valid slug may produce a malformed component page URL. Confirm the current row validator and URL builder.
- Local awards index locking may have a read-then-write race across processes. Establish whether multi-process access is supported; if not, document the single-process boundary or add safe locking.
- `aura_inspo_compare` may aggregate macrostructure, macro and mode as though they were comparable values. Verify and remove this external mapping concern in Session 2 if confirmed.
- Verify all version strings in README, `llms.txt`, setup docs, package metadata and CLI output are aligned. Previous v1.7.2 remnants were observed in an earlier snapshot; check current files rather than assuming they remain.
- Custom concatenation in `scripts/build.mjs` relies on explicit source order and identifier renames. Add guardrails and regression tests before source moves.

## Reorganisation principles

- Prefer clear feature boundaries over many tiny files.
- Keep the public entrypoint and generated `dist/` boundary obvious.
- A module should own one domain or infrastructure responsibility.
- Tool registration should remain thin; domain logic should not be buried in the registry.
- Keep tests discoverable and ensure the test command actually finds nested tests if the layout changes.
- Retain a single documented way to build, test, verify, and package.

## Deliverables

- Baseline report in `docs/v2/BASELINE.md`.
- Updated `AGENTS.md` and `docs/architecture/` map.
- Approved repository layout transition plan.
- ADRs for significant structure/build/test changes.
- Confirmed defects fixed with regression tests.
- A passing deterministic build and test suite, or a precise list of existing blockers.
- Updated `PROGRESS.md` with Session 1 status.

## Acceptance criteria

- No existing uncommitted user work was lost.
- The same public v1.7.3 test cases still pass unless explicitly changed with a documented migration.
- The source-to-dist bundle is reproducible and generated from source.
- No dependency was added merely to simplify refactoring.
- Every confirmed bug fixed has a test that fails before the fix and passes after it.
- New contributors can identify where protocol, tools, catalogue, browser, and reference logic live.

## Session 1 prompt

> Execute Session 1 from `.aura-components version 2.0/01_EXECUTION_PLAN/SESSION_1_FOUNDATION_AND_REORGANISATION.md`. Inspect the current repository and actual worktree first. Do not assume the historical snapshot is unchanged. Establish test/build baselines, map the architecture and tool contracts, re-verify the audit leads, and implement only the safe approved foundation and confirmed fixes. Preserve all existing user changes. Do not start Session 2. Finish with exact test evidence, modified-file list, risks, and an updated `PROGRESS.md`.
