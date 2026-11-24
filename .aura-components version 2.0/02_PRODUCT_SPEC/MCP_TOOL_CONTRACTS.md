# MCP tool contracts and product surface

## Design rules

- Tool names must be descriptive, stable, and grouped by workflow.
- Each tool solves one clear job. Avoid broad "do everything" tools.
- Every schema has validation, documented defaults, explicit limits, and deterministic error behaviour.
- Tool descriptions should be short enough to scan, but specific enough that an agent can select the right tool.
- Default outputs should be compact and progressively expandable.
- Do not expose a large full-code field by default.
- Provide structured output schemas where the MCP implementation and clients support them; retain a plain-text summary where helpful.
- Keep the tool registry deterministic and test it against the documented inventory.

## Suggested first-party workflow

### Start and discovery

- `aura_status` — health, supported surfaces, data freshness and current free-only policy.
- Existing search tools remain the catalogue entry points.
- Optional `aura_capabilities` or help resource may summarise categories and preferred workflows, but do not add it if `aura_status` and docs already cover this adequately.

### Catalogue and comparison

- `aura_search_components`
- `aura_get_component`
- `aura_search_skills` / `aura_get_skill`
- `aura_search_assets`
- `aura_search_design_systems` / `aura_get_design_system`
- `aura_search_all`
- `aura_recommend`
- `aura_related`
- `aura_bundle` / `aura_bulk_fetch` (consider consolidating aliases only with a clear migration path)
- `aura_diff` — compare 2–4 components/options using known fields only.
- `aura_scaffold_page` — build plan and selected component detail references, not an entire website's source by default.

### Design and research

- `aura_plan_design` — brief into a Design Contract.
- `aura_research_search` — compact evidence-card search.
- `aura_research_read` or `aura_research_principles` — selected evidence detail, with source provenance and limitations.

### Motion and quality

- `aura_motion_plan` — design a purposeful motion specification.
- Existing `aura_motion_study` — inspect/record/search real motion evidence; preserve honest evidence boundaries.
- Existing `aura_visual_audit` — extend with responsive viewport checks and defect-oriented output.

### References

- Keep award/reference intelligence if it is genuinely useful and safe.
- Remove external-only `aura_inspo_*` mapping tools; migrate useful reasoning into first-party design, reference and comparison workflows.

## Tool contract template

For every tool document:

1. **Name and purpose** — one sentence.
2. **When to call** — trigger and expected predecessor.
3. **Arguments** — types, bounds, defaults, enums and validation.
4. **Output** — fields and semantics.
5. **Output budget** — maximum items, excerpt lengths, chunks, image/artifact strategy.
6. **Data provenance** — upstream or local source and freshness.
7. **Failure modes** — invalid argument, no match, upstream issue, unavailable browser, truncated result.
8. **Security** — free-only gate, URL validation, untrusted data handling.
9. **Tests** — unit, integration and regression cases.
10. **Compatibility** — whether this is new, changed, deprecated or removed in v2.

## `aura_diff` expected fields

Return only facts available in the selected records. Potential fields:

- title/id/slug;
- category and theme fit;
- external dependencies and framework assumptions;
- fonts and icons;
- approximate source size only when measured consistently;
- available preview/image pointer;
- markup structure/features;
- installation complexity (explain the deterministic rubric);
- known compatibility caveats;
- recommendation and reason based on the caller's brief.

If a field is unavailable for any candidate, label it `unknown` or omit it. Never make up bundle size, runtime cost or visual quality.

## Compatibility policy

Because v2.0 is a major release, the team may remove `aura_inspo_*` public names. Still:

- publish an explicit removed/renamed table;
- update tests, README, setup docs, examples and `llms.txt`;
- remove stale references from `aura_prompt` and tool descriptions;
- provide a migration paragraph showing the equivalent first-party workflow;
- preserve other public tool names and semantics unless a measured design reason requires change.
