# ADR-0002: Explicit free/Pro asset counts and safe component page URLs

- Status: Accepted
- Date: 2026-11-23
- Session: 1

## Context

Two catalogue-shaping defects were confirmed against the current code:

1. `aura_status` counted assets with no `premium` filter while every retrieval
   path is free-only. Live data currently has 30,688 free assets and 0 Pro
   assets, so the mismatch was latent, not visible.
2. `isWellFormedRow("components", row)` accepts a row with an id and title but
   no slug. `pageUrl()` then built `https://www.aura.build/component/` +
   `undefined`, publishing a broken URL. Aura's SPA returns HTTP 200 for that
   path, so status codes cannot detect it.

## Decision

1. Keep `counts.assets` as the upstream total (all entitlements) for
   compatibility, and add `counts.assets_free` and `counts.assets_pro` with the
   same `private=eq.false` base as the existing component split. Add a
   `counts_note` that states the semantics explicitly.
2. In `pageUrl("components", row)`, use `/component/<slug>` when a non-empty
   slug exists; otherwise fall back to
   `/components?q=<encoded title>`. Never emit `undefined`.

## Alternatives considered

- **Change `counts.assets` to free-only.** Rejected: silently changes the
  meaning of an existing output key; the plan forbids that without a documented
  migration.
- **Drop slug-less component rows as malformed.** Rejected: the row still has
  usable code and a valid id; losing content because the canonical page URL is
  missing is worse than linking to a catalogue search.
- **Use `/component/<id>` as the fallback.** Rejected: Aura's route is
  slug-based; the SPA returns 200 for arbitrary paths, so a 200 is not evidence
  that the id resolves to the component.

## Consequences

- `aura_status` makes two extra count requests (cached with the rest of the
  status payload).
- Slug-less rows remain usable and cite a search URL that resolves by title.
- Tool description now names the split so an agent does not misread `assets`.

## Verification

- `test/catalog.test.mjs` asserts `assets_free`/`assets_pro` keys and the
  `counts_note`.
- `test/catalog.test.mjs` asserts a slug-less component produces
  `https://www.aura.build/components?q=Glassy%20Hero`, never `undefined`.
- Live `aura_status` after the change reports 2,495 free / 336 Pro components,
  30,688 free / 0 Pro assets, 194 skills, 725 design systems.
