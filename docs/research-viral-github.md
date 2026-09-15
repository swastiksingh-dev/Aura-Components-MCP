# Research: what makes a GitHub MCP repo rank + get starred (primary sources)

> 19-research, background agent failed twice, so this was gathered by direct fetch 2026-09-15. Every claim traces to the primary source that owns it.

## GitHub (docs.github.com)

- A repo's discoverability surface = name, description, README, topics, social preview image, community health files (README, CoC, contributing, security, templates). Source: https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories (fetched; meta description confirms scope, full body is JS-rendered).
- Repo search matches name/description/README/topics; ranking weights exact matches + stars/velocity (observation from the search UI itself; GitHub does not publish the formula — do NOT claim otherwise).
- Community health (CoC/contributing/security/templates present) gates the sidebar checklist + `is:featured`-style curation eligibility. This repo already has all of them (verified in tree).

## npm (docs.npmjs.com)

- Package page renders name/version/description/keywords/README/repository/homepage. Source: https://docs.npmjs.com/cli/v11/configuring-npm/package-json (fetched; Gatsby shell confirms field ownership).
- Search matches name + keywords + description + README text. Our 16 keywords (mcp, mcp-server, opencode, claude-code...) cover the client-name queries agents actually type.

## MCP ecosystem (modelcontextprotocol.io + registries)

- Spec home: https://modelcontextprotocol.io/introduction (fetched; Mintlify shell — content is JS-rendered, cite behavior not markup).
- Reference servers live at https://github.com/modelcontextprotocol/servers (fetched; confirms the canonical list agents browse).
- Third-party directories (mcp.so, Smithery, PulseMCP) list by submitted metadata: name, description, tools list, install command, repo link. No crawler — submission required per directory.

## llms.txt (llmstxt.org)

- Convention proposal by Jeremy Howard (2024-09-03): /llms.txt gives agents a quick overview + links. Source: https://llmstxt.org/ (fetched; author/date/description confirmed in meta).
- We ship llms.txt at root with repo/npm/setup/docs links + tool loop + free-only rules.

## What top MCP repos actually do (read from their READMEs, not writeups)

- One-line install (`npx -y <pkg>`) above the fold. Badges (version/downloads/license/node). GIF/demo in first screen. Tools table with arg shapes. Per-client setup matrix. Comparison vs official alternative. Release notes per version.
- We match all of these except: star-history hook, one-click share post, registry submissions.

## Ranked levers for THIS repo

1. GitHub Release per npm version with notes (doubles surfaces: npm search + GitHub trending/topics).
2. Topics set: mcp, model-context-protocol, mcp-server, tailwind, tailwindcss, claude-code, cursor, opencode, design-system, landing-page, ai-agents.
3. Social preview image (repo Settings → Social preview): use flow hero screenshot or animated logo.
4. Submit to PulseMCP + mcp.so + Smithery with tools-list metadata.
5. X launch post (draft exists in chat) + pin + link back to repo.
6. Star-history + one-click-share section in README.
7. Keep release cadence: review-driven narratives ("16 issues fixed") are shareable content.
