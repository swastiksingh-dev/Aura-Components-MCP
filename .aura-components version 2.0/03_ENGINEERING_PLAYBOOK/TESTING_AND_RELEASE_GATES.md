# Testing and release gates

## Required local commands

The current package declares:

```bash
npm test
npm run build
npm run verify
```

During v2, add or update commands for lint/type/static checks only if the project adopts them deliberately. Do not add dependencies or CI jobs with no clear benefit.

## Release gates

### Code and contracts

- Full unit and integration tests pass.
- Tool registry matches published documentation.
- Input validation and response limits are tested.
- All removed/changed public tools are documented.
- No unresolved critical/high severity review findings.

### Runtime and packaging

- Clean Node 22+ install.
- Build succeeds and is reproducible.
- `dist/` generated output is current.
- `npm pack --dry-run` contents are correct.
- Tarball installs in a clean temporary consumer project.
- CLI starts and completes MCP initialization.
- Representative tools produce valid responses.

### Security and resources

- Free-only access regression suite passes.
- URL fetch guard/redirect checks pass.
- No secrets in repo, package, logs, test fixtures or release assets.
- Capture timeouts, limits and browser cleanup verified.
- Dependency audit reviewed if dependencies were added.

### Documentation and brand

- README claims match actual release.
- Node version, tool count, links, install instructions and npm command verified.
- Banner alt text and source asset included.
- Video demo captured from actual build; captions/subtitles checked.
- Changelog and migration guide updated.
- Third-party licences and notices complete.

### Release controls

- Version bump to `2.0.0` only after v2 contracts are final and compatibility changes are documented.
- Release branch and tag checked.
- npm/GitHub publish remains a user-approved action.
- Have a rollback plan for package and GitHub release notes.

## Benchmark suite

Create 15–25 reproducible design briefs across varied site types, not just landing pages. For each run record:

- design contract completeness;
- required content coverage;
- component selection relevance;
- functional interaction pass rate;
- horizontal overflow at target widths;
- accessibility checks;
- visual comparison/human rubric;
- motion accessibility and performance checks;
- tool calls and serialized context volume;
- task completion and correction count.

Use the same model/settings/environment for before/after comparisons where possible. Keep results as internal benchmark observations, not universal product claims.

## Optional internal visual score

A starter rubric may be:

- composition and hierarchy: 20;
- visual identity/distinctiveness: 15;
- typography and readability: 10;
- content completeness: 10;
- responsive behaviour: 15;
- accessibility: 10;
- motion quality: 10;
- functional correctness: 5;
- performance: 5.

This is an internal heuristic, not a validated academic metric. Calibrate it with multiple reviewers and task types.
