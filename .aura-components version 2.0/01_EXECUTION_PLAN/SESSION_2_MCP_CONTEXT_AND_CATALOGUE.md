# Session 2 — MCP contracts, retrieval and context efficiency

## Outcome

Make Aura much more useful to coding agents while reducing unnecessary tokens and tool-call noise. Improve search and component selection, rationalise tool inventory, and retire the Inspo bridge.

## Read first

- `02_PRODUCT_SPEC/MCP_TOOL_CONTRACTS.md`
- `02_PRODUCT_SPEC/CONTEXT_ENGINEERING.md`
- `02_PRODUCT_SPEC/CATALOGUE_AND_REFERENCE_INTELLIGENCE.md`
- Session 1 baseline and ADRs.

## Work sequence

1. Measure actual tool-list definition sizes and representative result sizes. Capture small, normal and worst-case scenarios for search, detail, bundle, scaffold, awards and browser evidence.
2. Define a consistent response convention: concise summary, key metadata, items, explicit truncation/continuation state, and references to retrieve more detail.
3. Make metadata-first retrieval the default. Full HTML/source, long skills, full DESIGN.md previews and browser artifacts must be explicit and bounded.
4. Add or refine a bounded continuation strategy (cursor/chunk/offset). A local `result_id` handle is optional and must have TTL, memory caps, clear process-lifetime semantics and tests before adoption.
5. Review `textResult` and JSON formatting. Compact JSON may help, but measure tokens/bytes and preserve structured meaning; avoid minifying for its own sake.
6. Use MCP structured output schemas where supported and useful. Preserve text summaries for clients that need them.
7. Remove `aura_inspo_recommend`, `aura_inspo_components`, `aura_inspo_reference`, `aura_inspo_system`, and `aura_inspo_compare` if confirmed as external workflow mappers. Remove dead constants, imports and tests. Preserve valuable reference/award research as first-party capabilities.
8. Rework `aura_prompt` into a Design Contract entry point or a documented compatibility wrapper. Do not leave its second pass dependent on `inspo.recommend`.
9. Implement `aura_diff` for two-to-four component options: compare dependencies, size/weight when measurable, themes, fonts, structure, source quality and compatibility. Return unknown rather than inventing unavailable metrics.
10. Implement catalogue improvements that are testable within scope: typo-tolerant local index/search strategy, skill frontmatter validation, and a preview-cache design. Do not add a vector database just because embeddings are fashionable. Start with exact matching, normalized tokens and BM25/SQLite FTS or an in-memory strategy after evaluating Node 22 support and zero-dependency constraints.
11. Review three starter scaffold recipes (portfolio, SaaS, pricing) from the existing DIRECTION.md. Recipes must remain customisable and not force generic designs.
12. Preserve free-only enforcement, honest no-match behaviour, rate limits and upstream failure semantics.

## Deliverables

- Tool contract catalogue: names, input schema, output shape, limits, cost, source, tests.
- Compact response conventions and measured context baseline.
- Removal/migration note for the Inspo tools.
- `aura_diff` specification and implementation if feasible without compromising stability.
- Search/index and skill validation improvements with tests.
- Updated `PROGRESS.md`.

## Acceptance criteria

- Representative results are materially more compact without losing critical information or provenance.
- Large responses are bounded and provide a clear path to retrieve more.
- No silent result truncation; every limit is declared.
- `aura_diff` never invents unavailable metrics.
- Inspo-specific code and stale instructions are gone or explicitly deprecated.
- Existing component access restrictions remain fail-closed.
- Tool descriptions are concise, distinctive and clear enough for a weak model to select correctly.

## Session 2 prompt

> Execute Session 2 only. Measure current context/output cost before editing. Work from the approved tool contracts. Improve metadata-first retrieval, chunk/cursor behaviour, search reliability and tool descriptions; make `aura_diff` useful; remove the external Inspo mapping surface and decouple `aura_prompt` from it. Preserve free-only and honest-empty semantics. Run regression tests for every changed tool. Do not begin Design Contract/research implementation beyond contract preparation. Update `PROGRESS.md` with measured before/after output sizes.
