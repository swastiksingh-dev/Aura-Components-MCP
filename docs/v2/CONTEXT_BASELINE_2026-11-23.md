# Session 2 context baseline

Measured before edits on 2026-11-23 using Node v24.22.3, live Aura/Awwwards
endpoints and the current source handler registry. Raw byte/count measurements
are preserved in:

- [`2026-11-23-session2-before.json`](./2026-11-23-session2-before.json)
- [`2026-11-23-session2-after.json`](./2026-11-23-session2-after.json)

Each file includes per-tool serialized definition bytes, UTF-8 result bytes and
the result bytes after compact JSON serialization. Result rows are not stored
in the measurement record. Token counts are **unknown**; no target tokenizer
was available.

## Tool definitions

The serialized `TOOL_DEFS` list was 17,351 bytes / 35 tools before and 14,977
bytes / 31 tools after (−2,374 bytes, −13.7%). Five external workflow mappers
were removed; `aura_diff` was added. The per-tool before/after definitions are
in the JSON records.

## Representative handler results

Scenarios: component search (`dark pricing`, limit 3; `hero`, limit 10; and
unfiltered limit 50 with `slim:false`), one current top component detail, an
8-ref bundle from search results, 4-ref portfolio scaffold, award sites
(`studio`, limit 5), and visual structure evidence for `https://example.com`
(browser unavailable in this environment). Bytes are UTF-8 bytes of MCP text
payload. The before-run used pretty JSON; the after-run uses compact JSON, so
the before compact column isolates the serialization change.

| Scenario | Before bytes | Before compact bytes | After bytes | Change vs actual before |
| --- | ---: | ---: | ---: | ---: |
| Search small | 10,405 | 8,882 | 6,193 | −40.5% |
| Search normal | 32,066 | 27,085 | 17,854 | −44.3% |
| Search worst (`slim:false`) | 297,116 | 284,568 | 98,205 | −67.0% |
| Component detail | 15,951 | 15,539 | 2,987 | −81.3% |
| 8-item bundle | 95,308 | 89,927 | 23,573 | −75.2% |
| 4-item scaffold | 65,532 | 61,286 | 20,431 | −68.8% |
| Award search | 2,987 | 2,189 | 2,174 | −27.2% |
| Browser evidence | 415 | 298 | 298 | −28.2% |

The worst search remains explicitly opt-in and is now capped to 1,200 inline
source characters per item, with `*_info` and `*_fetch` continuation pointers.
The configured search max in this run was 25 rows despite a requested limit of
50. Component detail, bundle and scaffold omit source by default. Changes apply
to the live result records used for sizing; award corpus freshness/content may
vary between runs.

## Compact JSON measurement

`textResult` now uses `JSON.stringify(obj)` without indentation. On the same
before payloads, compact JSON was:

| Scenario | Pretty → compact bytes | Reduction |
| --- | ---: | ---: |
| Search small | 10,405 → 8,882 | 14.6% |
| Search normal | 32,066 → 27,085 | 15.5% |
| Search worst | 297,116 → 284,568 | 4.2% |
| Detail | 15,951 → 15,539 | 2.6% |
| Bundle | 95,308 → 89,927 | 5.6% |
| Scaffold | 65,532 → 61,286 | 6.5% |
| Awards | 2,987 → 2,189 | 26.7% |
| Browser evidence | 415 → 298 | 28.2% |

Compact JSON preserves parseable field structure; it is not credited with
semantic compression. Most reductions come from metadata-first shaping and
smaller excerpts/source bounds. No token savings are claimed.
