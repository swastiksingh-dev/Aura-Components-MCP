# Research Library — ingestion, evidence and retrieval

## Goal

Turn credible research into small, attributable design and engineering knowledge cards that an agent can retrieve only when relevant.

## Sources

Start with public metadata and lawful open-access material from:

- OpenAlex;
- Crossref;
- arXiv;
- publisher pages and institutional repositories where the paper is openly available;
- W3C and official browser documentation for standards/platform guidance.

Do not scrape paywalled content or ignore publisher licences. When only an abstract or metadata is accessible, label the summary scope accordingly.

## Ingestion pipeline

1. Discover paper metadata.
2. Resolve DOI, canonical URL, version, authors, publication year and licence/open-access status.
3. Obtain only lawful full text or a permitted abstract.
4. Extract sections, figures/tables references and page/section locations when available.
5. Create concise evidence cards.
6. Human-review or verify key claims against source text.
7. Store source, licence, extraction date, parser/version and review status.
8. Index cards for lexical retrieval; add embeddings only if an evaluated optional local solution is worthwhile.

## Evidence-card schema

```json
{
  "id": "stable-source-claim-id",
  "source": {"title": "...", "authors": [], "year": 2026, "doi": "...", "url": "...", "licence": "..."},
  "location": {"section": "...", "page": null},
  "question": "...",
  "method": "...",
  "sample": "...",
  "finding": "paraphrased, bounded claim",
  "evidence_type": "experiment|review|standard|engineering_guidance",
  "limitations": ["..."],
  "confidence": "high|medium|low",
  "practical_implication": ["..."],
  "validation_idea": ["..."],
  "review_status": "verified|needs_review"
}
```

## Retrieval behaviour

- Search returns 3–5 relevant cards by default.
- A card is cited using paper title and original DOI/URL.
- `research_read` returns a selected source summary, not a paper dump.
- Include methodology, sample and limitations when the source provides them.
- Do not turn a finding from one population, device type or design context into a universal prescription.
- Keep generated interpretation separate from the source's actual finding.

## Research quality policy

- Prefer peer-reviewed work, systematic reviews, established standards and primary empirical studies.
- Preprints are useful but labelled as preprints.
- Separate evidence from commercial blogs/opinions.
- Check for retractions, corrections and newer versions when maintaining the index.
- Record publication date separately from access date.
- Store no more copyrighted text than permitted; paraphrase and cite.
