# OpenCode workflow for free and mixed-capability models

## Principle

Do not ask a free model to understand and rewrite the whole repository in one prompt. Give it a compact project map, bounded task, explicit acceptance criteria and independent verification.

## Session operating pattern

For each of the five sessions:

1. **Explore:** use Plan/Explore to read the relevant files and trace execution. No broad edits.
2. **Architect:** create a short plan with root cause, affected files, risks, interfaces and tests.
3. **Approve scope:** continue with the agreed session boundaries. Stop for a decision only if a public contract or destructive change is unavoidable.
4. **Implement:** one feature or cohesive slice at a time.
5. **Test:** targeted tests first; then regression/build/package checks.
6. **Review:** start a fresh Reviewer subagent with read-only permissions and give it the actual diff.
7. **Fix:** resolve only substantiated findings, rerun impacted tests.
8. **Record:** update `PROGRESS.md`, ADRs, docs and changelog.

## Model assignment

Model capabilities differ and free-model access changes. Do not hard-code model names in the project instructions. Select from models currently available in OpenCode and test their actual tool/coding capabilities.

| Role | Desired capability | Best use |
|---|---|---|
| Architect/Explore | Large context, strong code reading, tool discipline | Repo mapping, root cause and plan |
| Implementer | Reliable code edits and test iteration | One bounded implementation task |
| Reviewer | Strong reasoning, no need to edit | Independent diff review |
| Vision reviewer | Image/screenshot understanding | Visual hierarchy, screenshot and responsive critique |
| Test engineer | Precise code/test reasoning | Regression tests, fixtures and release checks |

A single free model can fill multiple roles, but use a fresh context for independent review. If the available model cannot inspect screenshots, do not ask it to perform visual review by text alone; use measured browser checks or a separate vision-capable reviewer.

## Context discipline

- Read `00_START_HERE.md`, `AGENTS.md`, the current session file and only the directly relevant specs.
- Search for symbols/callers instead of reading every source file repeatedly.
- Ask tools for targeted line ranges or small files.
- Do not paste full test logs when only the failing test name and stack are needed.
- Keep one durable `PROGRESS.md`, concise ADRs and reproducible test commands.
- Summarise important decisions before context compaction/new chat.
- Avoid asking one agent to produce long plans and code and release notes in a single response.

## Example task prompt

```text
Read AGENTS.md and the current session's scope.
Task: [one concrete deliverable]
Before editing: trace the current path, list exact files, explain the root cause and give acceptance criteria.
Then implement only this task. Add regression tests. Run the relevant commands.
Do not touch unrelated features, generated dist files by hand, or user changes.
Return modified files, test evidence, limitations and next step.
```

## Specialised agents

Starter files are supplied in `.opencode/agents/`:

- `architect.md`
- `implementer.md`
- `reviewer.md`
- `test-engineer.md`
- `motion-specialist.md`

Use custom agent frontmatter/config syntax supported by the installed OpenCode version. Keep the reviewer read-only using OpenCode permissions. Do not assume a model ID or capability before checking the current OpenCode model list.

## Reviewer independence

The reviewer gets:

- task objective and acceptance criteria;
- current branch diff;
- tests already run;
- exact public contracts affected.

The reviewer does not get a request to merely approve the implementer's summary. It should look for runtime failures, incorrect assumptions, edge cases, security leaks, context-heavy outputs, compatibility breaks and missing tests.

## Done means verified

Every session report must separate:

- implemented;
- tests run and exact outcomes;
- not tested;
- blocked by environment;
- known limitations;
- next actions.

Never convert an unexecuted command into a claimed passing check.
