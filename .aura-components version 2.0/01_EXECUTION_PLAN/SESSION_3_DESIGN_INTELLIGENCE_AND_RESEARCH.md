# Session 3 — Design Intelligence and Research Library

## Outcome

Give AI agents a structured way to think through interface design before selecting components or writing code, and make research useful without flooding the context window.

## Read first

- `02_PRODUCT_SPEC/DESIGN_CONTRACT.md`
- `02_PRODUCT_SPEC/RESEARCH_LIBRARY.md`
- `05_RESEARCH/RESEARCH_BIBLIOGRAPHY.md`
- `05_RESEARCH/RESEARCH_TO_IMPLEMENTATION.md`
- Session 2 tool contracts.

## Work sequence

1. Implement `aura_plan_design` (or the final agreed name) around a concise Design Contract.
2. Require the tool to distinguish user-stated constraints, inferred recommendations, and unresolved questions.
3. Use structured fields for audience, product purpose, content hierarchy, visual direction, layout/composition, type, colour/tokens, components, interaction, motion intent, responsive strategy, accessibility and anti-patterns.
4. Let the contract guide subsequent component/system retrieval; do not make the planning tool return a full page of components or code.
5. Build a small, curated, locally stored research corpus with stable source metadata and clear licences/open-access provenance.
6. Add `aura_research_search` and a compact read/principles capability only if they can be used with small responses. One search result should return finding cards, not PDFs.
7. Store claims with evidence type, method, population/sample where available, date, source URL/DOI, page/section, limitations, confidence and practical implications.
8. Separate empirical observations from design heuristics and generated recommendations.
9. Start with curated papers and public metadata from OpenAlex, Crossref and arXiv. Use publisher/open-access full text only where legally available. Respect licence terms; link to paywalled sources rather than reproducing them.
10. Add provenance and citation tests: every research claim must point to a stored source record.
11. Test the Design Contract with varied briefs: developer portfolio, SaaS, editorial article, dashboard, ecommerce storefront, creative studio, and accessible content-heavy page.

## Deliverables

- Design Contract schema and examples.
- Design planning and research tool contracts.
- Small curated research seed corpus.
- Search/ranking tests and citation/provenance tests.
- Design brief fixture set for future benchmark.
- Updated `PROGRESS.md`.

## Acceptance criteria

- A weak coding model receives a specific and coherent visual direction instead of generic "modern, clean, premium" adjectives.
- The contract is compact, deterministic where possible, and does not invent missing brand facts.
- The model can retrieve a few relevant evidence cards without reading entire papers.
- Research summaries include limitations and links to original sources.
- A recommendation is never presented as proven research unless the source supports it.
- Design planning remains useful even when the research index is unavailable.

## Session 3 prompt

> Execute Session 3 only. Implement the Design Contract and a compact research knowledge layer according to the specs. Prioritise structured decisions, explicit uncertainty, source provenance and low context cost. Do not create a giant prompt or copy full papers. Build a minimum useful curated corpus first, add tests for every source claim, and validate the contract against several different website briefs. Update `PROGRESS.md` and stop before Session 4.
