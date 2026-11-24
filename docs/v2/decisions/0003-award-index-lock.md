# ADR-0003: Exclusive-create lock for the award index

- Status: Accepted
- Date: 2026-11-23
- Session: 1

## Context

`src/awards-index.mjs` persists the award corpus in `~/.aura-mcp/awards` and
uses `lock.json` to keep one crawl cycle at a time. The previous acquisition was:

```js
if (fs.existsSync(lockFile)) { /* read, check stale */ }
fs.writeFileSync(lockFile, payload);
```

Two processes can both observe "no lock" and both write, so both believe they
own the cycle. Multiple MCP clients (for example Claude Code and Cursor) can
point at the same home directory, so this is a real cross-process scenario.

## Decision

Acquire the lock with exclusive create:

```js
fs.openSync(lockFile, "wx");
```

- `EEXIST` means another process owns the lock. Read it:
  - a live lease (`startedAt` within `AWARD_LOCK_STALE_MS`, 30 minutes) →
    `INDEX_BUSY`;
  - a stale or corrupt lock → remove it and retry the exclusive create once.
- If another process wins the retry, this caller gets `INDEX_BUSY`.
- Release remains `rmSync(lockFile, { force: true })` in a `finally`.

The lock is still a lease, not a distributed consensus protocol.

## Alternatives considered

- **Document a single-process boundary and keep `existsSync`.** Rejected: the
  file location is shared by design and the cost of `wx` is one syscall.
- **Use a lock directory (`mkdir` as the atomic primitive).** Equivalent
  guarantee on local filesystems; the file form keeps the existing
  `lock.json` status payload and tests.
- **Add a dependency (`proper-lockfile`).** Rejected: zero-dependency goal and
  unnecessary for one local file.

## Consequences

- Concurrent acquisition can no longer produce two owners from the same
  check-then-write window.
- Stale takeover is best-effort. A process that read a stale lock, then lost a
  race to another process that created a fresh lock, may remove the fresh lock
  before retrying. The window is small and the lease is 30 minutes; closing it
  fully needs a second guard file or an OS advisory lock, which is not worth
  the complexity for this local cache.
- Corrupt lock JSON is still treated as stale and recovered.

## Verification

- `test/awards-index.test.mjs`: concurrent in-process rebuild → `INDEX_BUSY`;
  stale lock expires; lock removed after the run.
- `test/award-index-lifecycle.test.mjs`: same lifecycle through the tool layer.
- Cross-process contention is **not** integration-tested; this is recorded as a
  known limitation rather than a claimed guarantee.
