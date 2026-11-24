# DIRECTION — where Aura-Components-MCP goes next

> Current worktree note (2026-11-23): Sessions 1–5 are complete on `feat/aura-v2-foundation`; source exposes 35 tools. Package metadata is prepared as 2.0.0, but npm `latest` remains 1.7.3; this is not a published v2 release. See [`docs/v2/PROGRESS.md`](docs/v2/PROGRESS.md) for the current release-preparation record. The dated notes below preserve earlier roadmap context.

> v1.7.3 hardens the award layer: 35 tools (29 catalogue + 6 award-intelligence), 275 hermetic + 45 live checks green. One guarded fetch path, plan-based index lifecycle, drift-guarded winners, artifact-honest capture — zero new npm dependencies. This is what comes after.

> Session 2 working-tree update (2026-11-23): 31 tools; retired five external
> Inspo mappers, added `aura_diff`, metadata-first detail/bundle/scaffold,
> offset continuation and skill frontmatter validation. See
> `docs/v2/TOOL_CONTRACTS.md` and `docs/v2/CONTEXT_BASELINE_2026-11-23.md`.
## North star

The fastest free door from an idea to a shippable page: any agent, one install line, honest search, paste-ready answers. Everything below serves that sentence.

## Now (v1.7.x — harden + distribute)

- [x] 29 tools (5 pure `aura.inspo.*` mappers + 2 pure `aura_docs_*` helpers with docs_stamp + live `aura_icon` with auto-fallback and credit-always + `aura_prompt` 6-question 2-pass + facets parity, dedupe, absolute URLs, freeOnly related + scaffold Pro guard, scoped CSS, transparent fallback, macro gate, A/B/blend system choice, contrast warnings; no dead trending tool — per-surface `sort:'trending'` instead)
- [x] v1.7.1 hardening: central access policy, theme-isolated cache, bundle-8 end-to-end, `total` semantics disclosed, malformed-row gate, no-retry 4xx, Node `>=22` with CI matrix 22.x/24.x, dead-code removal, registry-consistency + packaging tests (122 hermetic + 38 live green)
- [x] v1.7.2 award layer (released): 6 tools (search/inspect/blueprint/audit/motion/index), file JSON corpus with winners + watches, native CDP capture/structure/motion, zero npm deps (226 hermetic + 45 live green)
- [x] v1.7.3 hardening (release-ready): guarded URL/IPv6 fetch policy, bounded bodies, plan-based index resume/refresh, drift-guarded winner baselines, normalized URL watches, artifact-honest capture/motion, 49 new hermetic tests (275 + 45 live green)
- [ ] GitHub Release for v1.7.2 (notes: CHANGELOG [1.7.2] — award intelligence, PostgREST escaping, refusal-gate honesty, evidence-scored confidence)
- [x] v1.6.3 quality: honest empty, exact_match, theme reorder, DS content index, kind-aware recall, slim lists, full:true, recommend retry + editorial fill, freshness, overlap + license notes, concat/scope install docs
- [ ] GitHub Release for v1.7.1 (notes: hardening audit — access policy, cache isolation, bundle limits, malformed gate, Node 22) — doubles npm + GitHub surfaces
- [ ] Topics set (11 listed in research) + social preview image (flow hero or animated logo)
- [ ] X launch post (draft in chat) + pin + repo link-back

## Next (v1.8 — reach)

- [x] Star-history + share section in README
- [ ] Registry submissions: PulseMCP, mcp.so, Smithery (tools-list metadata each)
- [ ] `aura_scaffold_page` templates: 3 canned page recipes (portfolio / SaaS / pricing) agents can call with one goal sentence (reviewed in Session 2; deferred because the current scaffold has no recipe branches and generic recipes would force style)
- [x] Skill frontmatter validation: flag available SKILL.md snippets missing `name`/`description`; expose `loadable:false`, or `null` where unavailable

## Later (v2 — depth)

- [x] Bounded one-edit lexical matching over already-fetched candidates; no extra calls or vector database (complete typo recall remains unknown)
- [ ] Preview screenshot cache per component (designed/deferred; see Session 2 contract notes)
- [x] `aura_diff` (2–4 component known-fact comparison; unavailable metrics stay unknown)

## Anti-goals

- No auth, no accounts, no paywall features. No Pro leaks. No invented licenses.
- No framework deps in dist/ (stays one zero-dep bundle).
- No separate AI-only content (Google calls it scaled-content abuse; one README serves people + agents).
