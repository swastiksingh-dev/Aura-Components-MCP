# DIRECTION — where Aura-Components-MCP goes next

> v1.7.1 is the hardened release: 29 tools, central fail-closed access policy, theme-isolated cache, bundle-8 end-to-end, disclosed counts, malformed-row gate, Node `>=22` with CI matrix 22.x/24.x, 122 hermetic + 38 live checks green. The working tree adds an [Unreleased] award-intelligence layer (6 tools → 35 total, file-based index, native CDP, 201 hermetic + 44 live checks). This is what comes after.
## North star

The fastest free door from an idea to a shippable page: any agent, one install line, honest search, paste-ready answers. Everything below serves that sentence.

## Now (v1.7.x — harden + distribute)

- [x] 29 tools (5 pure `aura.inspo.*` mappers + 2 pure `aura_docs_*` helpers with docs_stamp + live `aura_icon` with auto-fallback and credit-always + `aura_prompt` 6-question 2-pass + facets parity, dedupe, absolute URLs, freeOnly related + scaffold Pro guard, scoped CSS, transparent fallback, macro gate, A/B/blend system choice, contrast warnings; no dead trending tool — per-surface `sort:'trending'` instead)
- [x] v1.7.1 hardening: central access policy, theme-isolated cache, bundle-8 end-to-end, `total` semantics disclosed, malformed-row gate, no-retry 4xx, Node `>=22` with CI matrix 22.x/24.x, dead-code removal, registry-consistency + packaging tests (122 hermetic + 38 live green)
- [x] Award-intelligence layer [Unreleased]: 6 tools (search/inspect/blueprint/audit/motion/index), file JSON corpus with winners + watches, native CDP capture/structure/motion, zero npm deps, 104 new hermetic tests (226 total) + 7 verify checks (45 total) — needs explicit version authorization before publish
- [x] v1.6.3 quality: honest empty, exact_match, theme reorder, DS content index, kind-aware recall, slim lists, full:true, recommend retry + editorial fill, freshness, overlap + license notes, concat/scope install docs
- [ ] GitHub Release for v1.7.1 (notes: hardening audit — access policy, cache isolation, bundle limits, malformed gate, Node 22) — doubles npm + GitHub surfaces
- [ ] Topics set (11 listed in research) + social preview image (flow hero or animated logo)
- [ ] X launch post (draft in chat) + pin + repo link-back

## Next (v1.8 — reach)

- [x] Star-history + share section in README
- [ ] Registry submissions: PulseMCP, mcp.so, Smithery (tools-list metadata each)
- [ ] `aura_scaffold_page` templates: 3 canned page recipes (portfolio / SaaS / pricing) agents can call with one goal sentence
- [ ] Skill frontmatter lint: flag SKILL.md rows missing name:/description: at ingest, surface `loadable:false` so agents skip them

## Later (v2 — depth)

- [ ] Local embed index for typo-tolerant search (no more ilike-only misses)
- [ ] Preview screenshot cache per component (agents see before fetching code)
- [ ] `aura_diff` (component A vs B: deps, weight, theme, fonts) for the compare step agents do by hand today

## Anti-goals

- No auth, no accounts, no paywall features. No Pro leaks. No invented licenses.
- No framework deps in dist/ (stays one zero-dep bundle).
- No separate AI-only content (Google calls it scaled-content abuse; one README serves people + agents).
