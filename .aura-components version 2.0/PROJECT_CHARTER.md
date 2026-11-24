# Aura Components MCP 2.0 — Project Charter

## North star

**Move an AI from interface ingredients to intentional, responsive, motion-aware, verifiable web experiences.**

Aura began as a free-only door into the public Aura catalogue. v2.0 should preserve that reliable foundation and add a carefully designed intelligence layer around it.

## Current repository baseline (checked 22 November 2026)

Repository: <https://github.com/swastiksingh-dev/Aura-Components-MCP>

- Main branch commit reviewed: `b9b8ceed646b754f596219b1a2290e4870eb5996`.
- Package version: `1.7.3`.
- Runtime: Node.js `>=22`.
- Runtime npm dependencies: zero.
- README reports 35 MCP tools, 275 hermetic tests and 45 live checks.
- Source currently includes `config.mjs`, `http.mjs`, `protocol.mjs`, `server.mjs`, `catalog.mjs`, `guide.mjs`, `tools.mjs`, `icons.mjs`, `version.mjs`, `awards.mjs`, `awards-index.mjs`, and `browser-cdp.mjs`.
- `scripts/build.mjs` concatenates modules in an explicit order to produce `dist/server.js` and `dist/cli.cjs`.
- Tests currently live in top-level `test/*.test.mjs` files.
- The repository's `DIRECTION.md` already identifies three later v2 ideas: a local typo-tolerant search index, component preview screenshot cache, and `aura_diff` to compare components.

These are a dated baseline, not immutable facts. The agent must re-check the live repository at the beginning of Session 1 and update this snapshot if it has changed.

## Product promise for v2.0

Aura helps an agent:

1. Understand the project brief and produce a compact Design Contract.
2. Retrieve only relevant free components, skills, assets and design systems.
3. Compare options and explain trade-offs.
4. Plan intentional motion and inspect existing motion evidence.
5. Check responsive behaviour and visual defects across viewports.
6. Use sourced design research without loading entire papers into context.
7. Verify implementation rather than trusting its own claims.

## Product pillars

- **Design Intelligence:** brief → Design Contract → component/system recommendations → implementation plan.
- **Context Engineering:** compact responses, selective detail, bounded output, pagination/chunking, stable contracts.
- **Motion Intelligence:** inspect, plan, capture, and check motion behaviour.
- **Responsive & Visual QA:** viewport matrix, screenshots, structural checks, accessible behaviour, defect-oriented reports.
- **Research Intelligence:** source-linked findings converted to practical principles, constraints and test ideas.
- **Reference Intelligence:** retain valuable award-site/reference analysis without depending on an external Inspo workflow.

## Non-goals

- Rebuilding the Aura upstream catalogue.
- Making the MCP server generate an entire finished website on its own.
- Adding a giant prompt, an uncurated database of papers, or dozens of novelty tools.
- Copying sites, source code, visual identities, or protected assets wholesale.
- Making Playwright, Chrome, an API key, or a paid model mandatory for ordinary use.
- Guaranteeing that a launch will go viral. The release can be made clear, demonstrable and shareable; audience response is not controllable.

## v2 release principles

- Major version means public contract changes may occur; document and test them.
- Keep compatible tools where sensible. Remove the five `aura_inspo_*` bridge tools if confirmed to be external mapping-only utilities, and replace their useful underlying decisions with first-party workflows.
- Treat `aura_prompt` as a migration decision: redesign it around the Design Contract or provide a compatibility wrapper, rather than silently leaving an Inspo dependency.
- Dynamic catalogue counts must be fetched live or labelled as last checked; never hard-code stale totals into the brand banner.
- A zero-dependency claim is only valid if the published package and build prove it.
