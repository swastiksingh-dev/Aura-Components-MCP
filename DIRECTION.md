# DIRECTION — where Aura-Components-MCP goes next

> v1.6.3 ships it all: 20 tools with `aura_prompt` (2-pass, user-confirmed), honest search (no_match+refused_fallback, exact_match, theme reorder, DS content index, kind-aware skill recall), slim lists, full:true bodies, recommend auto-retry + editorial fill, status freshness, scaffold shapes, overlap + license notes. No dead trending tool — per-surface `sort:'trending'` instead. This is what comes after.
## North star

The fastest free door from an idea to a shippable page: any agent, one install line, honest search, paste-ready answers. Everything below serves that sentence.

## Now (v1.6.x — trust)

- [x] 20 tools (`aura_prompt` 2-pass + facets parity, dedupe, absolute URLs, freeOnly related, scoped CSS, transparent fallback; no dead trending tool — per-surface `sort:'trending'` instead)
- [x] v1.6.3 quality: honest empty, exact_match, theme reorder, DS content index, kind-aware recall, slim lists, full:true, recommend retry + editorial fill, freshness, overlap + license notes, concat/scope install docs
- [ ] GitHub Release per npm version (v1.6.3 notes first) — doubles npm + GitHub surfaces
- [ ] Topics set (11 listed in research) + social preview image (flow hero or animated logo)
- [ ] X launch post (draft in chat) + pin + repo link-back

## Next (v1.7 — leverage)

- [ ] Registry submissions: PulseMCP, mcp.so, Smithery (tools-list metadata each)
- [ ] `aura_scaffold_page` templates: 3 canned page recipes (portfolio / SaaS / pricing) agents can call with one goal sentence
- [ ] Skill frontmatter lint: flag SKILL.md rows missing name:/description: at ingest, surface `loadable:false` so agents skip them
- [ ] Star-history + share section in README

## Later (v2 — depth)

- [ ] Local embed index for typo-tolerant search (no more ilike-only misses)
- [ ] Preview screenshot cache per component (agents see before fetching code)
- [ ] `aura_diff` (component A vs B: deps, weight, theme, fonts) for the compare step agents do by hand today

## Anti-goals

- No auth, no accounts, no paywall features. No Pro leaks. No invented licenses.
- No framework deps in dist/ (stays one zero-dep bundle).
- No separate AI-only content (Google calls it scaled-content abuse; one README serves people + agents).
