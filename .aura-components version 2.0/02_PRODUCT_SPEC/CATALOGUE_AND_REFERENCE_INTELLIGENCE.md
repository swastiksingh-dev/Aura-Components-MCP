# Catalogue, search and Reference Intelligence

## Preserve the strongest existing foundation

Aura's core value remains free-only access to the public Aura catalogue: components, skills, assets and design systems. Keep the existing honest-empty/no-match behaviour, fallback disclosures, free-only policy and clear provenance.

## Improve selection quality

Search ranking should consider:

- lexical and semantic relevance to the brief;
- component role/category;
- visual theme only as an explicit filter or a ranking signal whose semantics are documented;
- required layout structure and interaction pattern;
- available dependencies and framework compatibility;
- design-system consistency;
- freshness and upstream data quality.

Never describe a ranking signal as a hard filter unless the code actually excludes records.

## Local typo-tolerant search

The current DIRECTION.md identifies a local embed/index direction for search quality. Evaluate in order:

1. Normalisation: case, punctuation, whitespace, common aliases and category synonyms.
2. Token/prefix matching and typo-tolerant fallback.
3. BM25/SQLite FTS or another compact local index if it fits the zero-dependency and persistence goals.
4. Optional embeddings only if evaluation demonstrates a meaningful gain over lexical retrieval and storage/update costs are acceptable.

Do not add a remote embedding API or require a key. Keep upstream search available as a fallback and disclose the source of results.

## Preview screenshot cache

The existing DIRECTION.md proposes preview screenshot caching. Treat it as a bounded optional feature:

- cache key based on stable component ID and source/preview version;
- max age and disk budget;
- explicit cache invalidation;
- no hidden browser requirement for basic search;
- no screenshot returned inline by default unless the client supports image content;
- local path/artifact reference and short visual metadata where image transport is unavailable.

## Component comparison: `aura_diff`

Compare known facts for two to four candidates. Use the Design Contract to explain trade-offs. Do not fabricate visual quality, performance, licence or bundle size.

## Reference Intelligence

Retain award/reference analysis that can extract useful, lawful, high-level observations such as:

- page structure and section order;
- visual tokens and typography hints;
- interaction patterns and motion evidence;
- publicly visible technology hints;
- design opportunities and implementation constraints.

Use references as inspiration and evidence for original work. Do not reproduce proprietary source code, exact page assets, or a site's full distinctive visual identity. Show source URLs and capture dates.

## Inspo retirement

The five existing `aura_inspo_*` tools are mapping utilities between an external Inspo flow and Aura. If they remain external-only and unused in the desired product, remove them in the v2 major release after checking current calls/tests. Preserve genuinely useful functionality as first-party features, not as aliases to an external dependency.
