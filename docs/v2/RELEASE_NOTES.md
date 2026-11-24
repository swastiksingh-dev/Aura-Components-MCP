# Aura Components MCP — v2.0 release notes

This branch prepares **v2.0.0** for the public launch. It is not published yet:
npm `latest` is still 1.7.3, and `feat/aura-v2-foundation` is pushed to GitHub
with the `v2.0.0` tag.

## Direction for v2.0

Most component tooling starts at the catalogue and returns a wall of results.
v2.0 starts at the brief instead.

1. **Attributed planning.** `aura_plan_design` separates stated facts from
   labeled recommendations and open questions, so the plan is easy to act on
   without blending claims together.
2. **Free discovery, with unknowns left open.** Catalogue search works with no
   account; `aura_diff` compares what is known and says when something is still
   unknown.
3. **Evidence on demand.** Optional Chrome checks measure responsive and
   motion behavior where a browser is available, as evidence, not certification.

The stdio server shape stays the same: zero runtime dependencies, Node 22+,
MIT.

## What changes over 1.7.3

- Design Contract planning, research cards, motion planning and evidence, and
  bounded responsive viewport audits (see CHANGELOG for the full list).
- **Retired:** the five `aura_inspo_*` tools.

## Launch honesty

- "Live" means pushed to GitHub on `feat/aura-v2-foundation`; npm install
  commands are for after 2.0.0 is published.
- Catalogue counts are not stated here; `aura_status` is the source of truth.
