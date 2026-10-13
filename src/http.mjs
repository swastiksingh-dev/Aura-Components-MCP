// Module: http — one small interface (createFetcher) hiding timeout,
// retry-with-backoff, error mapping, and the injectable fetch seam.
// Tests inject a stub fetch; production passes globalThis.fetch.

export function createFetcher({ fetchImpl, timeoutMs, retries, userAgent }) {
  if (typeof fetchImpl !== "function") throw new Error("fetchImpl must be a function");

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function once(url, init) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(new Error("timeout after " + timeoutMs + "ms")), timeoutMs);
    try {
      return await fetchImpl(url, {
        ...init,
        signal: ctrl.signal,
        headers: { "user-agent": userAgent, ...(init?.headers ?? {}) },
      });
    } finally {
      clearTimeout(t);
    }
  }

  // GET JSON over PostgREST. Returns { rows, total } (total from content-range).
  // Retryable: 429/5xx, network errors, timeouts (except AbortError: hung
  // requests are not retried). Non-retryable: other 4xx (invalid requests
  // never succeed on retry) — thrown immediately with noRetry set.
  async function getJson(url, headers) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await once(url, { headers });
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          lastErr = new Error("transient upstream status " + res.status);
        } else if (!res.ok) {
          const body = await res.text().catch(() => "");
          const e = new Error("upstream " + res.status + ": " + body.slice(0, 300));
          if (res.status >= 400 && res.status < 500) e.noRetry = true;
          throw e;
        } else {
          const range = res.headers?.get?.("content-range") ?? null;
          const total = range && range.includes("/") ? Number(range.split("/").pop()) : null;
          const rows = await res.json();
          return { rows: Array.isArray(rows) ? rows : [rows], total: Number.isFinite(total) ? total : null };
        }
      } catch (err) {
        if (err && (err.noRetry || err.name === "AbortError")) throw err;
        lastErr = err;
      }
      if (attempt < retries) await sleep(120 * 2 ** attempt + Math.floor(Math.random() * 60));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  // GET raw text (icons). 404 returns null (fallback chain keeps walking);
  // 429/5xx retry like getJson; other non-2xx also return null (a missing
  // icon is normal, not an upstream failure).
  async function getText(url, headers) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await once(url, { headers });
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          lastErr = new Error("transient upstream status " + res.status);
        } else if (res.status === 404) {
          return null;
        } else if (!res.ok) {
          return null;
        } else {
          return await res.text();
        }
      } catch (err) {
        lastErr = err;
        if (err && err.name === "AbortError") break;
      }
      if (attempt < retries) await sleep(120 * 2 ** attempt + Math.floor(Math.random() * 60));
    }
    if (lastErr) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
    return null;
  }

  return { getJson, getText };
}
