# Agent instructions — Aura Components MCP v2.0

Read `.aura-components version 2.0/00_START_HERE.md` first when working on this project. Then load only the active session file and the specific product specs it references.

## General behaviour

- Inspect the actual current repository; documentation may be stale.
- Preserve the user's uncommitted work and never work directly on main.
- Use a bounded plan, implement one cohesive slice, test it, independently review the diff and record the outcome.
- Treat source as truth and generated `dist/` as build output.
- Read `scripts/build.mjs` before moving modules.
- Do not add a dependency without an ADR and user-approved reason.
- Do not invent test results, catalogue data, research claims, licences or benchmark numbers.
- Keep tool outputs compact, bounded, attributable and explicit about truncation.
- Preserve free-only access, URL guards, resource caps and optional browser behaviour.
- No public push, npm publish, release tag or destructive git operation without direct user approval.

## Five-session execution

Follow the five files in `.aura-components version 2.0/01_EXECUTION_PLAN/` in order. Do not silently skip gates or perform all five sessions at once. Update `.aura-components version 2.0/03_ENGINEERING_PLAYBOOK/PROGRESS.md` after every session.

## Code review

A fresh reviewer must inspect the actual diff and report actionable issues with file/line and scenario. The implementer must not mark its own work verified without running relevant tests.
