# Security Policy

No auth in this server by design (public read-only catalogue). Report vulnerabilities via GitHub Issues (or email the maintainer via the GitHub profile). Do not open PRs with secrets. The bundled Supabase anon key is Aura's own public key shipped to every site visitor — rotate via `AURA_SUPABASE_ANON_KEY` if Aura rotates it.

## Network policy (award tools)

Every award-tool URL (search, inspect, index crawl, static audit, browser
navigation) is validated before it is used:

- **Scheme + host policy:** `http(s)` only; private, loopback, link-local,
  CGNAT, ULA and cloud-metadata ranges are blocked by literal inspection.
  IPv6 is parsed properly, including compressed `::` forms and IPv4-mapped
  addresses (`::ffff:127.0.0.1` is loopback; mapped private/link-local/metadata
  stay blocked).
- **Best-effort DNS guard:** hostnames are resolved and blocked when they land
  in a blocked range. Lookup failures count as "unknown" (the request may
  proceed) and lookups are bounded (~1.5 s) — the guard blocks positives, it
  never fabricates errors or hangs.
- **Redirects re-checked:** each redirect target goes through the same policy,
  not just the initial URL. Response bodies are streamed with a size cap
  (`/exceeds/` when over); 404 maps to `NOT_FOUND`, 429 is never retried.
- **`allowLocal: true`** relaxes loopback only (`127.0.0.0/8`, `::1`,
  `::ffff:127.0.0.1`). Private, link-local, ULA and metadata addresses stay
  blocked in every mode.
- **Browser navigation:** after each CDP navigation settles, the page URL is
  re-checked (`location.href`); blocked or non-http(s) targets abort the
  operation with `UNSUPPORTED_OPERATION` + `blockedUrl` instead of reading
  page state.
- Remote page content is untrusted input: it shapes extraction results only,
  never tool behavior, and is never executed in the server process.
