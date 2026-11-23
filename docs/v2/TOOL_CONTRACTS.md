# Session 2 tool contract catalogue

> The three Session 3 design/research tools are documented in the [Design Contract](./DESIGN_CONTRACT.md) and [Research Library](./RESEARCH_LIBRARY.md). They are deterministic local planning/evidence tools; they do not alter the Session 2 catalogue semantics below.

The exact, ordered public names, concise descriptions and JSON input schemas are
snapshotted in [`tool-definitions.json`](./tool-definitions.json), generated from
`src/tools.mjs`. The table below adds result semantics, caps, upstream cost,
provenance and regression coverage. “Upstream calls” is the normal path; cache
hits can reduce it and retries remain subject to the existing bounded fetch
policy.

## Shared conventions

- Tool results remain MCP text content containing JSON. JSON is compact
  (`JSON.stringify`); parsed fields are unchanged.
- Catalogue search results carry `summary`, `items`, upstream `total`,
  requested `limit`/`offset`, explicit `truncated` (`null` when total is
  unknown), and `next_offset` (`null` when continuation is unavailable/not
  needed). Continue by repeating the same search with `offset: next_offset`.
- Metadata-first detail omits large source fields unless the caller supplies
  `chunk` or `full: true`. Chunk metadata gives `full_length`, `chunks`,
  `chunk`, and `truncated`; use the same tool with each `chunk` index. Full
  retrieval is capped to the first configured chunk per source field; when
  `*_info.truncated` is true, retrieve remaining chunks with `chunk`. For a
  multi-field design system each field has its own cap.
- Free component/asset paths fail closed unless `premium === false`. A Pro or
  ambiguous entitlement never returns its payload. No-match and upstream
  failure semantics remain distinct.
- “Unknown” means unavailable in the selected record; it is not a negative
  claim. Tokens are not estimated here; see `CONTEXT_BASELINE_2026-11-23.md`.

## Contracts

| Tool | Output shape and explicit limits | Cost / source | Tests |
| --- | --- | --- | --- |
| `aura_status` | Counts, freshness, version verdict; freshness fields may be `null`. | PGRST count/freshness requests + cached NPM check; Aura public catalogue. | `catalog`, `version`, `protocol-tools` |
| `aura_search_components` | Ranked metadata; default 5, max configured 25 (absolute 50); short 300-char excerpt; even `slim:false` caps inline source at 1,200 chars/item and returns fetch pointers; offset continuation. | PGRST; free-only Aura components. | `catalog`, `access`, `session2` |
| `aura_get_component` | Metadata/excerpt by default; one bounded chunk via `chunk` or `full:true`; inspect `code_info.truncated`; cap from `AURA_CODE_CHARS`. | PGRST; free-only component. | `catalog`, `access`, `session2` |
| `aura_search_skills` | Metadata + 300-char excerpt; `loadable` true/false/null from available frontmatter; offset continuation. | PGRST; public skills. | `catalog`, `session2` |
| `aura_get_skill` | Metadata + frontmatter validation by default; one bounded body chunk via chunk/full; cap from `AURA_CONTENT_CHARS`. | PGRST; public skill snapshot. | `catalog`, `session2` |
| `aura_search_assets` | Slim asset metadata and license note; offset continuation; commercial filter is explicit and honest. | PGRST; free-only assets. | `catalog`, `access` |
| `aura_search_design_systems` | Metadata/snippets; offset continuation; full DESIGN.md/preview only on detail retrieval. | PGRST; public design systems. | `catalog` |
| `aura_get_design_system` | Metadata/token hints by default; one bounded chunk per content/preview field via chunk/full; configured caps. | PGRST; public design system. | `catalog`, `session2` |
| `aura_search_all` | One result block per surface; each surface retains its own fallback/no-match state and pagination metadata. | Up to four parallel PGRST searches. | `protocol-tools`, `catalog` |
| `aura_recommend` | Up to 3 items per surface; bounded one retry + editorial fallback; commercial note retained. | Up to four PGRST searches + at most one retry/picks call. | `protocol-tools`, `catalog` |
| `aura_install_component` | Component metadata + install plan, dependency/file/font facts and docs stamp. | One PGRST detail. | `catalog`, `docs`, `access` |
| `aura_install_skill` | Skill record + save/load instructions. | One PGRST detail. | `catalog`, `docs` |
| `aura_use_design_system` | System record + token hints, install plan and docs stamp. | One PGRST detail. | `catalog`, `docs` |
| `aura_bundle` | 2–8 per-item results; metadata default; `full:true` opts into bounded source. | 2–8 parallel PGRST details. | `catalog`, `access`, `session2` |
| `aura_scaffold_page` | Ordered build plan, tokens, dependencies, file pointers; metadata-only default; `full:true` opts into bounded first chunks and exposes `tokens_source_truncated`. Component selection stays caller/custom-search driven. | At most one system lookup + up to 8 parallel details (or bounded searches). | `protocol-tools`, `docs`, `access`, `session2` |
| `aura_related` | Up to 3 related items; excludes selected item; free-only for components. | One detail + one PGRST list. | `catalog`, `access` |
| `aura_bulk_fetch` | Per-item result records for components/design systems/assets; metadata-first through shared bundle retrieval. | Up to 8 parallel PGRST details. | `catalog`, `access` |
| `aura_install_asset` | Download/preview pointers, rights note and file plan; no inferred commercial licence. | One PGRST detail. | `catalog`, `access` |
| `aura_categories` | 13 overlapping category counts; overlap note retained. | Up to 13 PGRST counts; cached. | `catalog` |
| `aura_diff` | 2–4 component facts: known theme, dependency flags, fonts, structure, code character count and URLs; unavailable fields explicitly `unknown`. Bundle size, runtime performance and visual quality remain unknown. | 2–4 parallel free-only PGRST details; no extra API/dependency. | `session2`, `access` |
| `aura_prompt` | Compatibility wrapper: draft/questions, then user-customisable final prompt and Aura-only suggested calls. No required recipe or style. | Pure local computation. | `protocol-tools`, `catalog`, `session2` |
| `aura_docs_plan` | Context7 lookup plan and apply steps. | Pure local computation; Context7 call is performed by the client. | `docs` |
| `aura_docs_check` | Pasted excerpt check, max 20,000 chars; reports only known markers/pins. | Pure local computation. | `docs` |
| `aura_icon` | One SVG with licence/credit; upstream response body remains bounded and cached. | CDN requests, bounded fallback chain. | `icon`, live `verify` |
| `aura_version` | Version verdict; registry outage is `latest:null`, not failure. | NPM registry; hourly cache. | `version` |
| `aura_award_search` | Sites/elements/categories/motion; default 5, max 25, offset paging; local corpus first and one polite refresh where existing policy allows. | Local award index + bounded Awwwards fetch. | `award-tools`, `award-index-lifecycle` |
| `aura_award_inspect` | Selected site/element/compare detail; missing evidence remains unavailable/unknown. | Local index + bounded Awwwards detail fetch. | `award-tools`, `award-fixes` |
| `aura_design_blueprint` | Evidence-linked blueprint from 2–5 references; Aura matches stay free-only; unknown evidence disclosed. | Local/Awwwards reference evidence + bounded catalogue lookups. | `award-tools`, `award-output-quality`, `access` |
| `aura_visual_audit` | Browser evidence or explicit unavailable result; artifact paths are returned only when written. URL and local-network guards apply. | Optional Chrome/CDP; no ordinary catalogue dependency. | `award-artifacts`, `award-fixes`, `browser-cdp` |
| `aura_motion_study` | Bounded inspect/record/search output; frame/duration caps and honest browser/ffmpeg availability. | Optional Chrome/CDP/ffmpeg + local motion index. | `award-artifacts`, `browser-cdp` |
| `aura_award_index` | Local status/watch operations and bounded crawl reports; crawl page budget is caller-limited. | Local file writes + polite Awwwards crawl when explicitly requested. | `awards-index`, `award-index-lifecycle`, `award-watches` |

## Inspo bridge retirement

Confirmed from the product spec and actual implementation/tests: all five
`aura_inspo_*` tools only translated third-party Inspo workflow inputs into
further tool calls; they did not own independent reference data. Removed:
`aura_inspo_recommend`, `aura_inspo_components`, `aura_inspo_reference`,
`aura_inspo_system`, and `aura_inspo_compare`.

Migration: use `aura_search_components` / `aura_search_design_systems` to find
first-party options, `aura_award_search` / `aura_award_inspect` for retained
reference evidence, `aura_diff` for known-fact comparison, and
`aura_scaffold_page` for an optional build plan. `aura_prompt` remains as a
compatibility wrapper and no longer calls Inspo. Award/reference capabilities
remain first-party and unchanged.

## Recipe review

The current `DIRECTION.md` lists portfolio, SaaS and pricing as requested
starter recipes, but the source has no three canned scaffold recipe branches.
Session 2 therefore does not invent generic recipe content. Existing scaffold
selection remains brief/search based and accepts caller-selected system and
component refs; new comparison/planning outputs do not force a style.

## Search and preview-cache decisions

- Node 22+ and zero dependencies rule out requiring a third-party search index.
  SQLite persistence is not introduced: no local full-catalogue ingest/update
  contract or measured win justifies the storage and synchronization cost.
- Search remains upstream-first. A conservative one-edit lexical match is used
  only to rank/refuse already-fetched candidates (4+ character tokens), adding
  no network requests. It improves tolerance when an upstream fallback supplies
  a relevant candidate; it does not guarantee typo recall when the API returns
  no candidate. Full typo recall is **unknown**.
- Component snippets are metadata plus bounded local candidates, not an
  exhaustive offline index. Freshness remains upstream/cache-driven.
- Preview screenshot caching is designed but deferred: key on stable component
  id plus source/preview version; enforce TTL, max disk bytes and explicit
  invalidation; keep browser optional; return a path/reference rather than
  inline image data unless image transport is supported. There is no screenshot
  cache implementation or cache-size claim in this session.
