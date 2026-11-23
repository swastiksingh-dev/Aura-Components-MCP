# ADR-0001: Deterministic bundle assembly with an explicit manifest

- Status: Accepted
- Date: 2026-11-23
- Session: 1

## Context

`scripts/build.mjs` concatenated `src/*.mjs` in a hand-maintained order with
per-file identifier rewrites. Two problems surfaced in Session 1:

1. The build read working-tree sources verbatim, so a CRLF checkout produced a
   bundle with CRLF while the committed `dist/server.js` used LF. The same
   source produced different bytes on different machines.
2. The order list was implicit build knowledge. A new `src` module could be
   added and silently omitted from `dist/`; the only stale-dist test checked for
   a handful of marker strings.

The project must keep a zero-dependency, single-file `dist/server.js` and a
stable CLI entrypoint.

## Decision

Extract assembly into `scripts/bundle.mjs`:

- `BUILD_ORDER` + `SERVER_MODULE` are the build manifest.
- All source text is normalised to LF before concatenation.
- `assertManifestComplete()` fails if `src/*.mjs` and the manifest disagree.
- `assertBundle()` fails on leaked ESM statements or an unresolved
  `__PKG_VERSION__` placeholder.
- `bundleFrom(sources, version)` is a pure seam for tests;
  `bundleSource({ root, version })` reads the repository.
- `scripts/build.mjs` only reads `package.json`, calls `bundleSource`, and
  writes `dist/server.js` + `dist/cli.cjs`.

The existing identifier-rename rules move unchanged into `prep()`.

## Alternatives considered

- **Keep the script and add a CRLF `.gitattributes` rule.** Rejected: fixes the
  checkout, not the build contract, and does not guard the manifest.
- **Adopt a bundler dependency (esbuild/rollup).** Rejected: violates the
  zero-runtime-dependency goal and adds a build dependency for a 12-module
  concatenation.
- **Build per-module ESM instead of one bundle.** Rejected for Session 1: it
  changes the packaging and CLI contract; not needed to fix reproducibility.

## Consequences

- Builds are byte-identical from LF and CRLF checkouts.
- `test/build.test.mjs` fails when `dist/server.js` is stale, replacing the
  marker-only check with a full byte comparison.
- Adding a module now requires a manifest edit; forgetting it fails the build.
- Nested module paths are still unsupported; `BUILD_ORDER` holds bare filenames.
  The layout transition plan makes manifest path support a precondition for
  moving files.

## Verification

- `npm run build` exits 0.
- `npm test` includes `test/build.test.mjs`:
  - LF and CRLF source maps produce equal bundles;
  - committed `dist/server.js` equals a fresh bundle;
  - leaked ESM / unresolved version placeholders are rejected.
- `npm run verify` still passes all live checks against the rebuilt bundle.
