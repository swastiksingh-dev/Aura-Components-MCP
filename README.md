<h1 align="center">Aura Components MCP</h1>

<p align="center"><sub>FREE MCP SERVER · STDIO · ZERO DEPS · MIT</sub></p>

<p align="center">
  <a href="https://www.npmjs.com/package/aura-components-mcp"><img src="https://img.shields.io/npm/v/aura-components-mcp" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/aura-components-mcp"><img src="https://img.shields.io/npm/dm/aura-components-mcp" alt="npm downloads"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="license: MIT"></a>
  <a href="./package.json"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="node >= 22"></a>
  <a href="./dist/server.js"><img src="https://img.shields.io/badge/MCP-stdio-blue" alt="MCP stdio"></a>
</p>

<p align="center"><i>Every free thing on Aura, one call away — no account, no key, no browser.</i></p>

<p align="center">
  <a href="https://raw.githubusercontent.com/swastiksingh-dev/Aura-Components-MCP/main/assets/heart-demo.mp4"><b>▲ WATCH THE 10-SECOND TOUR (MP4) ▲</b></a>
</p>

> I got tired of opening twenty Aura tabs every time I started a landing page. So I built the MCP server I wanted: every free thing on aura.build, one stdio call away, no account, no key, no browser.

<p align="center">
  <b>2,495</b> free components · <b>192</b> skills · <b>30,688</b> assets · <b>725</b> design systems<br>
  <b>29</b> tools · <b>0</b> dependencies · <b>112</b> hermetic tests + <b>38</b> live checks green · version-checked hourly against npm
</p>

---


- [Why not the official MCP](#why-i-built-this-instead-of-using-the-official-mcp)
- [What is inside](#what-is-inside)
- [Install](#install)
- [Demo](#demo)
- [The 29 tools](#the-28-tools)
- [Fallback rules](#fallback-rules-read-this-once)
- [Prompt for AI agents](#-prompt-for-ai-agents--start-here)
- [Free only, no login](#free-only-no-login)
- [Develop](#develop)
- [Credits](#credits)

> **v1.7.1** — bug-fix release, no new tools. Central free-only enforcement: Pro components/assets by direct ID are now refused (`-32602`, fail-closed on ambiguous entitlement) instead of returned in full — search, install, bundle, scaffold, and related all inherit it. Search cache isolates explicit `theme` (dark/light no longer share entries). Bundles honor all 8 refs end-to-end with `dropped_refs` disclosure. New `min_views_filtered_out` count (`total` stays upstream). Full icon outages surface as upstream errors, not misses. Upstream hardening: malformed rows disclosed via `malformed_dropped` (single fetch fails loud), non-429 4xx never retried. Node floor raised to maintained releases (engines `>=22`, CI matrix 22.x/24.x). Dead code removed, scaffold merge extracted, verify extended.

> **v1.7.0** — 29 tools: 5 pure `aura_inspo_*` mappers (recommend/components/reference/system/compare) bridge Inspo evidence to Aura calls with zero extra deps — strict macro gate (`need_macro`), palette priority brand > Inspo > Aura, enforced tokens-first, mandated image srcset plan, fast preview-URL look gate — plus 2 pure `aura_docs_*` helpers (plan/check) wiring Context7 fresh docs for tailwind/gsap/lenis/iconify, with `docs_stamp` on every install/scaffold and a look-preserving conflict rule (fresh API wins, look stays identical) — plus live `aura_icon` (Font Awesome Free + HackerNoon pixel SVGs, auto-fallback, CC BY 4.0 credit always) — plus `aura_version` (hourly npm check, prefer-latest notice, verdict inside every `aura_status`). `aura_prompt` now asks 6 questions (+macrostructure, +vibe) and leads Pass 2 with `inspo.recommend`. `aura_scaffold_page` refuses explicit Pro ids (`pro_filtered_out`). Build hardened for CRLF checkouts.

<details>
<summary><b>v1.6.3 changelog (20 tools)</b> — click to expand</summary>

> **v1.6.3** — 20 tools. New `aura_prompt`: need-based prompt in 2 passes (draft + 4 questions, ask user, then copy-paste final). Honest search: zero-overlap fallbacks return `total:0` + `no_match` + `refused_fallback` + suggestions instead of masked popular rows; `exact_match:true` skips fallbacks; recommend auto-retries once then fills from editorial picks; theme reorder-not-drop; design-systems index content/preview_html; kind-aware skill recall; slim lists by default (`slim:false` opts out); `full:true` one-shot bodies; scaffold takes `["732","1364"]` / `[{id}]`; `status.freshness` per surface; per-surface `sort:'trending'` (no dead trending tool). Search facets equal detail facets, skills deduped, token starter + preview-mode warnings, legal asset plans, scoped CSS + chunk `concat` plans, bulk-fetch, one-turn scaffold builds.

</details>

Point any MCP client at `dist/server.js` and your agent can search 2,495 free components, read 192 agent skills in full, pull 30,688 assets, and apply 725 DESIGN.md systems. It answers in seconds because there is nothing to log into and almost nothing to download: one bundled JS file, zero dependencies.

Built by [swastiksingh-dev](https://github.com/swastiksingh-dev). Catalogue content belongs to Aura (aura.build, by Meng To / DesignCode). This project is not affiliated with Aura.

---


Aura already ships an official MCP at `https://mcp.aura.build/mcp`. It is good at what it does: your Canvases, your projects, publishing, all behind OAuth. This server does the other half. It covers the public catalogue, and it skips the parts that slow an agent down: no OAuth dance, no account, no per-project scopes. A few things the official one does not do:

- `aura_install_component` tells the agent exactly how to paste a component: which CDN scripts it needs, which fonts it references, which file to put it in.
- `aura_use_design_system` hands back a `:root` token starter plus the copy order (tokens first, markup second).
- `aura_categories` shows where the free catalogue is deepest, with live counts; per-surface `sort:'trending'` shows what is new.
- `aura_recommend` builds a starter kit across all four surfaces in one parallel call.
- Everything defaults to free. Pro rows never sneak into results.

---


- 2,495 free components with HTML/Tailwind source, preview images, tags, and author credit
- 192 agent skills with full SKILL.md bodies (GSAP, Tailwind v4, Anime.js, copywriting, and more)
- 30,688 images and clips with direct CDN URLs at multiple widths
- 725 DESIGN.md systems with tokens, type rules, layout notes, and preview HTML
- 29 tools over stdio, one bundle, 60-second LRU cache (300 keys) with request coalescing, author memo, category-count cache, retries with jittered backoff
- Honest search: AND-phrase misses retry as OR-tokens (2 passes) plus a labeled safety net — but zero title-overlap fallbacks are refused as `total:0` + `no_match` + `suggested_queries` instead of masking with popular rows; `exact_match:true` skips fallbacks entirely
- Agent accelerators: `aura_prompt` (2-pass prompt with user confirmation), `aura_bulk_fetch`/`aura_bundle` (8 details/turn, any of 3 kinds), `aura_scaffold_page` (tokens + system + markup in dependency order), `aura_related`, `aura_install_asset` (license-aware)
- Faceted lists: every component carries `facets { theme, weight, code_chars, needsTailwind, needsIcons, fonts }`; filter `theme: dark|light` server-side

Start with `aura_status`, then `aura_search_all`. That order matters: status confirms the catalogue is reachable, search_all shows which surface has the best match before you spend calls on details.

---


Needs Node 22 or newer. No other dependency. Pick one:

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
npx -y aura-components-mcp@latest
```

Then register it in your client. Full per-client steps live in [SETUP.md](./SETUP.md) — Claude Code, Cursor, Codex, Windsurf, OpenCode, Cline, Roo Code, DeepSeek Harness, generic stdio.

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

---


<p align="center">
  <a href="https://raw.githubusercontent.com/swastiksingh-dev/Aura-Components-MCP/main/assets/heart-demo.mp4"><b>▲ CLICK TO WATCH THE 10-SECOND FLOW TOUR (MP4) ▲</b></a>
  <br><em>Same file as <a href="./assets/heart-demo.mp4">assets/heart-demo.mp4</a></em>
</p>

*`aura_prompt` turns one sentence into a confirmed prompt, `aura_recommend` turns it into a starter kit with links. Full clip in [`assets/`](assets/).*

---


Start with `aura_status`, then `aura_search_all`. That order matters: status confirms the catalogue is reachable, search_all shows which surface has the best match before you spend calls on details.

### Find

| Tool | What it returns |
| --- | --- |
| `aura_status` | Reachability plus live free counts. Call it first. |
| `aura_search_components` | Free components by text, category, `theme: dark\|light`, sort. Slim rows by default (excerpt + `full_fetch`, no 12KB code dump; `slim:false` for full). `exact_match:true` skips fallbacks (honest empty). |
| `aura_search_skills` | Skill metadata (title, description, source repo, views). `exact_match:true` skips fallbacks. |
| `aura_search_assets` | Images and clips by keyword, media type filter included. Slim rows (no 4K URLs until install). `exact_match:true` skips fallbacks. |
| `aura_search_design_systems` | DESIGN.md metadata: title, description, views, author. `exact_match:true` skips fallbacks. |
| `aura_search_all` | All four surfaces in parallel. Never empties (fallback + suggestions). `exact_match:true` for honest empty. |
| `aura_recommend` | A starter kit for a goal sentence, with links and a short rationale. |
| `aura_categories` | The 13 component categories with live free counts. Counts overlap (see `overlap_note`). |
| `aura_related` | 3 more-like-this per item. Discovery never dead-ends. |

### Fetch (full bodies)

| Tool | What it returns |
| --- | --- |
| `aura_get_component` | One component in full: markup, style block, preview, author, page URL. `full:true` ignores `chunk` for the full body. |
| `aura_get_skill` | The whole SKILL.md body. This is the one agents actually build from. |
| `aura_get_design_system` | Full DESIGN.md content plus preview HTML. |
| `aura_bundle` / `aura_bulk_fetch` | 2–8 details in one call (components/design_systems/assets). Per-item errors never fail the batch. |

### Install & build (tokens first, then markup)

| Tool | What it returns |
| --- | --- |
| `aura_install_component` | The same component plus a paste plan: CDN scripts, fonts, steps, file map, chunk `concat` plan when truncated, `css_scope_how`. |
| `aura_install_skill` | Where to save SKILL.md so the agent can load it, plus upstream link. |
| `aura_install_asset` | Legal drop-in: download + preview URLs, license (all-rights-reserved per [Aura Terms §4](https://www.aura.build/terms)), file path. |
| `aura_use_design_system` | Token starter CSS plus the order to apply things in. |
| `aura_scaffold_page` | One-turn page build: tokens.css + system preview + markup in order, combined deps + files. `components: ["732","1364"]` or `[{id:"732"}]`. |
| `aura_prompt` | Need-based prompt in 2 passes: draft + 6 questions (theme, sections, system, assets, macrostructure, vibe), then copy-paste final. Confirm with user first. Pass 2 leads with `inspo.recommend` + `aura_inspo_recommend`. |

### Bridge (Inspo · fresh docs · icons)

| Tool | What it returns |
| --- | --- |
| `aura_inspo_recommend` | Brief → Inspo + Aura call plan (pure, no fetch). Strict macro gate: no `macrostructure` returns `need_macro:true`. Palette priority brand > Inspo > Aura. |
| `aura_inspo_components` | Inspo component filter → Aura category search + scaffold hint (tokens first, weight s\|m). |
| `aura_inspo_reference` | One Inspo JSX + one Aura component → scoped adapt plan (token swaps, css scope, files). |
| `aura_inspo_system` | Inspo tokens vs Aura DESIGN system → A/B/blend + one `system_choice` question + contrast warning. |
| `aura_inspo_compare` | 2–4 slim Inspo sites → house style + closest Aura system/component queries. |
| `aura_docs_plan` | Fresh-docs lookup plan (pure): library + need → Context7 resolve/query plan (trusted: tailwind, gsap, lenis, iconify) + Aura apply steps. |
| `aura_docs_check` | Pasted code vs fresh docs (pure): verdict current\|needs-update, look-preserving fixes, pin checks. |
| `aura_icon` | One free icon as ready SVG (live): FA Free + HackerNoon pixel lib, auto-fallback, license + credit always, font alternative, 24h cache. |
| `aura_version` | Running vs npm-published version (live, hourly cache). `update_available` + prefer-latest notice. `aura_status` carries the verdict on every call. |
| `aura_version` | Running vs npm-published version (live, hourly cache). `update_available` + prefer-latest notice. `aura_status` carries the verdict on every call. |

Every row carries `page_url` (open it to see the design) and `author` where Aura credits one.

---


- **Per surface, not global.** `aura_search_all` fans out to four independent pipelines (phrase → OR-tokens → safety net → kind-aware refusal). Mixed outcomes are normal and correct: skills may return `fallback:or-tokens:...` while components return `total:0, no_match:true`. Read `isFallback` / `no_match` on each surface — never assume one flag covers all four.
- **Recommend fills the kit.** If components come back `no_match`, `aura_recommend` auto-retries once with `suggested_queries[0]` (`retried:true, retried_from:<query>`), then falls back to human-grade editorial picks (`editorial_fallback:true`). The starter kit is never left empty on a text goal.
- **Big code in one call.** Search rows are slim excerpts by design. Skip the 3-chunk manual concat: `aura_get_component {id, full:true}` and `aura_scaffold_page {goal, full:true}` return complete bodies (33,897-char component verified in one call). Default stays chunked to protect context.
- **Counts are live upstream.** `aura_status` counts mirror the Aura catalogue right now; `freshness` shows max `updated_at` per surface. Counts only grow when Aura publishes — a freshness bump with flat counts means metadata moved, not new components.
- **`total` means upstream matches** (for limit/offset paging), not post-filter rows. Local drops are disclosed, never silent: `min_views_filtered_out`, `negative_theme_filtered_out`, `deduped`, bundle `dropped_refs`.

---


> The fastest way to a shippable page. Two passes, one confirmation.

```text
Pass 1 — agent calls:
aura_prompt { "goal": "dark SaaS pricing" }

Server returns: draft_prompt + 6 questions + next_call.
Agent MUST ask you (theme / sections / system / assets / macrostructure / vibe) via native question UI.
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
Check aura_status. Then call aura_prompt with my goal, ask me its 6 questions,
then call it again with my answers and follow its suggested_calls.
My goal: dark cinematic portfolio.
```

Rules baked in: Tailwind `container mx-auto px-4`, hex 50-900, 768px hamburger,
hover scale 1.05 + shadow, Inter 40-60/28-36/14-16, motion <500ms +
`prefers-reduced-motion`, tokens first then markup.
Sources: [tips-for-prompting](https://www.aura.build/learn/tips-for-prompting),
[introduction](https://www.aura.build/learn/introduction),
[design-systems](https://www.aura.build/design-systems).

---


New landing page, dark cinematic portfolio, SaaS pricing section. The shape is the same each time:

1. `aura_prompt` with the goal sentence. Answer its 6 questions. Copy the final prompt.
2. `aura_recommend` with the goal sentence. Skim the starter kit links.
3. `aura_get_component` on two or three finalists. Read the markup, not just the description.
4. `aura_install_component` on the winner. Follow the file map.
5. `aura_use_design_system` once, before any markup, so tokens land first.

Prompts that work well are in [SETUP.md](./SETUP.md#prompts-that-work).

---


There is no auth in this server. No OAuth, no API key to paste, no account to create. Reads go to the same public catalogue endpoints the Aura website uses. The `premium` flag stays on every component row, free-only is the default, and Pro rows are refused everywhere — search filters them, and direct ID lookup, install, bundle, and scaffold refuse them (`-32602`, fail-closed) instead of guessing. If Aura rotates its public key, set `AURA_SUPABASE_ANON_KEY` and rebuild; nothing else changes.

Optional tuning (all with defaults):

<details>
<summary><b>Environment variables</b> — click to expand</summary>

| Var | Default | Meaning |
| --- | --- | --- |
| `AURA_TIMEOUT_MS` | 12000 | Upstream timeout |
| `AURA_RETRIES` | 2 | Retry budget for 429/5xx with jittered backoff |
| `AURA_CACHE_TTL_MS` | 60000 | LRU cache TTL (`0` disables) |
| `AURA_DEFAULT_LIMIT` / `AURA_MAX_LIMIT` | 10 / 25 | Pagination defaults and ceiling |
| `AURA_CODE_CHARS` / `AURA_CONTENT_CHARS` | 12000 | Chunk sizes for code/content paging |
| `AURA_FREE_ONLY_DEFAULT` | true | Keep free-only default |

</details>

---


```bash
npm test      # hermetic tests, no network
npm run verify  # 35 live checks against the real catalogue
npm run build   # rebundle src/*.mjs into dist/server.js
```

Layout: `src/config.mjs` holds env parsing. `src/http.mjs` hides timeouts and retries behind an injectable fetch. `src/catalog.mjs` is the deep module (queries, cache, shaping, counts). `src/icons.mjs` fetches free icons (FA + pixel lib) with its own 24h cache. `src/guide.mjs` turns rows into install plans plus pure mappers (`buildPrompt`, `combineScaffold`, `buildInspo*`, `buildDocs*` — same seam for tools + tests + docs). `src/tools.mjs` validates args. `src/protocol.mjs` speaks JSON-RPC. `src/server.mjs` only wires stdio.

---


Star it if it saved you a tab or twenty: [github.com/swastiksingh-dev/Aura-Components-MCP](https://github.com/swastiksingh-dev/Aura-Components-MCP). Reposits welcome — see [DIRECTION.md](./DIRECTION.md) for where this is headed.

[![Star History Chart](https://api.star-history.com/svg?repos=swastiksingh-dev/Aura-Components-MCP&type=Date)](https://star-history.com/#swastiksingh-dev/Aura-Components-MCP&Date)

```text
built a free design MCP on aura.build: 2495 components, 192 skills, 30k assets, 29 tools. no login. resources are @MengTo's

npx -y aura-components-mcp@latest
https://github.com/swastiksingh-dev/Aura-Components-MCP
```

---


Server code by [swastiksingh-dev](https://github.com/swastiksingh-dev), MIT. Free to fork, use, and sell with. If you fork this, keep the credit line and point people at the original repo.

| Source | Used for | License / terms |
| --- | --- | --- |
| [Aura](https://www.aura.build) (Meng To / DesignCode) | The entire catalogue: components, skills, assets, design systems | Belongs to Aura and credited authors; assets all-rights-reserved per [Aura Terms §4](https://www.aura.build/terms) |
| [Official Aura MCP](https://www.aura.build/mcp) | Comparison only (account projects/publishing over OAuth — the half this server skips) | Aura's terms |
| Inspo design-reference MCP | Real-site evidence behind `aura_inspo_*` (`recommend`, `find_components`, `get_reference_jsx`, `compare`) | Reference JSX belongs to its authors — adapt tokens, don't ship verbatim |
| [Context7](https://context7.com) | Fresh library docs behind `aura_docs_*` (trusted: Tailwind CSS, GSAP, Lenis, Iconify) | Docs belong to their projects |
| [Font Awesome Free](https://fontawesome.com) | Icons via `aura_icon` (served from jsDelivr + cdnjs) | [CC BY 4.0](https://fontawesome.com/license/free) — credit on every hit, enforced by the tool |
| [HackerNoon Pixel Icon Library](https://github.com/hackernoon/pixel-icon-library) ([site](https://pixeliconlibrary.com)) | Pixel icons via `aura_icon` (served from jsDelivr) | Icons CC BY 4.0, other files MIT — credit on every hit, enforced by the tool |
| Upstream libraries (Tailwind CSS, GSAP, Lenis, Iconify) | The code this server's guides point at | Each project's own license — check before shipping |

---


MIT — see [LICENSE](./LICENSE).
