# Session 3 — Research Library

The shipped corpus is a small, curated local seed, not a live OpenAlex/Crossref/arXiv index. It stores compact source metadata and reviewed claim cards; no PDFs or full paper text are returned or stored.

## Tools and output budget

- `aura_research_search({query, limit?})`: lexical matching over claim and source metadata, deterministic score then ID order; default 3, maximum 5 evidence cards.
- `aura_research_read({id})`: one selected card with method, sample/context when known, date, source record, location, limitations, confidence basis, and practical implication. Unknown values remain `null`.
- Search cards link through `detail_ref` and cite their stored source record. Search never returns PDF links as content or article excerpts.
- The corpus is bundled with the server. There is no network ingestion, index refresh, source freshness claim beyond the recorded metadata check date, or user-controlled URL fetching. Additions require source verification and provenance tests.

## Source seed and access

| Stable source ID | Metadata provenance | Access/reuse boundary |
| --- | --- | --- |
| `arxiv-2403.03163` | arXiv API metadata; preprint also identified as NAACL 2025 | Abstract and paper are linked openly at arXiv. The card does not assert a reuse license or copy the paper. |
| `doi-10.1016-j.ijhcs.2024.103257` | OpenAlex and Crossref public metadata | OpenAlex reports closed access and no OA copy. Metadata only; linked to publisher; no finding is returned from this source. |
| `wcag22-reflow`, `wcag22-animation` | W3C WCAG 2.2 Understanding guidance | Publicly accessible official guidance; link to the applicable criterion. This corpus does not assert a reuse license or reproduce the source text. |

Metadata was checked on 2026-11-23. W3C currently shows the Reflow page updated 2026-10-04 and Animation from Interactions updated 2025-09-16. This check does not establish that papers or standards were checked for corrections, retractions, or later versions after 2026-11-23. DOI metadata is not evidence that a source is open access.

## Claim classes and confidence

- `empirical_benchmark_abstract`: a bounded paraphrase of the Design2Code arXiv abstract. It records the reported 484-page benchmark sample and says explicitly that full-paper review has not been done.
- `standard_guidance`: a statement of what the linked WCAG criterion says, not an empirical usability result.
- Aura implementation recommendations are labeled as implications/heuristics, not source findings. Design Contract heuristics are separate from the research cards.

Every returned claim must resolve to a local source ID and include evidence type, method, population/sample when available, date, URL/DOI, section/page where available, limitations, confidence basis, and practical implication. The source IDs and claim source links are tested. Closed-access metadata alone produces no finding card.

## Empty, failure, and detail semantics

An empty search is a zero-match, not an outage. An empty corpus returns `empty_corpus: true` and explicitly advises not to infer research findings; design planning remains available. An unknown detail ID returns not-found. Invalid query/limit is a bad-argument error. The built-in corpus has no runtime network dependency, so upstream outages cannot fabricate evidence or block planning.

The local corpus can only grow by reviewed source records and claims. Future ingestion must retain stable IDs, provider/retrieval date, OA/license status, version, scope, and retraction/correction checks, and must not bypass source terms. Tokenizer measurements are unknown; no tokenizer is used.
