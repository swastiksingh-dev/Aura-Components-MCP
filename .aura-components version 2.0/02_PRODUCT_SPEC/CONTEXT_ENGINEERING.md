# Context engineering — protect the model's working memory

## Core problem

MCP context is consumed by both tool definitions and tool results. Repeated calls that return full HTML, full skills, previews, DOM snapshots, network logs or long JSON can crowd out the model's actual task. The host also controls how aggressively tool schemas are injected; the server cannot force every MCP client to implement progressive discovery.

## Required retrieval layers

### Layer 1 — Discover

Return small metadata records: id, title, category, short excerpt, tags, source URL and relevant score/reason. Keep lists small by default.

### Layer 2 — Inspect

Fetch one selected item with bounded detail. Prefer summary fields, dependency list, key tokens and short code excerpts. Support chunk/cursor for long source bodies.

### Layer 3 — Retrieve full detail

Only when the agent explicitly requests it, return complete code, full skill text, large HTML preview or raw browser evidence. Always expose size and truncation details.

## Response pattern

Prefer a stable shape similar to:

```json
{
  "summary": "3 strong matches for a dark editorial portfolio",
  "items": [],
  "total": 3,
  "truncated": false,
  "next_cursor": null,
  "provenance": {"source": "aura catalogue", "checked_at": "..."}
}
```

This is a schema example, not a literal requirement for every tool. Tool contracts may require different fields.

## Budgets

Create per-tool output budgets based on measurements. Candidate defaults to test (not hard requirements):

- Search results: 3–5 concise items.
- Each text excerpt: 300–600 characters unless the task asks for more.
- `aura_recommend`: top 3 per surface only when cross-surface discovery adds value.
- Bundle/scaffold: metadata and file plan first; source body retrieval is explicitly requested.
- Browser reports: top defects and evidence links; raw DOM and screenshot artifacts kept outside model-visible text unless selected.
- Research: 3–5 evidence cards with 1–3 practical implications each.

Tune based on real client/model observations. Report character and estimated token reductions in tests/benchmarks; never claim exact token savings without measuring with the target tokenizer.

## Result handles and pagination

A `result_id` can be useful when an agent needs to query additional details without returning a large payload again. Only implement it when process-local semantics are explicit:

- bounded LRU or similar cache;
- TTL and maximum bytes/items;
- random non-sensitive handle;
- no secrets or credentials in cached objects;
- clear `expired`, `not_found` and `truncated` outcomes;
- documented behaviour after server restart;
- tests for eviction, expiry and concurrent access.

A simple cursor/chunk design may be safer and more portable than server-side handles. Choose the simplest approach that works.

## Progressive discovery

MCP client best practices describe a pattern where the host exposes a lightweight tool-search mechanism and loads full schemas only when needed. Aura should:

- keep descriptions concise and non-duplicative;
- make names and category boundaries predictable;
- publish a machine-readable tool catalogue and examples;
- expose stable ordering and stable schemas;
- avoid pretending that server-side tool search can remove schemas already loaded by a client.

A client may offer native progressive discovery or programmatic tool calling. When supported, use it. If not, compact definitions and results are still valuable.

## Programmatic tool calling

Where the host supports sandboxed orchestration, a multi-step retrieval can fetch metadata, select two candidates, retrieve only those details, compare locally, and return a short decision. Intermediate blobs need not pass through the model. The sandbox must be host-controlled, isolated, authorised and output-limited. This is a client capability, not a feature Aura can guarantee by itself.

## Measure context cost

Add fixtures and scripts that record:

- serialized tool definition bytes;
- response bytes and item counts;
- maximum and p95 response sizes;
- number of calls for common workflows;
- full-detail payload sizes;
- truncated/continued retrieval success;
- representative token counts when a supported tokenizer is available.

Do not optimise by deleting information the agent needs to make a correct decision. Optimise for information density, provenance and progressive access.
