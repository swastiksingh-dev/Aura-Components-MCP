# Setup

One server, every client below. No account, no key, nothing to log into. If Node 18+ runs `node ./dist/server.js`, the client can use this.

Build once:

```bash
git clone https://github.com/swastiksingh-dev/aura-components-mcp.git
cd aura-components-mcp
npm run build
node ./dist/server.js  # prints: aura-components-mcp v1.0.0 listening on stdio (Ctrl+C to stop)
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
3. It lists 15 tools starting with `aura_`. Approve them once.

## Roo Code (VS Code)

Same as Cline: Add MCP server, command `node`, args `["/absolute/path/to/aura-components-mcp/dist/server.js"]`. Roo shows the 15 `aura_` tools in its tool list after reload.

## DeepSeek Harness

This repo was built inside it. Register the server the same stdio way:

```bash
node ./dist/server.js
```

as a stdio MCP entry (command `node`, args `dist/server.js`), or run `npm run verify` first to watch all 18 live checks pass before wiring it in.

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

Restart OpenCode (or run `/mcp` to reload). The 15 `aura_*` tools show up in the TUI. Same first prompt as Claude Code above. A copy-paste file lives at `examples/opencode.json`.

## Any other MCP client

Transport is stdio, no auth. Command `node`, args `["/absolute/path/to/aura-components-mcp/dist/server.js"]`. The handshake is standard MCP (`initialize`, `tools/list`, `tools/call`). If the client asks for env, leave it empty; tuning vars are optional (see README).

## Prompts that work

- `Check aura_status. Then recommend a starter kit for a dark cinematic portfolio (free only).`
- `Search free pricing components, get the top two in full, and tell me which pastes cleaner into Tailwind.`
- `Which skill covers GSAP ScrollTrigger pin and scrub? Fetch it in full and apply the pinned-section recipe.`
- `Show trending free components and skills from the last 7 days.`
- `List categories with counts, then search the deepest free one for a landing page hero.`

## Troubleshooting

- Server exits instantly: check `node --version` (needs 18+), then `npm run build` again.
- Client shows 0 tools: absolute path wrong, or the client needs a restart after config edit.
- `upstream` errors on every call: outbound network blocked. `npm run verify` from the same machine tells you in seconds.
- Counts look stale: 60-second cache. Wait a minute or set `AURA_CACHE_TTL_MS=0`.
- A component says Pro: `aura_install_component` refuses it on purpose. Search returns free rows by default.
