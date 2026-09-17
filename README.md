# aura-components-mcp

[![npm version](https://img.shields.io/npm/v/aura-components-mcp)](https://www.npmjs.com/package/aura-components-mcp) [![npm downloads](https://img.shields.io/npm/dm/aura-components-mcp)](https://www.npmjs.com/package/aura-components-mcp) [![license: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE) [![node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](./package.json) [![MCP](https://img.shields.io/badge/MCP-stdio-blue)](./dist/server.js)

<p align="center">
  <a href="./flow/index.html"><img src="https://raw.githubusercontent.com/swastiksingh-dev/Aura-Components-MCP/main/assets/site-tour.gif" alt="aura-components-mcp demo: dark WebGL hero, 20 grouped tools, one-minute setup" width="100%"></a>
</p>

> I got tired of opening twenty Aura tabs every time I started a landing page. So I built the MCP server I wanted: every free thing on aura.build, one stdio call away, no account, no key, no browser.

> **v1.6.3** — 20 tools. New `aura_prompt`: need-based prompt in 2 passes (draft + 4 questions, ask user, then copy-paste final). Honest search: zero-overlap fallbacks return `total:0` + `no_match` + `refused_fallback` + suggestions instead of masked popular rows; `exact_match:true` skips fallbacks; recommend auto-retries once then fills from editorial picks; theme reorder-not-drop; design-systems index content/preview_html; kind-aware skill recall; slim lists by default (`slim:false` opts out); `full:true` one-shot bodies; scaffold takes `["732","1364"]` / `[{id}]`; `status.freshness` per surface; per-surface `sort:'trending'` (no dead trending tool). Search facets equal detail facets, skills deduped, token starter + preview-mode warnings, legal asset plans, scoped CSS + chunk `concat` plans, bulk-fetch, one-turn scaffold builds.

Point any MCP client at `dist/server.js` and your agent can search 2,495 free components, read 187 agent skills in full, pull 30,688 assets, and apply 725 DESIGN.md systems. It answers in seconds because there is nothing to log into and almost nothing to download: one bundled JS file, zero dependencies.

Built by [swastiksingh-dev](https://github.com/swastiksingh-dev). Catalogue content belongs to Aura (aura.build, by Meng To / DesignCode). This project is not affiliated with Aura.

## Why I built this instead of using the official MCP

Aura already ships an official MCP at `https://mcp.aura.build/mcp`. It is good at what it does: your Canvases, your projects, publishing, all behind OAuth. This server does the other half. It covers the public catalogue, and it skips the parts that slow an agent down: no OAuth dance, no account, no per-project scopes. A few things the official one does not do:

- `aura_install_component` tells the agent exactly how to paste a component: which CDN scripts it needs, which fonts it references, which file to put it in.
- `aura_use_design_system` hands back a `:root` token starter plus the copy order (tokens first, markup second).
- `aura_categories` shows where the free catalogue is deepest, with live counts; per-surface `sort:'trending'` shows what is new.
- `aura_recommend` builds a starter kit across all four surfaces in one parallel call.
- Everything defaults to free. Pro rows never sneak into results.

## What is inside

- 2,495 free components with HTML/Tailwind source, preview images, tags, and author credit
- 187 agent skills with full SKILL.md bodies (GSAP, Tailwind v4, Anime.js, copywriting, and more)
- 30,688 images and clips with direct CDN URLs at multiple widths
- 725 DESIGN.md systems with tokens, type rules, layout notes, and preview HTML
- 20 tools over stdio, one bundle, 60-second LRU cache (300 keys) with request coalescing, author memo, category-count cache, retries with jittered backoff
- Honest search: AND-phrase misses retry as OR-tokens (2 passes) plus a labeled safety net — but zero title-overlap fallbacks are refused as `total:0` + `no_match` + `suggested_queries` instead of masking with popular rows; `exact_match:true` skips fallbacks entirely
- Agent accelerators: `aura_prompt` (2-pass prompt with user confirmation), `aura_bulk_fetch`/`aura_bundle` (8 details/turn, any of 3 kinds), `aura_scaffold_page` (tokens + system + markup in dependency order), `aura_related`, `aura_install_asset` (license-aware)
- Faceted lists: every component carries `facets { theme, weight, code_chars, needsTailwind, needsIcons, fonts }`; filter `theme: dark|light` server-side

Start with `aura_status`, then `aura_search_all`. That order matters: status confirms the catalogue is reachable, search_all shows which surface has the best match before you spend calls on details.

## Install

Needs Node 18 or newer. No other dependency. Pick one:

```bash
# Option A — from source (GitHub)
git clone https://github.com/swastiksingh-dev/Aura-Components-MCP.git
cd Aura-Components-MCP
npm install
npm run build
node ./dist/server.js
```

```bash
# Option B — npm (once published)
npm i -g aura-components-mcp
aura-components-mcp
```

```bash
# Option C — npx, no install
npx -y aura-components-mcp
```

Then register it in your client. Full per-client steps live in [SETUP.md](./SETUP.md) — Claude Code, Cursor, Codex, Windsurf, OpenCode, Cline, Roo Code, DeepSeek Harness, generic stdio — or click through the animated [launch site](./flow/index.html) ([how it works](./flow/how.html) · [tools](./flow/tools.html) · [compare vs official](./flow/compare.html) · [setup](./flow/setup.html) · [docs](./flow/docs.html)). Launch site with animated explainer: open `flow/index.html` in a browser.

```bash
# Claude Code
claude mcp add aura-components -- node ./dist/server.js
```

```json
// Cursor, Windsurf, and most others (~/.cursor/mcp.json or equivalent)
{ "mcpServers": { "aura-components": { "command": "node", "args": ["./dist/server.js"] } } }
```

```json
// OpenCode (opencode.json) — see https://opencode.ai/docs/mcp-servers
{ "$schema": "https://opencode.ai/config.json", "mcp": { "aura-components": { "type": "local", "command": ["node", "./dist/server.js"], "enabled": true } } }
```

## Demo



<video src="https://raw.githubusercontent.com/swastiksingh-dev/Aura-Components-MCP/main/assets/heart-demo.mp4" controls autoplay muted loop playsinline width="100%">Watch the 10-second flow tour (MP4, 1918x936, ~8MB) — same file as <a href="./assets/heart-demo.mp4">assets/heart-demo.mp4</a></video>

![Animated site tour](https://raw.githubusercontent.com/swastiksingh-dev/Aura-Components-MCP/main/assets/site-tour.gif)

*The flow/ launch site: dark WebGL hero, 20 grouped tools, one-minute setup. `aura_prompt` turns one sentence into a confirmed prompt, `aura_recommend` turns it into a starter kit with links. Full clip in [`assets/`](assets/).*

## The 20 tools

| Tool | What it returns |
| --- | --- |
| `aura_status` | Reachability plus live free counts. Call it first. |
| `aura_search_components` | Free components by text, category, `theme: dark\|light`, sort. Slim rows by default (excerpt + `full_fetch`, no 12KB code dump; `slim:false` for full). `exact_match:true` skips fallbacks (honest empty). |
| `aura_get_component` | One component in full: markup, style block, preview, author, page URL. `full:true` ignores `chunk` for the full body. |
| `aura_install_component` | The same component plus a paste plan: CDN scripts, fonts, steps, file map, chunk `concat` plan when truncated, `css_scope_how`. |
| `aura_search_skills` | Skill metadata (title, description, source repo, views). `exact_match:true` skips fallbacks. |
| `aura_get_skill` | The whole SKILL.md body. This is the one agents actually build from. |
| `aura_install_skill` | Where to save SKILL.md so the agent can load it, plus upstream link. |
| `aura_search_assets` | Images and clips by keyword, media type filter included. Slim rows (no 4K URLs until install). `exact_match:true` skips fallbacks. |
| `aura_install_asset` | Legal drop-in: download + preview URLs, license (all-rights-reserved per [Aura Terms §4](https://www.aura.build/terms)), file path. |
| `aura_search_design_systems` | DESIGN.md metadata: title, description, views, author. `exact_match:true` skips fallbacks. |
| `aura_get_design_system` | Full DESIGN.md content plus preview HTML. |
| `aura_use_design_system` | Token starter CSS plus the order to apply things in. |
| `aura_search_all` | All four surfaces in parallel. Never empties (fallback + suggestions). `exact_match:true` for honest empty. |
| `aura_recommend` | A starter kit for a goal sentence, with links and a short rationale. |
| `aura_categories` | The 13 component categories with live free counts. Counts overlap (see `overlap_note`). |
| `aura_bundle` / `aura_bulk_fetch` | 2–8 details in one call (components/design_systems/assets). Per-item errors never fail the batch. |
| `aura_scaffold_page` | One-turn page build: tokens.css + system preview + markup in order, combined deps + files. `components: ["732","1364"]` or `[{id:"732"}]`. |
| `aura_related` | 3 more-like-this per item. Discovery never dead-ends. |
| `aura_prompt` | Need-based prompt in 2 passes: draft + 4 questions, then copy-paste final. Confirm with user first. |

Every row carries `page_url` (open it to see the design) and `author` where Aura credits one.

## Fallback rules (read this once)

- **Per surface, not global.** `aura_search_all` fans out to four independent pipelines (phrase → OR-tokens → safety net → kind-aware refusal). Mixed outcomes are normal and correct: skills may return `fallback:or-tokens:...` while components return `total:0, no_match:true`. Read `isFallback` / `no_match` on each surface — never assume one flag covers all four.
- **Recommend fills the kit.** If components come back `no_match`, `aura_recommend` auto-retries once with `suggested_queries[0]` (`retried:true, retried_from:<query>`), then falls back to human-grade editorial picks (`editorial_fallback:true`). The starter kit is never left empty on a text goal.
- **Big code in one call.** Search rows are slim excerpts by design. Skip the 3-chunk manual concat: `aura_get_component {id, full:true}` and `aura_scaffold_page {goal, full:true}` return complete bodies (33,897-char component verified in one call). Default stays chunked to protect context.
- **Counts are live upstream.** `aura_status` counts mirror the Aura catalogue right now; `freshness` shows max `updated_at` per surface. Counts only grow when Aura publishes — a freshness bump with flat counts means metadata moved, not new components.

## ✨ Prompt for AI agents — start here

> The fastest way to a shippable page. Two passes, one confirmation.

```text
Pass 1 — agent calls:
aura_prompt { "goal": "dark SaaS pricing" }

Server returns: draft_prompt + 4 questions + next_call.
Agent MUST ask you (theme / sections / system / assets) via native question UI.
```

```text
Pass 2 — agent calls with your answers:
aura_prompt { "goal": "dark SaaS pricing",
  "answers": { "theme": "dark", "sections": ["hero","pricing"],
    "system": "auto-pick", "assets": "no" } }

Server returns: final_prompt (copy-paste) + plan order + suggested calls.
```

Copy-paste starter you can say to any agent:

```text
Check aura_status. Then call aura_prompt with my goal, ask me its 4 questions,
then call it again with my answers and follow its suggested_calls.
My goal: dark cinematic portfolio.
```

Rules baked in: Tailwind `container mx-auto px-4`, hex 50-900, 768px hamburger,
hover scale 1.05 + shadow, Inter 40-60/28-36/14-16, motion <500ms +
`prefers-reduced-motion`, tokens first then markup.
Sources: [tips-for-prompting](https://www.aura.build/learn/tips-for-prompting),
[introduction](https://www.aura.build/learn/introduction),
[design-systems](https://www.aura.build/design-systems).

## How I use it

New landing page, dark cinematic portfolio, SaaS pricing section. The shape is the same each time:

1. `aura_prompt` with the goal sentence. Answer its 4 questions. Copy the final prompt.
2. `aura_recommend` with the goal sentence. Skim the starter kit links.
3. `aura_get_component` on two or three finalists. Read the markup, not just the description.
4. `aura_install_component` on the winner. Follow the file map.
5. `aura_use_design_system` once, before any markup, so tokens land first.

Prompts that work well are in [SETUP.md](./SETUP.md#prompts-that-work).

## Free only, no login

There is no auth in this server. No OAuth, no API key to paste, no account to create. Reads go to the same public catalogue endpoints the Aura website uses. The `premium` flag stays on every component row, free-only is the default, and `aura_install_component` refuses Pro ids instead of guessing. If Aura rotates its public key, set `AURA_SUPABASE_ANON_KEY` and rebuild; nothing else changes.

Optional tuning (env vars, all with defaults): `AURA_TIMEOUT_MS` (12000), `AURA_RETRIES` (2), `AURA_CACHE_TTL_MS` (60000, 0 disables), `AURA_DEFAULT_LIMIT` (10), `AURA_MAX_LIMIT` (25), `AURA_CODE_CHARS` / `AURA_CONTENT_CHARS` (12000), `AURA_FREE_ONLY_DEFAULT` (true).

## Develop

```bash
npm test      # hermetic tests, no network
npm run verify  # 25 live checks against the real catalogue
npm run build   # rebundle src/*.mjs into dist/server.js
```

Layout: `src/config.mjs` holds env parsing. `src/http.mjs` hides timeouts and retries behind an injectable fetch. `src/catalog.mjs` is the deep module (queries, cache, shaping, counts). `src/guide.mjs` turns rows into install plans plus `buildPrompt` (pure 2-pass prompt, same seam for tool + tests + docs). `src/tools.mjs` validates args. `src/protocol.mjs` speaks JSON-RPC. `src/server.mjs` only wires stdio.

## Share

Star it if it saved you a tab or twenty: [github.com/swastiksingh-dev/Aura-Components-MCP](https://github.com/swastiksingh-dev/Aura-Components-MCP). Reposits welcome — see [DIRECTION.md](./DIRECTION.md) for where this is headed.

[![Star History Chart](https://api.star-history.com/svg?repos=swastiksingh-dev/Aura-Components-MCP&type=Date)](https://star-history.com/#swastiksingh-dev/Aura-Components-MCP&Date)

```text
built a free design MCP on aura.build: 2495 components, 187 skills, 30k assets, 20 tools. no login. resources are @MengTo's

npx -y aura-components-mcp
https://github.com/swastiksingh-dev/Aura-Components-MCP
```

## Credits and license

Server code by [swastiksingh-dev](https://github.com/swastiksingh-dev), MIT. Free to fork, use, and sell with. Catalogue text, code, and images belong to Aura and the creators listed in each `author` field; follow Aura's terms for that content. If you fork this, keep the credit line and point people at the original repo.
