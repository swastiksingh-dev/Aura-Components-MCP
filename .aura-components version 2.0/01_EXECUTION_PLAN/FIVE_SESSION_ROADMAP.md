# Five-session roadmap — Aura Components MCP 2.0

Each session ends with a reviewable checkpoint. Do not start the next session until the previous session's acceptance criteria are checked and `PROGRESS.md` is updated.

| Session | Theme | Primary outcome |
|---|---|---|
| 1 | Foundation & repository reorganisation | A verified baseline, clean architecture map, safer module boundaries, fixed confirmed defects, reliable build/test workflow |
| 2 | MCP intelligence & context efficiency | Smaller and more useful tool contracts, improved retrieval, `aura_diff`, Inspo removal/migration, search/index and result-size improvements |
| 3 | Design Intelligence & research | Design Contract workflow, source-linked research library, non-generic design guidance |
| 4 | Motion, responsive design & verification | Purposeful motion workflow, responsive audits, screenshot/DOM evidence, optional REA-assisted reverse engineering |
| 5 | Documentation, brand system & release | Rebuilt README, banner, launch-video asset package, final tests, migration notes, npm/GitHub release readiness |

## Rules for using the five sessions

- One session may span more than one OpenCode conversation. A session is complete only when its deliverables and tests pass.
- At the beginning of each session, load only `00_START_HERE.md`, `PROGRESS.md`, that session's file, and the specific product specs it references.
- Use a planning agent before implementation; use a fresh reviewer after implementation.
- Commit logical milestones locally on the feature branch if the user wants commits. Do not push or publish without explicit approval.
- Keep a `docs/v2/decisions/` ADR for any significant trade-off.
- Avoid simultaneous edits to the same files by multiple agents.

## Critical path

1. Build and regression-test safety before refactoring.
2. Establish clean interfaces and output budgets before adding more intelligence.
3. Add the Design Contract before adding complex generated motion guidance.
4. Build motion and responsive checks on observable browser evidence.
5. Only write README and launch claims that the shipped implementation and tests can support.

## Definition of v2.0 done

A feature is not done because code exists. It must have:

- a documented contract;
- validated inputs and bounded outputs;
- unit and integration tests;
- appropriate regression coverage;
- clear failure behaviour;
- source documentation and examples;
- an honest limitations section;
- build/package verification where applicable.
