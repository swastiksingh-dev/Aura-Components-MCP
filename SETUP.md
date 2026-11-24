# Setup

Aura Components MCP is an MCP server over stdio. It requires Node.js 22 or newer. The server has zero npm runtime dependencies. Ordinary catalogue, design-planning, and research-card use does not require Chrome, ffmpeg, or REA. Live upstream-backed tools need outbound network access.

## Install and smoke-test

This repository prepares package version 2.0.0. It is **not yet published**; npm currently serves 1.7.3. The npm commands below become usable after 2.0.0 is published. To run this branch now, use the source-clone instructions instead.

```sh
npx -y aura-components-mcp@2.0.0
```

For global installation:

```sh
npm install --global aura-components-mcp@2.0.0
aura-components-mcp
```

Or build from a clone:

```sh
git clone https://github.com/swastiksingh-dev/Aura-Components-MCP.git
cd Aura-Components-MCP
npm install
npm run build
node ./dist/server.js
```

The standalone command is a stdio MCP server; it waits for JSON-RPC input. To smoke-test through an MCP client, register it there, then call `aura_status` or `aura_plan_design`. Startup text is written to stderr, not the protocol stream.

## Client configuration

Client config formats and install UX differ by product/version. Use the examples below as templates and check the current client documentation if its schema changes. Keep the command available to the client process; use an absolute executable or server path if PATH resolution differs.

### Claude Code

From a source clone:

```sh
claude mcp add aura-components -- node /absolute/path/to/Aura-Components-MCP/dist/server.js
claude mcp list
```

After publication, for npm execution configure command `npx` with arguments `-y`, `aura-components-mcp@2.0.0` using the current Claude Code MCP configuration syntax.

### Cursor and Windsurf

Example stdio configuration (replace with a valid absolute path):

```json
{
  "mcpServers": {
    "aura-components": {
      "command": "node",
      "args": ["/absolute/path/to/Aura-Components-MCP/dist/server.js"]
    }
  }
}
```

Cursor commonly reads `~/.cursor/mcp.json`; Windsurf commonly reads `~/.codeium/windsurf/mcp_config.json`. Consult current client docs for the configuration location and reload behavior.

### Codex

From a source clone:

```sh
codex mcp add aura-components -- node /absolute/path/to/Aura-Components-MCP/dist/server.js
```

### OpenCode

Use the `mcp` configuration shape shown in [`examples/opencode.json`](examples/opencode.json), changing the server path to the absolute local path. OpenCode's configuration may live in a project config or user config; consult its current MCP server documentation for locations and reload behavior.

### Other stdio MCP clients

Configure command `node` and args `["/absolute/path/to/Aura-Components-MCP/dist/server.js"]` for a source clone, or (after publication) command `npx` and args `["-y", "aura-components-mcp@2.0.0"]` for npm. No environment variables are required for ordinary use.

## Optional browser tools

Most tools need no browser. Chrome/Chromium enables live screenshots, measured DOM structure/responsive mode, and runtime motion inspection/recording. Set `AURA_CHROME_PATH` to a browser executable if automatic discovery fails. ffmpeg (or `AURA_FFMPEG_PATH`) is only needed for WebM encoding; otherwise motion frames may still be produced individually.

The browser tools have explicit evidence limits: responsive checks measure a capped set of widths and candidate overflow elements but do not certify accessibility; the short layout settle may miss late content shifts. Motion inspection is a single-time sample; `record` scrolls and does not invoke named interactions. Optional REA can provide separately captured interaction summaries, but Aura neither installs nor requires REA. Full detail is in [`docs/v2/MOTION_RESPONSIVE.md`](docs/v2/MOTION_RESPONSIVE.md).

Award reference crawling/indexing is explicit, bounded, and never runs on startup. The local index defaults to `~/.aura-mcp/awards`; `AURA_AWARDS_DIR` can select another location.

## Troubleshooting

- **No tools appear:** check the absolute path or `npx` command/arguments and reload the client.
- **Server will not start:** verify `node --version` is 22 or newer. From a clone, run `npm run build` and then `node ./dist/server.js`.
- **Live tools fail:** check outbound network access and upstream availability. `npm run verify` tests the built server against live services and can fail if they are unavailable.
- **Browser operation says `BROWSER_UNAVAILABLE`:** install Chrome/Chromium or set `AURA_CHROME_PATH`; catalogue tools remain available.
- **WebM recording is unavailable:** install ffmpeg or set `AURA_FFMPEG_PATH`; this does not enable named interaction capture.
- **Catalogue content is not free for reuse:** free-only means free catalogue access, not an open-source or commercial reuse license. Check Aura's source terms and obtain required permission.

See [README.md](README.md) for the tool overview, [SECURITY.md](SECURITY.md) for security reporting, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and notices.
