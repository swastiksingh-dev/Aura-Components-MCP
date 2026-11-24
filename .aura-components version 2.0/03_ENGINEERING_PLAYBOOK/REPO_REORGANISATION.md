# Repository reorganisation plan

## Current structure observed

The repository currently has a relatively compact layout:

- `src/` — 12 `.mjs` modules, including protocol/server, catalogue, guide, tools, awards and browser adapter.
- `test/` — a flat set of test files, with catalogue/protocol/access/browser/award/docs/packaging coverage.
- `scripts/` — build, verify and reproducibility scripts.
- `dist/` — generated `server.js` and CLI bundle.
- root-level README, setup, direction, changelog, policy and contributor documents.

The build script concatenates source modules using an explicit ordered list and per-file rename rules. This is a key architectural constraint, not a detail to overlook.

## Recommended target layout

```text
.
├── .github/
│   ├── workflows/
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── .opencode/
│   └── agents/
├── assets/
│   ├── brand/
│   ├── demos/
│   └── screenshots/
├── docs/
│   ├── architecture/
│   ├── decisions/
│   ├── features/
│   ├── guides/
│   ├── research/
│   └── v2/
├── examples/
├── scripts/
├── src/
│   ├── core/             # protocol, config, transport, server lifecycle
│   ├── catalog/          # upstream catalogue access and ranking
│   ├── design/           # design contracts, prompts, design-system logic
│   ├── motion/           # motion plan and motion evidence
│   ├── research/         # evidence cards, index and retrieval
│   ├── reference/        # award/reference parsing and index
│   ├── browser/          # optional CDP/browser adapters
│   ├── tools/            # registry and thin input/output adapters
│   └── shared/           # icons, version and common utilities
├── test/
│   ├── core/
│   ├── catalog/
│   ├── design/
│   ├── motion/
│   ├── research/
│   ├── reference/
│   ├── browser/
│   └── packaging/
├── dist/                # generated; never edit manually
├── AGENTS.md
├── README.md
├── DIRECTION.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── package.json
└── LICENSE
```

## Incremental migration map

| Current module | Proposed home | Notes |
|---|---|---|
| `config.mjs` | `src/core/config.mjs` | Shared configuration only |
| `http.mjs` | `src/core/http.mjs` | Upstream transport; preserve retry/limits |
| `protocol.mjs` | `src/core/protocol.mjs` | JSON-RPC/MCP framing and response contracts |
| `server.mjs` | `src/core/server.mjs` or root entry wrapper | Keep startup path stable |
| `catalog.mjs` | `src/catalog/catalog.mjs` | Catalogue fetch/search/cache/access rules |
| `guide.mjs` | split between `src/design/` and `src/catalog/` only where boundaries are clear | Do not mechanically split 42 KB file |
| `tools.mjs` | `src/tools/registry.mjs` plus small feature adapters | Tool handlers should remain thin |
| `awards.mjs` | `src/reference/awards.mjs` | Evidence parsing and scoring |
| `awards-index.mjs` | `src/reference/index.mjs` | Local persistence and lifecycle |
| `browser-cdp.mjs` | `src/browser/cdp.mjs` | Browser support remains optional |
| `icons.mjs` | `src/shared/icons.mjs` | Preserve credits/licence handling |
| `version.mjs` | `src/shared/version.mjs` | Version check utility |

## Migration rules

1. Do not move every file in one pass.
2. First add a build manifest or a deterministic explicit module order that supports nested paths.
3. Add a reproducibility test: repeated builds from the same source produce the same bundle (excluding intentionally variable metadata, if any).
4. Ensure no accidental double inclusion, missing module or identifier-collision rename.
5. Update imports, source maps if used, tests, package files, `.npmignore`/`.gitignore`, docs and CI.
6. Keep the package's public CLI entrypoint unchanged unless v2 needs a documented breaking change.
7. Move tests domain-by-domain only after the test command is proven to discover nested test files on supported platforms.
8. Keep a clean root: project policy docs, entrypoints, package metadata and a small number of navigational files only.
9. Do not move `dist/` into source or treat it as manually maintained code.

## Important build concern

The current `scripts/build.mjs` has an explicit `order` list and module-specific identifier rewrites. A folder reorganisation requires updating that file or replacing it with a safer manifest-driven build. Treat build correctness as a first-class task and add tests before moving modules.

## Avoid overengineering

A tidy repository is not the one with the most directories. If a module has one clear purpose and is already easy to navigate, keep it. Only split modules when there are independent responsibilities, meaningful tests or different change frequency.
