# Setup

One server, every client below. No account, no key, nothing to log into. If Node 22+ runs `node ./dist/server.js`, the client can use this.

Build once:

```bash
git clone https://github.com/swastiksingh-dev/Aura-Components-MCP.git
cd Aura-Components-MCP
npm install
npm run build
node ./dist/server.js  # prints: aura-components-mcp v1.7.0 listening on stdio (Ctrl+C to stop)
```

```bash
# Or without cloning:
npm i -g aura-components-mcp
npx -y aura-components-mcp@latest
```

If that last line prints, the server works. Everything below just points a client at the same file.

## Claude Code

```bash
claude mcp add aura-components -- node ./dist/server.js
claude mcp list   # confirm aura-components shows up
```

Then in a session: `Check aura_status, then find free hero components for a SaaS landing page.`

## Cursor

Add to `~/.cursor/mcp.json` (create it if missing):

```json
{
  "mcpServers": {
    "aura-components": { "command": "node", "args": ["/absolute/path/to/aura-components-mcp/dist/server.js"] }
  }
}
```

Restart Cursor. Open Composer, pick the aura tools, same first prompt as above.

## Codex

```bash
codex mcp add aura-components -- node ./dist/server.js
```

Then: `Use aura_search_all for "pricing section" (free only) and compare the top hits.`

## Windsurf

Add the same block Cursor uses to Windsurf's MCP config (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "aura-components": { "command": "node", "args": ["/absolute/path/to/aura-components-mcp/dist/server.js"] }
  }
}
```

Restart Windsurf, open Cascade, allow the server when asked.

## Cline (VS Code)

1. Open Cline settings, MCP Servers section.
2. Add server: command `node`, arg `/absolute/path/to/aura-components-mcp/dist/server.js`, name `aura-components`.
3. It lists 35 tools starting with `aura_`. Approve them once.

## Roo Code (VS Code)

Same as Cline: Add MCP server, command `node`, args `["/absolute/path/to/aura-components-mcp/dist/server.js"]`. Roo shows the 35 `aura_` tools in its tool list after reload.

## DeepSeek Harness

This repo was built inside it. Register the server the same stdio way:

```bash
node ./dist/server.js
```

as a stdio MCP entry (command `node`, args `dist/server.js`), or run `npm run verify` first to watch all 25 live checks pass before wiring it in.

## OpenCode

Add to `opencode.json` (or `opencode.jsonc`) in your project root or `~/.config/opencode/` (see [opencode.ai/docs/mcp-servers](https://opencode.ai/docs/mcp-servers)):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "aura-components": {
      "type": "local",
      "command": ["node", "/absolute/path/to/aura-components-mcp/dist/server.js"],
      "enabled": true
    }
  }
}
```

Restart OpenCode (or run `/mcp` to reload). The 35 `aura_*` tools show up in the TUI. Same first prompt as Claude Code above. A copy-paste file lives at `examples/opencode.json`.

## Award tools (optional system programs)

Core award search/index/blueprint needs nothing extra. Live capture, structure,
and motion need Chrome/Chromium (or `AURA_CHROME_PATH` to its executable);
`.webm` motion video additionally needs ffmpeg (or `AURA_FFMPEG_PATH`).
Corpus lives in `~/.aura-mcp/awards` (`AURA_AWARDS_DIR` overrides). Build it with
`aura_award_index {action:rebuild}` (bounded `maxPages`, `resume` continues) —
the server never crawls on startup.

## Any other MCP client

Transport is stdio, no auth. Command `node`, args `["/absolute/path/to/aura-components-mcp/dist/server.js"]`. The handshake is standard MCP (`initialize`, `tools/list`, `tools/call`). If the client asks for env, leave it empty; tuning vars are optional (see README).

## Prompts that work

- `Check aura_status. Then call aura_prompt with "dark SaaS pricing", ask me its 6 questions, then call it again with my answers.`
- `Check aura_status. Then recommend a starter kit for a dark cinematic portfolio (free only).`
- `Search free pricing components, get the top two in full, and tell me which pastes cleaner into Tailwind.`
- `Which skill covers GSAP ScrollTrigger pin and scrub? Fetch it in full and apply the pinned-section recipe.`
- `Recommend a starter kit for a dark SaaS pricing page (free only) — it auto-retries once via suggested queries, then fills from editorial picks if the goal matches nothing.`
- `List categories with counts, then search the deepest free one for a landing page hero.`
- `Scaffold a dark SaaS pricing page: aura_scaffold_page { "goal": "dark SaaS pricing", "components": ["732","1364"] } (object refs like [{ "id": "732" }] work too).`

## Troubleshooting

- Server exits instantly: check `node --version` (needs 22+), then `npm run build` again.
- Client shows 0 tools: absolute path wrong, or the client needs a restart after config edit.
- `upstream` errors on every call: outbound network blocked. `npm run verify` from the same machine tells you in seconds.
- Counts look stale: 60-second cache. Wait a minute or set `AURA_CACHE_TTL_MS=0`.
- A component says Pro: `aura_install_component` refuses it on purpose. Search returns free rows by default.
