# Changelog

All notable changes to `aura-components-mcp`. The package version stays
`1.7.1` until a new version is explicitly authorized — the award subsystem
below ships in the working tree as `[Unreleased]`, not as a published
release.

## [Unreleased]

### Added — award-website intelligence (6 new MCP tools, 29 → 35)

- `aura_award_search` (`sites`/`categories`/`elements`/`motion`): ranked
  Awwwards references with preview links and match reasons, real taxonomy
  from the index/source (never invented counts), element-gallery search, and
  stored-motion search with empty-corpus vs zero-match distinguished.
- `aura_award_inspect`
  (`site_details`/`site_elements`/`element`/`compare_sites`): source-backed
  design DNA (palette, technologies, elements, awards, score), element media
  URLs with attribution, and 2–3-site comparisons that mark missing fields as
  unknown evidence, never negative proof.
- `aura_design_blueprint`: goal + 2–5 refs → Markdown brief plus versioned
  JSON (`spec.version: 1`), mapped to real free Aura components/systems
  (free-only enforced, catalogue failures reported as unavailable evidence).
  Original plans only — never copied third-party source.
- `aura_visual_audit` (`capture`/`structure`/`compare`): real browser
  screenshots and live-DOM band maps when Chrome is present; labeled
  `static-html` estimates otherwise; reference-vs-build mismatch reports
  without pixel-perfect claims. Loopback only with `allowLocal: true`.
- `aura_motion_study` (`inspect`/`record`/`search`): live runtime scans
  (libraries, easing vocab, scroll model, ScrollTrigger counts), bounded
  frame studies (2–16 frames, ≤30s), `.webm` only when a system ffmpeg
  exists — otherwise frame JPEGs plus an honest hint.
- `aura_award_index`
  (`status`/`rebuild`/`resume`/`refresh`/`new_winners`/`watch_add`/`watch_list`/`watch_remove`):
  file-based JSON index in `~/.aura-mcp/awards` (override
  `AURA_AWARDS_DIR`): atomic writes, schema versioning, corrupt quarantine
  + recovery, stale-lock single-writer, resume checkpoints, bounded growth
  (5000 sites/5000 elements/200 motion), winner baselines with seed-then-delta,
  studio/tag/url watches. Polite ~1 req/s crawl, bounded `maxPages` per call
  (default 5, max 20). Nothing crawls automatically on server startup.

### Fixed — field-report pass (12 issues, P0–P2)

- CDP attach uses `/json/list` page targets instead of browser-endpoint
  `Target.createTarget` (which hangs on several headless builds); every setup
  failure normalizes to `BROWSER_UNAVAILABLE` with per-operation fallback
  guidance. Fixed a worse latent bug the tests caught: the CDP response
  handler was never installed on setter-only transports, so *every* command
  would have timed out even against a healthy browser.
- `aura_visual_audit` degrades any live-dom failure to labeled `static-html`
  estimates (`fallbackFrom`/`fallbackWhy`); local builds audit directly from
  `file://`/local paths with `allowLocal:true` (`source:local-file`);
  `capture` of a file path errors with serve-it guidance.
- `aura_design_blueprint` queries the catalogue once per proposed section
  (up to 12 slim matches, sections covered reported), always emits
  `## Evidence gaps` (motion/structure/catalogue), and synthesizes goal-named
  hexes as `proposed` palette tokens against observed luminance bands.
- Search relevance: design-vocabulary aliases (`glassy`→`glassmorphism`,
  `3d`→`webgl`, …) + `theme:dark/light` tag boost; reasons name the query
  word; zero-token rows still score 0 (honest-empty preserved).
- Catalogue matcher stems inflections (`glassy`→`glass`, plural→singular) in
  both ranking and the refusal gate — `features glass bento` style queries
  stop dead-ending while nonsense queries still refuse honestly.
- Empty Technologies sections backfill from listing tags, labeled
  `technologiesInferred:true` with evidence note.
- `compare_sites` adds fuzzy element-keyword overlap, per-site luminance
  bands, and `directionHints`.
- `categories` honors `limit`/`offset` (`filtersTotal` disclosed); every
  search response carries `source` + `corpusNote` documenting the
  seed-once-then-local rule.

### Zero-dependency behavior

- No new npm dependencies (`package.json` gains none). New modules use only
  Node builtins via `process.getBuiltinModule` (works in source and in the
  concatenated `dist` bundle, which stays `import`-free): `fetch`,
  global `WebSocket` for CDP, `node:fs`/`path`/`os`/`child_process`.
- Optional system programs only: Chrome/Chromium (`AURA_CHROME_PATH`) for
  live capture/structure/motion; ffmpeg (`AURA_FFMPEG_PATH`) for `.webm`
  encoding. Core search/index/blueprint work without either; absence yields
  `BROWSER_UNAVAILABLE` + setup guidance, never fake output.

### Security

- URL safety on every browser/capture path: http(s) only, no credentials,
  private/cloud-metadata hosts blocked unless `allowLocal: true`, redirect
  hosts revalidated against the award allowlist.
- Award fetching only touches `www.awwwards.com` / `assets.awwwards.com`;
  markup-derived URLs are never followed as trusted.
- Bounded everything: 10s page timeout, 2MB response cap, one transient
  retry (blocks never retried), CDP command timeouts, temp-profile cleanup,
  child-process termination, no secrets in errors.

### Tests

- 66 new hermetic tests (no network, no browser): `test/awards.test.mjs`
  (21: parsers, ranking, client errors), `test/awards-index.test.mjs` (15:
  lifecycle, locks, corruption, winners, watches), `test/browser-cdp.test.mjs`
  (14: CDP framing, bands, motion reduce, honest unavailability),
  `test/award-tools.test.mjs` (16: 35-tool registry, JSON-RPC dispatch,
  blueprint honesty, error mapping). Full suite: 188 tests.
- `scripts/verify.mjs`: 38 live checks + 6 award validation checks (43 total).

## [1.7.1] — hardening release (published)

Bug-fix release, no new tools. Central free-only enforcement, theme-isolated
search cache, bundle-8 end-to-end, disclosed counts, malformed-row gate,
no-retry 4xx, Node `>=22` with CI matrix 22.x/24.x. See README for details.

## [1.7.0] — 29 tools (published)

Inspo bridge, docs helpers, `aura_icon`, `aura_version`, `aura_prompt`.
