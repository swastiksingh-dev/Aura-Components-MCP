# Session 3 — Design Contract

`aura_plan_design` creates a compact planning artifact before component retrieval. It is a deterministic local mapper, not a design model: page-type patterns supply explicitly labeled heuristics, while the brief and optional fields remain the only user-stated facts.

## Contract and certainty

The version `1` response contains:

- `user_stated`: only supplied, bounded inputs (`brief`, optional project type, audience, goals, brand notes, content outline, references, constraints, and stack). Omitted values stay omitted.
- `recommendations`: named design fields, each with `status`, `value`, and `basis`. A missing direction is `unknown` with `value: null`; a page-type recommendation is a heuristic, not a product requirement. Where a field echoes supplied goals, content outline, or brand notes, its status is `user_stated` and its basis names that provenance.
- `open_questions`: unresolved audience, identity, content, and constraint questions. A caller can answer these and call again.
- `recommendations` covers product purpose, content hierarchy, visual direction, layout/composition, typography, colour/tokens, component patterns, interaction, motion intent, responsive strategy, accessibility, and anti-patterns.
- `retrieval_hints`: at most four component categories and a system query. Hints are search inputs, not catalogue results or endorsement.

No audience, brand palette, product capability, price, metric, client, or reference is invented. Generic/unknown project types receive general implementation heuristics and questions rather than a fabricated recipe.

## Limits and next step

Brief: 1–600 characters. Other strings and arrays have explicit caps in the tool schema. Output is one contract, no component code and no catalogue rows. Use `retrieval_hints` with `aura_search_components` and/or `aura_search_design_systems`; compare a small candidate set with `aura_diff`, then request details only for selected IDs. Existing catalogue free-only guards still apply.

The contract is not an accessibility audit, brand approval, user-research finding, or guaranteed implementation. Validate recommendations against actual content, stakeholders, and browser behavior. No tokenizer is used; token counts are unknown.

## Representative fixture coverage

`test/fixtures/design-briefs.json` supplies minimal briefs for developer portfolio, SaaS, editorial article, dashboard, ecommerce storefront, creative studio, and accessible content-heavy page. The test asserts actionable hierarchy/composition, accessibility, retrieval hints where applicable, and that omitted audience/brand facts remain absent and queried.

See [RESEARCH_LIBRARY.md](./RESEARCH_LIBRARY.md) for evidence-card boundaries and failure behavior.
