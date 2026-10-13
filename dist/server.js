#!/usr/bin/env node
// aura-components-mcp v1.7.1 — bundled (zero deps). Built by swastiksingh-dev.

// ---- config.mjs ----
// Module: config — one small interface (loadConfig) over all env parsing.
// Callers learn one function; env names, defaults, and clamping live here.

const num = (raw, fallback, { min = 1, max = 100 } = {}) => {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const bool = (raw, fallback) => {
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
};

function loadConfig(env = process.env) {
  const defaultKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvaXJxcmtkZ2JtdnB3dXR3dXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM2Nzc2NTAsImV4cCI6MjA1OTI1MzY1MH0._UsCSHsTELn7m54tOhX3ySm67WEhcyHAPbuxEQZsl3c";
  return {
    supabaseUrl: env.AURA_SUPABASE_URL ?? "https://hoirqrkdgbmvpwutwuwj.supabase.co",
    anonKey: env.AURA_SUPABASE_ANON_KEY ?? defaultKey,
    timeoutMs: num(env.AURA_TIMEOUT_MS, 12_000, { min: 1_000, max: 60_000 }),
    retries: num(env.AURA_RETRIES, 2, { min: 0, max: 5 }),
    cacheTtlMs: num(env.AURA_CACHE_TTL_MS, 60_000, { min: 0, max: 3_600_000 }),
    defaultLimit: num(env.AURA_DEFAULT_LIMIT, 10, { min: 1, max: 50 }),
    maxLimit: num(env.AURA_MAX_LIMIT, 25, { min: 1, max: 50 }),
    codeChars: num(env.AURA_CODE_CHARS, 12_000, { min: 1_000, max: 60_000 }),
    contentChars: num(env.AURA_CONTENT_CHARS, 12_000, { min: 1_000, max: 60_000 }),
    freeOnlyDefault: bool(env.AURA_FREE_ONLY_DEFAULT, true),
    userAgent: env.AURA_USER_AGENT ?? "aura-components-mcp/1.7.1",
  };
}

// ---- http.mjs ----
// Module: http — one small interface (createFetcher) hiding timeout,
// retry-with-backoff, error mapping, and the injectable fetch seam.
// Tests inject a stub fetch; production passes globalThis.fetch.

function createFetcher({ fetchImpl, timeoutMs, retries, userAgent }) {
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

// ---- catalog.mjs ----
// Module: catalog — the deep module. Small interface (searchCatalog,
// getItem, getStatus) over query building, caching, truncation, author
// enrichment, and page-URL derivation. Adapters: PostgREST via fetcher.

const SITE = "https://www.aura.build";

const CATALOG_SORTS = {
  components: { popular: "views.desc", recent: "created_at.desc", trending: "views.desc", updated: "updated_at.desc" },
  skills: { popular: "views.desc", recent: "created_at.desc", trending: "views.desc", updated: "updated_at.desc" },
  assets: { popular: "views.desc", recent: "created_at.desc", trending: "views.desc", updated: "updated_at.desc" },
  design_systems: { popular: "views.desc", recent: "created_at.desc", trending: "views.desc", updated: "updated_at.desc" },
};

const LIST_COLS = {
  // PostgREST can't substring server-side: lists fetch code but shapeRow truncates to
  // a 600-char probe for facets BEFORE the truncation marker (see shapeRow). ~0.7KB/row.
  components: "id,title,description,tags,code,premium,views,forks,slug,background,created_by,created_at,updated_at",
  skills: "id,title,description,source_url,views,forks,featured,created_by,created_at,updated_at",
  assets: "id,title,description,keywords,media_type,premium,views,forks,image_800w,video_url,video_poster_url,created_by,created_at",
  design_systems: "id,slug,title,description,views,forks,featured,created_by,created_at,updated_at",
};

const DETAIL_COLS = {
  components: "id,title,description,tags,code,premium,views,forks,slug,image_url,background,credit_name,credit_url,created_by,created_at,updated_at",
  skills: "id,title,description,content,source_url,views,forks,featured,created_by,created_at,updated_at",
  assets: "id,title,description,keywords,resolution,colors,media_type,premium,views,forks,image_320w,image_800w,image_1600w,image_3840w,image_original,image_url,video_url,video_poster_url,video_duration,slug,created_by,created_at,updated_at",
  design_systems: "id,slug,title,description,content,preview_html,thumbnail_url,source_name,views,forks,featured,created_by,created_at,updated_at",
};

const esc = (s) => String(s).replaceAll('"', '""');
const ilike = (v) => "*" + String(v).replaceAll("*", "").replaceAll(",", " ").trim() + "*";

// Split a goal sentence into significant tokens for OR fallback (stop-word filtered).
// Theme words (dark/light) are NOT search tokens — they become rank/filter signals
// (see detectThemeHint + scoreByTheme), so "dark cinematic" can't match light rows.
const STOP = new Set("a,an,the,for,with,and,or,of,to,in,on,my,new,free,also,that,this,from,into,plus,vs,top,best,up".split(","));
const THEME_WORDS = new Set(["dark", "light", "midnight", "noir", "black", "white", "bright", "airy", "minimal"]);
function queryTokens(q, max = 4) {
  return String(q ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 2 && !STOP.has(t) && !THEME_WORDS.has(t)).slice(0, max);
}
// Theme hint from the raw query: explicit signal, separate from match tokens.
function detectThemeHint(q) {
  const t = String(q ?? "").toLowerCase();
  const dark = /\bdark\b|\bmidnight\b|\bnoir\b|\bcinematic\b/.test(t);
  const light = /\blight\b|\bbright\b|\bairy\b/.test(t);
  if (dark && !light) return "dark";
  if (light && !dark) return "light";
  return null;
}
// Rank rows: +2 per matched token in title, +1 in description/tags, theme match first.
// Returns { rows, scored } where scored explains the top pick for fallback_score.
function scoreRows(kind, rows, toks, themeHint) {
  const scored = rows.map((r) => {
    const title = String(r.title || "").toLowerCase();
    const desc = String(r.description || "").toLowerCase();
    const tags = ((r.tags || []).map((x) => String(x).toLowerCase()).join(" "));
    let s = 0;
    for (const t of toks) { if (title.includes(t)) s += 2; else if (desc.includes(t) || tags.includes(t)) s += 1; }
    const th = r.facets && r.facets.theme;
    const themeOk = !themeHint || th === themeHint || th === "mixed" || th === "unknown";
    if (themeHint && th === themeHint) s += 3;
    return { r, s, themeOk };
  });
  scored.sort((a, b) => ((b.themeOk ? 1 : 0) - (a.themeOk ? 1 : 0)) || (b.s - a.s) || ((b.r.views || 0) - (a.r.views || 0)));
  return scored;
}

// Kind-aware token overlap for the zero-overlap refusal gate (pure, no fetch).
// Components/assets: title-only (strict visual surfaces; tags/descriptions don't count).
// Skills/design_systems: wider net — title + description + tags + any snippet present.
function matchOverlap(kind, toks, item) {
  const list = Array.isArray(toks) ? toks : [];
  if (!list.length || !item) return 0;
  if (kind === "components" || kind === "assets") {
    const title = String(item.title || "").toLowerCase();
    let n = 0;
    for (const t of list) {
      const tok = String(t ?? "").toLowerCase();
      if (tok && title.includes(tok)) n++;
    }
    return n;
  }
  const parts = [String(item.title || ""), String(item.description || "")];
  if (Array.isArray(item.tags)) parts.push(item.tags.map((x) => String(x)).join(" "));
  for (const k of ["content_snippet", "content_excerpt", "preview_snippet", "tokens_snippet"]) {
    if (typeof item[k] === "string" && item[k]) parts.push(item[k]);
  }
  const hay = parts.join("\n").toLowerCase();
  let n = 0;
  for (const t of list) {
    const tok = String(t ?? "").toLowerCase();
    if (tok && hay.includes(tok)) n++;
  }
  return n;
}

function windowAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function trendingIso(days = 90) { return windowAgoIso(days); } // 7d seed is empty; callers pass window_days (default 30 for components now)

function buildSearchParams(kind, q = {}) {
  const p = new URLSearchParams();
  p.set("select", LIST_COLS[kind]);
  const limit = q.limit;
  const offset = q.offset ?? 0;
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  const sort = CATALOG_SORTS[kind][q.sort] ?? CATALOG_SORTS[kind].popular;
  p.set("order", sort);
  const filters = [];
  if (kind === "components" || kind === "assets") {
    filters.push("private=eq.false");
    if (q.freeOnly) filters.push("premium=eq.false");
  } else if (kind === "skills" || kind === "design_systems") {
    filters.push("private=eq.false");
  }
  if (q.tag && kind === "components") filters.push("tags=cs.{" + q.tag.toLowerCase() + "}");
  if (q.mediaType && kind === "assets") filters.push("media_type=eq." + q.mediaType);
  const ors = [];
  if (q.query && q.query.trim()) {
    const v = ilike(q.query);
    if (kind === "components") ors.push("title.ilike." + v + ",description.ilike." + v);
    else if (kind === "skills") ors.push("title.ilike." + v + ",description.ilike." + v);
    else if (kind === "assets") ors.push("title.ilike." + v + ",description.ilike." + v);
    else ors.push("title.ilike." + v + ",description.ilike." + v + ",content.ilike." + v + ",preview_html.ilike." + v);
  }
  if (q.sort === "trending") filters.push("created_at=gte." + trendingIso(q.window_days ?? 90));
  return { params: p, filters, ors };
}

function buildUrl(base, table, params, filters, ors) {
  let qs = params.toString();
  for (const f of filters) qs += "&" + f;
  if (ors.length) qs += "&or=(" + ors.join(",") + ")";
  return base + "/rest/v1/" + table + "?" + qs;
}

// Truncation with cursors: agents see full_length + chunk info instead of a silent
// marker, and can fetch the rest via getItem with { chunk } (see getItem below).
function chunkText(s, n, chunk = 0) {
  const full = String(s || "");
  const total = Math.max(1, Math.ceil(full.length / n));
  const i = Math.max(0, Math.min(chunk, total - 1));
  return { text: full.slice(i * n, (i + 1) * n) + (i < total - 1 ? "…[truncated]" : ""), chunk: i, chunks: total, full_length: full.length, truncated: total > 1 };
}

// Slim lists: drop heavy blobs (full code/content/preview_html) from list rows,
// keep excerpts + chunk pointers + full_fetch so agents fetch detail on purpose.
// getItem/bundleItems stay full — detail is their job. Default on (q.slim ?? true).
function slimRows(kind, items) {
  return (items || []).map((it) => {
    const o = { ...it };
    if (kind === "components" && typeof o.code === "string") delete o.code; // keep code_excerpt + code_info + full_fetch
    if (kind === "skills" && typeof o.content === "string") { o.content_excerpt = String(o.content).slice(0, 800); delete o.content; }
    if (kind === "design_systems") {
      if (typeof o.content === "string") { o.content_excerpt = String(o.content).slice(0, 800); delete o.content; }
      if (typeof o.preview_html === "string") { o.preview_excerpt = String(o.preview_html).slice(0, 800); delete o.preview_html; }
    }
    return o;
  });
}

// Central access policy: only components/assets carry a premium flag, and a
// row is free ⟺ premium === false (fail-closed: missing or ambiguous
// entitlement is refused, never assumed public). Skills/design_systems
// have no premium concept and are always allowed. Every retrieval path
// (getItem, and therefore bundle/bulk/scaffold/related/install) funnels
// through assertFreeRow, so callers cannot reach restricted content by ID.
function isFreeRow(kind, row) {
  if (kind !== "components" && kind !== "assets") return true;
  return !!row && row.premium === false;
}

function assertFreeRow(kind, row) {
  if (isFreeRow(kind, row)) return;
  const what = kind === "assets" ? "asset" : "component";
  const e = new Error("that " + what + " is Pro (paid). Search with freeOnly or pick a free one.");
  e.code = "BAD_ARGS";
  throw e;
}

// Row-shape gate: the minimum fields every surface needs to build a usable
// item (identity for page_url + title for display/matching). Rows that fail
// are upstream schema drift, not empty results: listings disclose them via
// malformed_dropped, single-record fetch fails loud. Never silently shaped
// into "undefined" URLs or untitled items.
function isWellFormedRow(kind, row) {
  if (!row || typeof row !== "object") return false;
  if (typeof row.title !== "string" || !row.title) return false;
  const hasId = row.id !== undefined && row.id !== null;
  const hasSlug = typeof row.slug === "string" && !!row.slug;
  if (kind === "components" || kind === "design_systems") return hasId || hasSlug;
  return hasId;
}

function pageUrl(kind, row) {
  if (kind === "components") return SITE + "/component/" + row.slug;
  if (kind === "skills") return SITE + "/skills/" + row.id;
  // ISS9: asset pages are query-routed (no /assets/ID route exists). Keep the q= form
  // but ALSO expose a stable key so agents can cite: id + slug + title together.
  if (kind === "assets") return SITE + "/assets?q=" + encodeURIComponent(row.title ?? "");
  return SITE + "/design-systems/" + (row.slug ?? row.id);
}

function assetKey(row) {
  return { id: row.id, slug: row.slug ?? null, title: row.title ?? null };
}

function shapeRow(kind, row, cfg, withFacets) {
  const base = { ...row };
  // Facets probe the FULL available code (pre-truncation) so search facets equal
  // detail facets and install-time needs: a short prefix missed late markers
  // like data-lucide (id 1572 drift). Weight uses the true length (ISS1/2/3).
  if (kind === "components" && typeof base.code === "string") {
    base.code_chars = base.code.length;
    if (withFacets) { try { base.facets = withFacets(kind, base, { fullLength: base.code.length }); } catch { /* never break rows */ } }
    // Gap 3: code_excerpt (first 1200 chars, readable) + full_fetch flag. Agents skim
    // the excerpt, then get chunk N — no more blind 18k-70k dumps or silent cuts.
    base.code_excerpt = String(base.code).slice(0, 1200);
    base.full_fetch = { tool: "aura_get_component", id: base.id ?? base.slug, chunks: Math.max(1, Math.ceil(base.code.length / cfg.codeChars)) };
    const ch = chunkText(base.code, cfg.codeChars, 0);
    base.code = ch.text;
    base.code_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: 0, truncated: ch.truncated };
    if (base.facets) base.facets.deps_summary = base.facets.needsTailwind || base.facets.needsIcons ? [base.facets.needsTailwind && "tailwindcss", base.facets.needsIcons && "iconify-icon"].filter(Boolean) : [];
  }
  if (kind === "skills" && typeof base.content === "string") {
    const ch = chunkText(base.content, cfg.contentChars, 0);
    base.content = ch.text;
    base.content_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: 0, truncated: ch.truncated };
  }
  if (kind === "design_systems") {
    if (typeof base.content === "string") {
      const ch = chunkText(base.content, cfg.contentChars, 0);
      base.content = ch.text;
      base.content_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: 0, truncated: ch.truncated };
    }
    if (typeof base.preview_html === "string") {
      const ch = chunkText(base.preview_html, cfg.codeChars, 0);
      base.preview_html = ch.text;
      base.preview_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: 0, truncated: ch.truncated };
    }
  }
  base.page_url = pageUrl(kind, row);
  if (kind === "assets") base.asset_key = assetKey(row);
  if (withFacets && !base.facets) { try { base.facets = withFacets(kind, base); } catch { /* facets never break rows */ } }
  // ISS8: force absolute Supabase URLs — relative variant paths break fetch.
  if (kind === "assets") {
    const abs = (u) => (!u ? u : (/^https?:\/\//i.test(u) ? u : ("https://hoirqrkdgbmvpwutwuwj-all.supabase.co/storage/v1/object/public/assets/" + String(u).replace(/^\/+/, ""))));
    for (const k of ["image_320w", "image_800w", "image_1600w", "image_3840w", "image_original", "image_url", "video_url", "video_poster_url"]) if (typeof base[k] === "string") base[k] = abs(base[k]);
    if (base.facets) {
      if (base.facets.download) base.facets.download = abs(base.facets.download);
      if (base.facets.preview) base.facets.preview = abs(base.facets.preview);
    }
  }
  return base;
}

function createCatalog({ fetcher, config, now = () => Date.now(), facetsFn = null }) {
  const base = config.supabaseUrl.replace(/\/$/, "");
  const headers = { apikey: config.anonKey, Authorization: "Bearer " + config.anonKey, Prefer: "count=exact" };
  const cache = new Map();
  const MAX_KEYS = 300;
  const cacheGet = (k) => {
    if (!config.cacheTtlMs) return null;
    const e = cache.get(k);
    if (!e) return null;
    if (now() - e.t > config.cacheTtlMs) { cache.delete(k); return null; }
    cache.delete(k); cache.set(k, e); // LRU refresh
    return e.v;
  };
  const cacheSet = (k, v) => {
    if (!config.cacheTtlMs) return;
    if (cache.has(k)) cache.delete(k);
    cache.set(k, { t: now(), v });
    while (cache.size > MAX_KEYS) cache.delete(cache.keys().next().value);
  };
  const authorCache = new Map(); // created_by -> profile (shared across searches)
  const inflight = new Map(); // cacheKey -> Promise (coalesce concurrent identical calls)

  const clampLimit = (l) => Math.min(config.maxLimit, Math.max(1, Math.floor(l ?? config.defaultLimit)));

  async function enrichAuthors(rows) {
    const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean).filter((id) => !authorCache.has(id)))];
    if (ids.length) {
      try {
        const url = base + "/rest/v1/public_author_profiles?select=id,full_name,avatar_url,slug&id=in.(" + ids.map(esc).join(",") + ")";
        const { rows: authors } = await fetcher.getJson(url, headers);
        for (const a of authors) { authorCache.set(a.id, a); if (authorCache.size > 500) break; }
      } catch { /* authors stay null, rows still return */ }
    }
    return rows.map((r) => ({ ...r, author: (r.created_by && authorCache.get(r.created_by)) || null }));
  }

  async function searchCatalog(kind, q = {}) {
    const limit = clampLimit(q.limit);
    const offset = Math.max(0, q.offset ?? 0);
    const sort = CATALOG_SORTS[kind][q.sort] ? q.sort : "popular";
    const freeOnly = q.freeOnly ?? config.freeOnlyDefault;
    // Gap 1: negative_theme (exclude a theme) + min_views (quality floor). Both ride
    // the cache key so filtered/unfiltered variants never collide. Explicit
    // theme also rides the key: it re-ranks results, so dark/light variants
    // must never share a cache entry or an in-flight request.
    const themeKey = q.theme ? String(q.theme).toLowerCase() : "";
    const negTheme = q.negative_theme ? String(q.negative_theme).toLowerCase() : "";
    const minViews = Math.max(0, q.min_views ?? 0);
    const slim = q.slim ?? true;
    const exactFlag = q.exact_match === true ? "exact" : "fuzzy";
    const key = ["search", kind, q.query ?? "", q.tag ?? "", q.mediaType ?? "", sort, limit, offset, freeOnly, themeKey, negTheme, minViews, slim ? "slim" : "full", exactFlag].join("|");
    const hit = cacheGet(key);
    if (hit) return { ...hit, cached: true };
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const runOnce = async (qq) => {
        const { params, filters, ors } = buildSearchParams(kind, { ...qq, limit, offset, sort, freeOnly });
        const url = buildUrl(base, kind, params, filters, ors);
        return fetcher.getJson(url, headers);
      };
      let { rows, total } = await runOnce(q);
      let fallback = null;
      // AND-phrase queries like "dark cinematic portfolio" match nothing literally:
      // retry as OR over significant tokens so every surface degrades instead of emptying.
      // Theme words (dark/light/cinematic) are rank signals, not match tokens.
      const toks = (q.query && q.query.trim() && !q.tag) ? queryTokens(q.query) : [];
      const themeHint = (q.query && q.query.trim()) ? detectThemeHint(q.query) : null;
      const effTheme = q.theme || themeHint;
      const suggest = (t) => {
        const s = [];
        if (t.length > 1) s.push(t.slice(0, Math.min(3, t.length)).join(" "));
        for (const x of t.slice(0, 3)) s.push(x);
        return [...new Set(s)].slice(0, 4);
      };
      if ((!rows || !rows.length) && toks.length && q.exact_match !== true) {
        // Pass 1: OR over tokens, same filters (drops the AND-phrase requirement).
        const orParts = [];
        for (const t of toks) {
          const v = ilike(t);
          if (kind === "design_systems") orParts.push("title.ilike." + v + ",description.ilike." + v + ",content.ilike." + v + ",preview_html.ilike." + v);
          else orParts.push("title.ilike." + v + ",description.ilike." + v);
        }
        const b1 = buildSearchParams(kind, { ...q, query: "", limit, offset, sort, freeOnly });
        try {
          const fb = await fetcher.getJson(buildUrl(base, kind, b1.params, b1.filters, orParts), headers);
          if (fb.rows && fb.rows.length) { rows = fb.rows; total = fb.total; fallback = "or-tokens:" + toks.join(","); }
        } catch { /* try pass 2 */ }
        // Pass 2: still empty (e.g. trending window + rare tokens): drop sort window,
        // keep OR tokens, rank by views. Guarantees aggregators return something useful.
        if ((!rows || !rows.length)) {
          const b2 = buildSearchParams(kind, { ...q, query: "", limit, offset, sort: "popular", freeOnly });
          try {
            const fb2 = await fetcher.getJson(buildUrl(base, kind, b2.params, b2.filters, orParts), headers);
            if (fb2.rows && fb2.rows.length) { rows = fb2.rows; total = fb2.total; fallback = "or-tokens-unwindowed:" + toks.join(","); }
          } catch { /* try safety net */ }
        }
        // Safety net: total miss on a text query still returns usable items.
        // Same freeOnly/tag/mediaType filters, popular order, labeled honestly —
        // true never-empty (unless upstream itself is down).
        if ((!rows || !rows.length)) {
          const b3 = buildSearchParams(kind, { ...q, query: "", limit, offset, sort: "popular", freeOnly });
          try {
            const fb3 = await fetcher.getJson(buildUrl(base, kind, b3.params, b3.filters, []), headers);
            if (fb3.rows && fb3.rows.length) { rows = fb3.rows; total = fb3.total; fallback = "popular-safety-net"; }
          } catch { /* keep empty: upstream truth */ }
        }
      }
      // ISS7: dedupe skills by source_url (same SKILL.md listed twice). First (most-viewed)
      // wins, gets canonical:true; dupes are dropped and counted in deduped.
      let deduped = 0;
      if (kind === "skills") {
        const seen = new Set();
        const kept = [];
        for (const r of rows) {
          const u = (r.source_url || "").trim().toLowerCase();
          if (u && seen.has(u)) { deduped++; continue; }
          if (u) seen.add(u);
          kept.push(r);
        }
        const byUrl = new Map();
        for (const r of kept) {
          const u = (r.source_url || "").trim().toLowerCase();
          if (u && (!byUrl.has(u) || (r.views || 0) > (byUrl.get(u).views || 0))) byUrl.set(u, r);
        }
        rows = kept.map((r) => {
          const u = (r.source_url || "").trim().toLowerCase();
          return (u && byUrl.get(u) === r) ? { ...r, canonical: true } : r;
        });
      }
      // Gap 4: inline snippets — one extra batched fetch fills preview/tokens glimpses
      // into search rows (top N only) so agents decide without a second call per row.
      // Bounded: top 5 rows, client-side sliced to 800 chars. No extra call when empty.
      // Same fetch also resolves facets.has_preview to a real boolean for those rows.
      let presence = null;
      if ((kind === "design_systems" || kind === "skills") && rows.length) {
        const topIds = rows.slice(0, 5).map((r) => r.id);
        try {
          const idList = topIds.map((id) => encodeURIComponent(String(id))).join(",");
          const sel = kind === "design_systems" ? "id,content,preview_html" : "id,content,source_url";
          const { rows: full } = await fetcher.getJson(base + "/rest/v1/" + kind + "?select=" + encodeURIComponent(sel) + "&id=in.(" + idList + ")", headers);
          const byId = new Map(full.map((r) => [String(r.id), r]));
          if (kind === "design_systems") presence = new Map(full.map((r) => [String(r.id), Boolean(r.preview_html)]));
          rows = rows.map((r) => {
            const f = byId.get(String(r.id));
            if (!f) return r;
            if (kind === "design_systems") return { ...r, preview_snippet: String(f.preview_html || "").slice(0, 800), tokens_snippet: String(f.content || "").slice(0, 800) };
            return { ...r, content_snippet: String(f.content || "").slice(0, 800) };
          });
        } catch { /* snippets are best-effort; rows still return */ }
      }
      const enriched = await enrichAuthors(rows);
      // Schema-drift gate: malformed rows are disclosed, never shaped into
      // untitled items or ".../undefined" page URLs, and never counted as
      // successful empty results (total keeps its upstream meaning).
      const formed = [];
      let malformed = 0;
      for (const r of enriched) {
        if (isWellFormedRow(kind, r)) formed.push(r);
        else malformed++;
      }
      const out = { kind, total, limit, offset, items: formed.map((r) => shapeRow(kind, r, config, facetsFn)), cached: false };
      if (malformed) out.malformed_dropped = malformed;
      if (deduped) out.deduped = deduped;
      // Gap 1: min_views quality floor (views-gated surfaces only) + negative_theme
      // hard exclusion. Both apply before theme re-rank so counts stay honest.
      // total keeps its upstream meaning (all matches for limit/offset paging);
      // local drops are disclosed via min_views_filtered_out / deduped /
      // negative_theme_filtered_out instead of rewriting total.
      if (minViews > 0) {
        const beforeViews = out.items.length;
        out.items = out.items.filter((it) => (it.views || 0) >= minViews);
        if (out.items.length < beforeViews) out.min_views_filtered_out = beforeViews - out.items.length;
      }
      if (negTheme && kind === "components") {
        const before = out.items.length;
        out.items = out.items.filter((it) => !it.facets || it.facets.theme !== negTheme);
        if (out.items.length < before) out.negative_theme_filtered_out = before - out.items.length;
      }
      // Theme-aware re-rank (components): theme hint from query (dark/light/cinematic)
      // or explicit q.theme reorders so matches come first — never silently drops rows,
      // and always reports checked/kept counts so the re-rank is auditable, not opaque.
      if (kind === "components" && effTheme) {
        const scored = scoreRows(kind, out.items, toks, effTheme);
        const themeOkCount = scored.filter((s) => s.themeOk).length;
        out.theme_hint = effTheme;
        out.theme_checked = scored.length;
        out.theme_kept = out.items.length;
        if (themeOkCount === 0) {
          out.theme_warning = "no " + effTheme + "-theme rows in top results; showing unfiltered, check facets.theme per row";
        } else {
          out.items = scored.map((s) => s.r);
          const dep = scored.length - themeOkCount;
          if (dep > 0) out.theme_deprioritized = dep;
        }
      }
      // Real has_preview for snippet-enriched rows (top 5); the rest stay unknown-list.
      if (presence) {
        for (const it of out.items) {
          if (presence.has(String(it.id)) && it.facets) it.facets = { ...it.facets, has_preview: presence.get(String(it.id)) };
        }
      }
      // ISS15: transparent fallback — agents see what happened, not a magic string.
      // Safety net additionally carries suggested_queries so agents can retry sharp.
      const suggestList = () => { const sq = suggest(toks).filter((s) => !/^[a-z0-9]{8,}$/i.test(s.replace(/\s/g, ""))); return sq.length ? sq : ["hero", "pricing", "landing page"]; };
      if (fallback) {
        out.fallback = fallback; out.isFallback = true;
        const scoredTop = out.items[0];
        const hits = matchOverlap(kind, toks, scoredTop);
        out.fallback_score = "token-overlap:" + hits + "/" + toks.length + "-terms" + (effTheme ? ";theme:" + effTheme : "");
        if (fallback === "popular-safety-net") out.suggested_queries = suggestList();
      }
      else if ((!rows || !rows.length) && toks.length) { out.isFallback = false; out.suggested_queries = suggestList(); }
      // Zero-overlap refusal: fallback engaged but top row matches 0/N tokens —
      // honest empty instead of irrelevant popular rows. Direct hits never refused.
      // Kind-aware: components/assets stay title-only strict; skills/systems use the
      // wider net (title+description+tags+snippets) via matchOverlap.
      if (fallback != null && toks.length > 0) {
        const top = out.items[0];
        const hits2 = matchOverlap(kind, toks, top);
        if (hits2 === 0) {
          const refused = fallback;
          out.items = [];
          out.total = 0;
          out.isFallback = false;
          delete out.fallback;
          delete out.fallback_score;
          out.no_match = true;
          out.refused_fallback = refused;
          out.suggested_queries = suggestList();
          out.note = "Top fallback result matched 0/" + toks.length + " title tokens — empty instead of irrelevant popular rows. Try a suggested query.";
        }
      }
      if (slim) out.items = slimRows(kind, out.items);
      cacheSet(key, out);
      return out;
    })();
    inflight.set(key, p);
    try { return await p; } finally { inflight.delete(key); }
  }

  async function getItem(kind, idOrSlug, opts = {}) {
    const chunk = Math.max(0, opts.chunk ?? 0);
    const wantFull = !!opts.full;
    const key = ["get", kind, String(idOrSlug), "c" + chunk, wantFull ? "full" : "trunc"].join("|");
    const hit = cacheGet(key);
    if (hit) return { ...hit, cached: true };
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(idOrSlug));
    const isNum = /^\d+$/.test(String(idOrSlug));
    const sel = DETAIL_COLS[kind];
    // design_systems + skills: uuid id vs slug; components: numeric id vs slug
    const filt = (kind === "design_systems" || kind === "skills")
      ? (isUuid ? "id=eq." + encodeURIComponent(String(idOrSlug)) : "slug=eq." + encodeURIComponent(String(idOrSlug)))
      : (kind === "components" && !isNum
        ? "slug=eq." + encodeURIComponent(String(idOrSlug))
        : "id=eq." + encodeURIComponent(String(idOrSlug)));
    const url = base + "/rest/v1/" + kind + "?select=" + encodeURIComponent(sel) + "&" + filt + "&limit=1";
    const { rows } = await fetcher.getJson(url, headers);
    if (!rows.length) { const e = new Error("not found: " + kind + " " + idOrSlug); e.code = "NOT_FOUND"; throw e; }
    assertFreeRow(kind, rows[0]); // before enrich/cache: refusals are never cached
    if (!isWellFormedRow(kind, rows[0])) throw new Error("malformed upstream row for " + kind + " " + idOrSlug + ": missing identity/title fields");
    const enriched = await enrichAuthors(rows);
    const full = enriched[0];
    // Chunked fetch: re-slice full blobs per requested chunk so agents can page
    // through 18k-70k payloads instead of hitting one silent truncation wall.
    const item = shapeRow(kind, full, config, facetsFn);
    if (chunk > 0 && !wantFull) {
      if (kind === "components" && typeof full.code === "string") {
        const ch = chunkText(full.code, config.codeChars, chunk);
        item.code = ch.text;
        item.code_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: ch.chunk, truncated: ch.truncated };
      }
      if ((kind === "skills") && typeof full.content === "string") {
        const ch = chunkText(full.content, config.contentChars, chunk);
        item.content = ch.text;
        item.content_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: ch.chunk, truncated: ch.truncated };
      }
      if (kind === "design_systems") {
        if (typeof full.content === "string") {
          const ch = chunkText(full.content, config.contentChars, chunk);
          item.content = ch.text;
          item.content_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: ch.chunk, truncated: ch.truncated };
        }
        if (typeof full.preview_html === "string") {
          const ch = chunkText(full.preview_html, config.codeChars, chunk);
          item.preview_html = ch.text;
          item.preview_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: ch.chunk, truncated: ch.truncated };
        }
      }
    }
    if (wantFull) {
      if (kind === "components" && typeof full.code === "string") {
        item.code = full.code;
        item.code_info = { full_length: full.code.length, chunks: 1, chunk: 0, truncated: false };
      }
      if (kind === "skills" && typeof full.content === "string") {
        item.content = full.content;
        item.content_info = { full_length: full.content.length, chunks: 1, chunk: 0, truncated: false };
      }
      if (kind === "design_systems") {
        if (typeof full.content === "string") {
          item.content = full.content;
          item.content_info = { full_length: full.content.length, chunks: 1, chunk: 0, truncated: false };
        }
        if (typeof full.preview_html === "string") {
          item.preview_html = full.preview_html;
          item.preview_info = { full_length: full.preview_html.length, chunks: 1, chunk: 0, truncated: false };
        }
      }
    }
    const out = { kind, item, cached: false };
    cacheSet(key, out);
    return out;
  }

  async function getStatus() {
    const key = "status";
    const hit = cacheGet(key);
    if (hit) return { ...hit, cached: true };
    const counts = {};
    const jobs = [
      ["components_free", "components?select=id&private=eq.false&premium=eq.false&limit=1"],
      ["components_pro", "components?select=id&private=eq.false&premium=eq.true&limit=1"],
      ["skills", "skills?select=id&private=eq.false&limit=1"],
      ["assets", "assets?select=id&private=eq.false&limit=1"],
      ["design_systems", "design_systems?select=id&private=eq.false&limit=1"],
    ];
    await Promise.all(jobs.map(async ([k, path]) => {
      try { const { total } = await fetcher.getJson(base + "/rest/v1/" + path, headers); counts[k] = total; }
      catch { counts[k] = null; }
    }));
    // Freshness: best-effort MAX(updated_at) per table so agents see staleness.
    // Never throws; null on failure; cached with the status entry.
    const freshness = { components: null, skills: null, assets: null, design_systems: null };
    await Promise.all(Object.keys(freshness).map(async (table) => {
      try {
        const { rows } = await fetcher.getJson(base + "/rest/v1/" + table + "?select=updated_at&order=updated_at.desc&limit=1", headers);
        const v = rows && rows[0] ? rows[0].updated_at : null;
        freshness[table] = v ? String(v) : null;
      } catch { freshness[table] = null; }
    }));
    const out = { site: SITE, catalogue: "aura.build public catalogue (PostgREST, anon)", counts, freshness, cached: false };
    cacheSet(key, out);
    return out;
  }

  async function categoryCounts() {
    const key = 'categories';
    const hit = cacheGet(key);
    if (hit) return hit.categories;
    const cats = ['hero','section','button','card','background','header','logo','feature','pricing','testimonial','footer','form','heading'];
    const out = await Promise.all(cats.map(async (c) => {
      try {
        const url = base + '/rest/v1/components?select=id&private=eq.false&premium=eq.false&tags=cs.{' + c + '}&limit=1';
        const { total } = await fetcher.getJson(url, headers);
        return { category: c, free: total };
      } catch { return { category: c, free: null }; }
    }));
    cacheSet(key, { categories: out });
    return out;
  }

  // Gap 2: editorial picks — human-grade component leads for when views-signal is
  // noise (free trending total=2). Top free by forks (remix = real reuse), then views.
  async function editorialPicks(limit = 5) {
    const lim = Math.max(1, Math.min(limit || 5, 8));
    const sel = encodeURIComponent(LIST_COLS.components);
    const url = base + "/rest/v1/components?select=" + sel + "&private=eq.false&premium=eq.false&order=forks.desc,views.desc&limit=" + lim;
    try {
      const { rows } = await fetcher.getJson(url, headers);
      const enriched = await enrichAuthors(rows);
      return enriched.filter((r) => isWellFormedRow("components", r)).map((r) => slimRows("components", [shapeRow("components", r, config, facetsFn)])[0]);
    } catch { return []; }
  }

  // Bulk fetch: N details in one parallel round (backs aura_bundle + aura_scaffold_page).
  // Limit is 8 end-to-end (matches normRefs validation and the 2–8 docs):
  // duplicates collapse to one fetch, order follows the request, and
  // per-id errors are captured, never thrown: { ok:true, item } or { ok:false, id, error }.
  async function bundleItems(kind, ids, max = 8, opts = {}) {
    const list = [...new Set((ids || []).map(String))].slice(0, Math.max(1, Math.min(max, 8)));
    const out = await Promise.all(list.map(async (id) => {
      try { const got = await getItem(kind, id, { full: !!opts.full }); return { ok: true, id, item: got.item }; }
      catch (e) { return { ok: false, id, error: (e && e.code === "NOT_FOUND") ? "not found" : String((e && e.message) || e).slice(0, 160) }; }
    }));
    return out;
  }

  // Related: same-tag / same-text overlap, views-ranked, excluding self.
  // ISS10: freeOnly default true — free flows never get Pro recommendations.
  async function relatedItems(kind, idOrSlug, limit = 3, freeOnly = true) {
    const got = await getItem(kind, idOrSlug);
    const item = got.item;
    const toks = queryTokens(item.title + " " + (item.description || "")).slice(0, 3);
    const orParts = toks.map((t) => { const v = ilike(t); return "title.ilike." + v + ",description.ilike." + v; });
    const tagF = (kind === "components" && item.tags && item.tags.length) ? "&tags=cs.{" + String(item.tags[0]).toLowerCase() + "}" : "";
    const lim = Math.max(1, Math.min(limit || 3, 8));
    const sel = LIST_COLS[kind];
    const idCol = (kind === "components") ? "id" : "id";
    const selfId = encodeURIComponent(String(item.id));
    const premF = (freeOnly && (kind === "components" || kind === "assets")) ? "&premium=eq.false" : "";
    const url = base + "/rest/v1/" + kind + "?select=" + encodeURIComponent(sel) + "&private=eq.false" + premF + tagF + "&" + idCol + "=neq." + selfId + (orParts.length ? "&or=(" + orParts.join(",") + ")" : "") + "&order=views.desc&limit=" + lim;
    try {
      const { rows } = await fetcher.getJson(url, headers);
      const enriched = await enrichAuthors(rows);
      const wellFormed = enriched.filter((r) => isWellFormedRow(kind, r));
      return { item: shapeRow(kind, item, config), related: slimRows(kind, wellFormed.map((r) => shapeRow(kind, r, config))) };
    } catch { return { item: shapeRow(kind, item, config), related: [] }; }
  }

  return { searchCatalog, getItem, getStatus, categoryCounts, bundleItems, relatedItems, editorialPicks };
}

// ---- protocol.mjs ----
const SERVER_INFO = { name: "aura-components-mcp", version: "1.7.1" };
// Module: protocol — stdio JSON-RPC framing + MCP handshake + error codes.
// One interface: createSession(send) -> { dispatch(msg) }. No business logic.

const PROTOCOL_VERSION = "2024-11-05";

const protocolFn_err = (code, message, data) => ({ code, message, ...(data === undefined ? {} : { data }) });
const Errors = {
  parse: (m) => protocolFn_err(-32700, "Parse error" + (m ? ": " + m : "")),
  invalidRequest: (m) => protocolFn_err(-32600, "Invalid Request" + (m ? ": " + m : "")),
  methodNotFound: (m) => protocolFn_err(-32601, "Method not found: " + m),
  invalidParams: (m) => protocolFn_err(-32602, "Invalid params" + (m ? ": " + m : "")),
  upstream: (m) => protocolFn_err(-32000, "Upstream error" + (m ? ": " + m : "")),
  notFound: (m) => protocolFn_err(-32004, m || "Not found"),
};

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function createSession(send, { tools, handlers }) {
  let initialized = false;
  const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
  const fail = (id, e) => send({ jsonrpc: "2.0", id, error: e });

  async function dispatch(msg) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
      if (msg && "id" in msg && msg.id !== undefined && msg.id !== null) fail(msg.id, Errors.invalidRequest("bad envelope"));
      return;
    }
    const { id, method, params } = msg;
    const isCall = id !== undefined && id !== null;
    try {
      if (method === "initialize") {
        initialized = true;
        if (!isCall) return;
        return ok(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      }
      if (method === "notifications/initialized") return;
      if (method === "ping") { if (isCall) return ok(id, {}); return; }
      if (!initialized) { if (isCall) fail(id, Errors.invalidRequest("not initialized")); return; }
      if (method === "tools/list") { if (isCall) return ok(id, { tools }); return; }
      if (method === "tools/call") {
        if (!isCall) return;
        const name = params?.name;
        const args = params?.arguments ?? {};
        const h = handlers[name];
        if (!h) return fail(id, Errors.methodNotFound("tool " + name));
        try {
          const result = await h(args);
          return ok(id, result);
        } catch (e) {
          if (e && e.code === "NOT_FOUND") return fail(id, Errors.notFound(e.message));
          if (e && e.code === "BAD_ARGS") return fail(id, Errors.invalidParams(e.message));
          return fail(id, Errors.upstream(e?.message ?? String(e)));
        }
      }
      if (isCall) return fail(id, Errors.methodNotFound(method));
    } catch (e) {
      if (isCall) fail(id, Errors.upstream(e?.message ?? String(e)));
    }
  }

  return { dispatch };
}

// ---- guide.mjs ----
// Module: guide — small interface (installGuide, tokenHints, detectNeeds)
// turning raw catalogue rows into paste-ready help: setup steps, file map,
// dependency list, token starter. Derived from row fields, no extra fetches.

const GUIDE_CDN = {
  tailwind: 'https://cdn.tailwindcss.com',
  iconify: 'https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js',
};

// Font allowlist: real families only. Tailwind weight/size utilities (medium, semibold,
// normal, light-as-weight, size-*) are NOT families — old regex leaked them into fonts[].
const KNOWN_FONTS = ['inter', 'geist', 'manrope', 'sora', 'space-grotesk', 'space-mono', 'poppins', 'montserrat', 'playfair-display', 'instrument-serif', 'dm-sans', 'dm-serif-display', 'jetbrains-mono', 'ibm-plex-mono', 'ibm-plex-serif', 'plus-jakarta-sans', 'bricolage-grotesque', 'newsreader', 'fraunces', 'lora', 'merriweather', 'libre-baskerville', 'cormorant-garamond', 'gfs-didot', 'bodoni-moda', 'cardo', 'marcellus', 'gloock', 'aboreto', 'syne', 'urbanist', 'sora', 'anton', 'bebas-neue', 'archivo-black', 'league-gothic', 'fredoka', 'chewy', 'foldit', 'oi', 'honk', 'nabla', 'quicksand', 'nunito', 'work-sans', 'oswald', 'lora', 'roboto', 'open-sans', 'figtree', 'outfit', 'lexend', 'gloria-hallelujah', 'caveat'];
const FONT_RE = /font-(?:family-)?\[?['"]?([a-z][a-z0-9-]*)/g;

function detectNeeds(code, tags) {
  const c = String(code || '').toLowerCase();
  const t = new Set((tags || []).map((x) => String(x).toLowerCase()));
  const needsTailwind = c.includes('class=') || t.has('tailwind');
  // Probes must work on a 2k prefix too: icon svgs usually appear in the first screen of markup.
  // svg alone under-matches in lists (no code fetched) — but must not over-claim either:
  // 'svg' counts only with an icon-ish neighbor (iconify, <svg, lucide, heroicons, feather).
  const needsIcons = c.includes('iconify') || c.includes('<svg') || c.includes('lucide') || c.includes('heroicon') || c.includes('data-lucide');
  const needsKeyframes = c.includes('keyframes') || c.includes('animation:');
  const fonts = new Set();
  for (const m of c.matchAll(FONT_RE)) {
    const fam = m[1].replace(/['"\]]/g, '');
    if (KNOWN_FONTS.includes(fam)) fonts.add(fam);
  }
  // font-family: 'X', Y declarations (not utility classes)
  for (const m of c.matchAll(/font-family\s*:\s*([^;}]{1,80})/g)) {
    for (const part of m[1].split(',')) {
      const fam = part.trim().replace(/['"]/g, '').toLowerCase().replace(/\s+/g, '-');
      if (KNOWN_FONTS.includes(fam)) fonts.add(fam);
    }
  }
  return { needsTailwind, needsIcons, needsKeyframes, fonts: [...fonts].slice(0, 6) };
};

// Facets: cheap derived signals so search lists answer "dark? heavy? pro?" without a get.
// theme: dark|light|mixed|unknown from background field + code palette probes.
// weight: code_chars bucket (s/m/l) so agents can prefer light embeds.
function facets(kind, row, opts) {
  const f = {};
  if (kind === 'components') {
    const bg = String(row.background || '').toLowerCase();
    const tags = (row.tags || []).map((x) => String(x).toLowerCase());
    const code = String(row.code || '').toLowerCase();
    const tagDark = tags.includes('dark');
    const tagLight = tags.includes('light');
    const darkHits = (code.match(/#0{3,6}\b|#1[0-9a-f]{5}\b|bg-black|bg-neutral-9|bg-zinc-9|bg-slate-9|text-white|slate-300/g) || []).length;
    const lightHits = (code.match(/bg-white|bg-neutral-50|bg-slate-50|bg-gray-50|text-black|text-neutral-9/g) || []).length;
    const bgDark = bg.includes('000') && !bg.includes('fff');
    const bgLight = bg.includes('fff') && !bg.includes('000');
    f.theme = bgDark || tagDark ? 'dark' : (bgLight || tagLight ? 'light' : (code ? (darkHits > lightHits * 2 ? 'dark' : (lightHits > darkHits * 2 ? 'light' : (darkHits || lightHits ? 'mixed' : 'unknown'))) : (tags.includes('saas') || tags.includes('minimal') ? 'light' : 'unknown')));
    const n = (opts && opts.fullLength) || String(row.code || '').length;
    f.weight = n > 20000 ? 'l' : (n > 8000 ? 'm' : 's');
    f.code_chars = n;
    const needs = detectNeeds(row.code || '', row.tags || []);
    f.needsTailwind = needs.needsTailwind;
    f.needsIcons = needs.needsIcons;
    f.fonts = needs.fonts;
    f.license = 'all-rights-reserved (Aura Terms §4) — check page_url before commercial reuse';
  }
  // ISS14 lives here too: license is top-level on every asset row, not buried.
  // ISS13: rewrite hotlinked demo images to stable asset references where possible.
  // i.pravatar.cc + bare demo URLs 404 in production; flag them in the install plan.
  if (kind === 'components' && typeof row.code === 'string') {
    const hot = [...row.code.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).filter((u) => /pravatar|placehold|dummyimage|unsplash\/photos\/..\/download|example\.com/i.test(u));
    if (hot.length) row = { ...row, _hotlinked: [...new Set(hot)].slice(0, 5) };
  }
  if (kind === 'assets' || row.image_800w || row.image_original || row.video_url) {
    // Resolved 2026-09-13 from primary source https://www.aura.build/terms §4-5:
    // catalogue content is the exclusive property of DESIGNCODE IO PTE. LTD.;
    // no per-asset license column exists, so commercial reuse needs Aura's permission.
    f.license = 'all-rights-reserved (Aura Terms §4: DESIGNCODE IO PTE. LTD.) — personal/preview use via page_url; commercial reuse needs Aura permission (support@designcode.io)';
    // Gap 5: machine-readable license gate. commercial_ok:false always (no per-asset
    // column exists to prove otherwise) — agents filter without parsing prose.
    f.commercial_ok = false;
    f.terms_url = 'https://www.aura.build/terms';
    f.download = row.image_original || row.image_1600w || row.image_800w || row.video_url || null;
    f.preview = row.image_800w || row.video_poster_url || null;
  }
  if (kind === 'design_systems') {
    // ISS4: lists never fetch preview_html (24KB/row). has_preview:true is authoritative
    // only on detail; on lists report 'unknown-list' so agents fetch instead of trusting false.
    f.has_preview = row.preview_html !== undefined ? Boolean(row.preview_html) : 'unknown-list';
  }
  return f;
}

function installGuide(kind, row) {
  const steps = [];
  const files = [];
  const deps = [];
  const url = row.page_url || '';
  if (kind === 'components') {
    const needs = detectNeeds(row.code || '', row.tags || []);
    if (needs.needsTailwind) {
      deps.push({ name: 'tailwindcss', via: 'CDN or project setup', cdn: GUIDE_CDN.tailwind });
      steps.push('Add the Tailwind CDN script to head for a quick preview, or paste the markup into a Tailwind project.');
    }
    if (needs.needsIcons) {
      deps.push({ name: 'iconify-icon', via: 'CDN', cdn: GUIDE_CDN.iconify });
      steps.push('Add the iconify-icon CDN script so the icon tags render.');
    }
    if (needs.needsKeyframes) steps.push('Keep the embedded style block with the markup: that is where the keyframes live.');
    // ISS11+12: pagination + CSS scoping. Code ships truncated at codeChars; the scope
    // prefix below prevents .button/.inner/.point collisions in multi-component scaffolds.
    const scope = 'aura-' + String(row.slug || row.id).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const fullLen = String(row.code || '').length;
    const isTrunc = /…\[truncated\]$/.test(String(row.code || ''));
    if (isTrunc) {
      files.push({ path: 'components/' + (row.slug || row.id) + '.part1.html', contains: 'markup part 1 of N — fetch aura_get_component again and concatenate code chunks' });
      steps.push('Code is paginated (' + fullLen + ' chars shown of more): install part files in order, or re-fetch for the full body.');
    } else {
      files.push({ path: 'components/' + (row.slug || row.id) + '.html', contains: 'section markup plus its style block' });
    }
    steps.push('Scope global CSS before pasting: prefix bare selectors (.button, .inner, .point) with .' + scope + ' to avoid collisions in multi-component pages.');
    steps.push('Paste the markup where the section belongs and update the CTA link (it ships as #).');
    if (url) steps.push('Preview first: ' + url);
    if (row._hotlinked && row._hotlinked.length) steps.push('Replace demo images before shipping (' + row._hotlinked.slice(0, 3).join(', ') + '): hotlinked placeholders 404 in production — swap for aura_search_assets results.');
    if (needs.fonts.length) files.push({ path: 'styles/fonts.css', contains: 'font families referenced: ' + needs.fonts.join(', ') });
    // Chunk concat helper: truncated installs carry the exact re-fetch plan so no
    // agent is left guessing how part files map to chunks.
    const ci = row.code_info || null;
    const concat = isTrunc ? {
      tool: 'aura_get_component',
      id: row.slug || row.id,
      chunks: (ci && ci.chunks) || 'unknown — call once with chunk:0 and read code_info.chunks',
      how: 'call aura_get_component with chunk:0..chunks-1 and concatenate code in order; part files above map 1:1 to chunks',
    } : null;
    const css_scope_how = 'in the pasted <style>, rewrite every bare class selector as .' + scope + ' <selector> (e.g. .button -> .' + scope + ' .button); leave Tailwind utilities, :root vars, and @keyframes names untouched';
    return { kind, title: row.title, page_url: url, free: row.premium === false, steps, deps, files, needs, css_scope: scope, css_scope_how, code_truncated: isTrunc, ...(concat ? { concat } : {}) };
  }
  if (kind === 'skills') {
    steps.push('Read the SKILL.md content from aura_get_skill first: it names its own triggers and pitfalls.');
    steps.push('Save it as SKILL.md inside your agent skills folder so the agent can load it.');
    if (row.source_url) steps.push('Upstream source: ' + row.source_url);
    return { kind, title: row.title, page_url: url, steps, deps, files: [{ path: 'skills/' + row.id + '/SKILL.md', contains: 'full skill content' }] };
  }
  if (kind === 'design_systems') {
    // ISS6: derive preview deps from preview_html so agents don't ship static pages.
    const ph = String(row.preview_html || '');
    const pl = ph.toLowerCase();
    const has = (...ss) => ss.some((s) => pl.includes(s));
    if (has('cdn.tailwindcss.com', 'tailwind')) deps.push({ name: 'tailwindcss', via: 'CDN (in preview_html)', cdn: GUIDE_CDN.tailwind });
    if (has('iconify', '<svg', 'lucide', 'data-lucide')) deps.push({ name: 'iconify-icon', via: 'CDN (in preview_html)', cdn: GUIDE_CDN.iconify });
    if (has('gsap')) deps.push({ name: 'gsap', via: 'CDN (in preview_html)', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js' });
    if (has('scrolltrigger')) deps.push({ name: 'gsap-ScrollTrigger', via: 'CDN (in preview_html)', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js' });
    const fonts = new Set();
    for (const m of pl.matchAll(/family=([a-z+]+)/g)) fonts.add(m[1].replace(/\+/g, '-'));
    if (fonts.size) deps.push({ name: 'google-fonts:' + [...fonts].slice(0, 4).join(','), via: 'link (in preview_html)' });
    steps.push('Copy the DESIGN.md content into your repo as DESIGN.md and treat it as the source of truth.');
    steps.push('Apply the color, type, and spacing tokens before copying any component markup.');
    if (deps.length) steps.push('Install preview deps first (' + deps.map((d) => d.name).join(', ') + ') — the preview_html needs them.');
    return { kind, title: row.title, page_url: url, steps, deps, files: [{ path: 'DESIGN.md', contains: 'tokens and rules' }] };
  }
  steps.push('Use the image_800w URL for previews and image_original for production.');
  return { kind, title: row.title, page_url: url, steps, deps, files };
};

// Scaffold merge: one ordered page from a system + component rows. Owns the
// dep-dedupe and file-collection rules so the scaffold handler stays a thin
// adapter (fetch + freeOnly policy) and tests cross this seam, not the wire.
function combineScaffold(sysItem, comps) {
  const guides = (comps || []).map((c) => installGuide('components', c));
  const deps = []; const seen = new Set();
  for (const g of guides) for (const d of (g.deps || [])) if (!seen.has(d.name)) { seen.add(d.name); deps.push(d); }
  const files = [{ path: 'styles/tokens.css', contains: 'tokens.css from use_design_system' }];
  if (sysItem) files.push({ path: 'DESIGN.md', contains: 'system rules' });
  for (const g of guides) for (const f of (g.files || [])) files.push(f);
  return { guides, combined_deps: deps, files };
}

// ISS5: full token surface — colors + typography + spacing + radius — so scaffolded
// pages don't lose the system. Also detects preview dark/light mode so agents don't
// apply light-cream tokens to a dark preview body.
function previewMode(previewHtml) {
  const h = String(previewHtml || '').toLowerCase();
  if (/bg-black|bg-neutral-950|bg-zinc-950|bg-slate-950|bg-\[#0/.test(h)) return 'dark';
  if (/bg-white|bg-neutral-50|bg-slate-50/.test(h)) return 'light';
  return 'unknown';
}

function tokenHints(content, previewHtml) {
  const Q = String.fromCharCode(39);
  const lines = String(content || '').split(Q + 'n' === Q + 'n' ? '\n' : '\n');
  const get = (key) => {
    const line = lines.find((l) => { const t = l.trim().toLowerCase(); return t === key + ':' || t.startsWith(key + ': ') || t.startsWith(key + ' :') || t.startsWith(key + ':\"') || t.startsWith(key + ":'"); });
    if (!line) return null;
    const t = line.trim();
    const ci = t.toLowerCase().indexOf(key);
    let v = t.slice(ci + key.length).trim();
    if (v.startsWith(':')) v = v.slice(1).trim();
    while (v.startsWith(Q) || v.startsWith('"')) v = v.slice(1);
    while (v.endsWith(Q) || v.endsWith('"')) v = v.slice(0, -1);
    return v.trim() || null;
  };
  const tokens = {
    primary: get('primary'),
    secondary: get('secondary'),
    accent: get('accent'),
    background: get('background'),
    surface: get('surface'),
    text_primary: get('text-primary') || get('text_primary'),
    text_secondary: get('text-secondary') || get('text_secondary'),
    border: get('border'),
    display_font: get('display_lg_fontfamily') || get('display-font'),
    body_font: get('body_md_fontfamily') || get('body-font'),
    mono_font: get('label_md_fontfamily') || get('mono-font'),
    section_padding: get('section-padding') || get('section_padding'),
    card_padding: get('card-padding') || get('card_padding'),
    card_radius: get('card') === null ? get('card_radius') : null,
    control_radius: get('control'),
    pill_radius: get('pill'),
  };
  const pick = (obj, keys) => { const o = {}; for (const k of keys) if (obj[k]) o[k] = obj[k]; return o; };
  const colors = pick(tokens, ['primary', 'secondary', 'accent', 'background', 'surface', 'text_primary', 'text_secondary', 'border']);
  const rows = [];
  for (const [k, v] of Object.entries(colors)) rows.push('  --aura-' + k.replace(/_/g, '-') + ': ' + v + ';');
  if (tokens.body_font) rows.push('  --aura-font-body: ' + tokens.body_font + ';');
  if (tokens.display_font) rows.push('  --aura-font-display: ' + tokens.display_font + ';');
  if (tokens.mono_font) rows.push('  --aura-font-mono: ' + tokens.mono_font + ';');
  if (tokens.section_padding) rows.push('  --aura-section-padding: ' + tokens.section_padding + ';');
  if (tokens.card_padding) rows.push('  --aura-card-padding: ' + tokens.card_padding + ';');
  if (tokens.card_radius) rows.push('  --aura-radius-card: ' + tokens.card_radius + ';');
  if (tokens.control_radius) rows.push('  --aura-radius-control: ' + tokens.control_radius + ';');
  if (tokens.pill_radius) rows.push('  --aura-radius-pill: ' + tokens.pill_radius + ';');
  const css = rows.length ? ':root{' + '\n' + rows.join('\n') + '\n}' : '';
  const mode = previewMode(previewHtml);
  const warn = (mode === 'dark' && tokens.background && !/000|0f1115|111827|1a1a1a|09090b/i.test(tokens.background))
    ? 'tokens say light background ' + tokens.background + ' but preview_html renders dark — follow the preview body, not the tokens, or ask which mode is wanted'
    : ((mode === 'light' && tokens.background && /000000|0f1115/i.test(tokens.background))
      ? 'tokens say dark background but preview renders light — follow the preview body'
      : null);
  return { tokens, css, ...(mode === 'unknown' ? {} : { preview_mode: mode }), mode_warning: warn };
}

// Module: prompt — deep module, small interface (buildPrompt) over all
// need-based prompt rules. Pure, no fetch: same seam for tool + tests + docs.
// Pass 1 (no answers): draft + questions[<=4] + next_call. Agent MUST ask the
// user via native question UI before Pass 2. Pass 2 (with answers): final.
const PROMPT_SOURCES = [
  'https://www.aura.build/learn/tips-for-prompting',
  'https://www.aura.build/learn/introduction',
  'https://www.aura.build/design-systems',
];
const PROMPT_CREDIT = 'Built by swastiksingh-dev — catalogue by Aura (aura.build)';
const PROMPT_ORDER = ['1 tokens.css', '2 system preview_html', '3 component markup in listed order'];

function promptThemeHint(goal, explicit) {
  if (explicit === 'dark' || explicit === 'light') return explicit;
  const t = String(goal || '').toLowerCase();
  if (/\bdark\b|\bmidnight\b|\bnoir\b|\bcinematic\b/.test(t) && !/\blight\b|\bbright\b|\bairy\b/.test(t)) return 'dark';
  if (/\blight\b|\bbright\b|\bairy\b/.test(t)) return 'light';
  return null;
}

function draftPromptText(goal, theme) {
  const th = theme ? theme + ' theme' : 'theme to confirm with user';
  return 'Build: ' + goal + ' (' + th + '). Use Tailwind CSS with container mx-auto px-4, hex palette, numeric color scale 50-900, 8px radius, 768px hamburger breakpoint, hover scale 1.05 + shadow. Typography: Inter 40-60 / 28-36 / 14-16, weights 640/560/460. Motion <500ms + prefers-reduced-motion. Tokens first (DESIGN.md), then markup. Confirm theme/sections/system with user before scaffolding.';
}

function finalPromptText(goal, a) {
  const theme = a.theme || 'confirm with user';
  const sections = (a.sections && a.sections.length ? a.sections.join(', ') : 'hero + 2 sections');
  const system = a.system || 'auto-pick via aura_search_design_systems';
  const assets = a.assets || 'only if needed via aura_search_assets';
  return 'GOAL: ' + goal + '\n'
    + 'THEME: ' + theme + ' (tokens first, follow preview body on mismatch)\n'
    + 'SECTIONS: ' + sections + '\n'
    + 'DESIGN SYSTEM: ' + system + ' — copy DESIGN.md as source of truth, apply color/type/spacing before markup\n'
    + 'ASSETS: ' + assets + '\n'
    + 'RULES: Tailwind container mx-auto px-4; hex palette 50-900; radius 8px; breakpoints 1024+/768-1023/<768, 44px touch targets; hover scale 1.05 + shadow; Inter 40-48 H1 / 16 body; motion <500ms + prefers-reduced-motion; vanilla HTML/Tailwind/JS, no proprietary runtime\n'
    + 'ORDER: 1 tokens.css, 2 system preview_html, 3 component markup\n'
    + 'CALLS: aura_recommend -> aura_get_* finalists -> aura_use_design_system -> aura_scaffold_page';
}

function buildPrompt(input = {}) {
  const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
  if (!goal) { const e = new Error('goal (string) is required'); e.code = 'BAD_ARGS'; throw e; }
  const themeIn = input.theme === 'dark' || input.theme === 'light' ? input.theme : undefined;
  if (input.theme !== undefined && themeIn === undefined) { const e = new Error('theme must be dark|light'); e.code = 'BAD_ARGS'; throw e; }
  const theme = promptThemeHint(goal, themeIn);
  const system = typeof input.system === 'string' && input.system.trim() ? input.system.trim() : null;
  const surfaces = Array.isArray(input.surfaces) ? input.surfaces.filter((s) => typeof s === 'string').slice(0, 4) : [];
  const answers = input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers) ? input.answers : null;

  if (!answers) {
    const questions = [
      { key: 'theme', question: 'Which theme — dark or light?', options: ['dark', 'light'] },
      { key: 'sections', question: 'Which sections (e.g. hero, pricing, testimonial, footer)?', options: [] },
      { key: 'system', question: 'Which DESIGN system, or auto-pick?', options: system ? [system, 'auto-pick'] : ['auto-pick'] },
      { key: 'assets', question: 'Need images/video?', options: ['no', 'images', 'video'] },
      { key: 'macrostructure', question: 'Which page macrostructure (e.g. bento-grid, marquee-hero, long-document), or auto-pick from Inspo evidence?', options: ['auto-pick', 'bento-grid', 'marquee-hero', 'long-document', 'photographic', 'stat-led'] },
      { key: 'vibe', question: 'Which mood — calm, serious, luxe, playful, technical?', options: ['calm', 'serious', 'luxe', 'playful', 'technical', 'warm'] },
    ];
    return {
      phase: 'draft',
      goal,
      theme_hint: theme,
      draft_prompt: draftPromptText(goal, theme),
      questions,
      missing: ['theme', 'sections', 'system', 'assets', 'macrostructure', 'vibe'],
      next_call: { tool: 'aura_prompt', arguments: { goal, answers: { theme: theme || 'dark', sections: [], system: system || 'auto-pick', assets: 'no', macrostructure: 'auto-pick', vibe: 'calm' } } },
      plan_order: PROMPT_ORDER,
      sources: PROMPT_SOURCES,
      credit: PROMPT_CREDIT,
      inspo_axes: { mode_maps_to: 'theme', macrostructures: INSPO_MACROS.slice(0, 6), note: 'Run inspo.recommend first for evidence, then aura_inspo_recommend to map it onto Aura calls. Mode folds into theme.' },
      note: 'Ask the user these questions via native question UI, then call aura_prompt again with goal + answers. Never skip confirmation.',
    };
  }

  const a = {
    theme: answers.theme === 'dark' || answers.theme === 'light' ? answers.theme : (theme || 'dark'),
    sections: Array.isArray(answers.sections) ? answers.sections.filter((s) => typeof s === 'string').slice(0, 6) : [],
    system: typeof answers.system === 'string' && answers.system.trim() ? answers.system.trim() : (system || 'auto-pick'),
    assets: typeof answers.assets === 'string' ? answers.assets : 'no',
    macrostructure: typeof answers.macrostructure === 'string' && answers.macrostructure.trim() ? answers.macrostructure.trim() : 'auto-pick',
    vibe: typeof answers.vibe === 'string' && answers.vibe.trim() ? answers.vibe.trim() : 'calm',
  };
  return {
    phase: 'final',
    goal,
    answers: a,
    final_prompt: finalPromptText(goal, a),
    plan_order: PROMPT_ORDER,
    suggested_calls: [
      { tool: 'inspo.recommend', arguments: { brief: goal, mode: a.theme, vibe: a.vibe, ...(a.macrostructure !== 'auto-pick' ? { macrostructure: a.macrostructure } : {}) } },
      { tool: 'aura_inspo_recommend', arguments: { brief: goal, mode: a.theme, vibe: a.vibe, ...(a.macrostructure !== 'auto-pick' ? { macrostructure: a.macrostructure } : {}) } },
      { tool: 'aura_recommend', arguments: { goal } },
      { tool: 'aura_search_all', arguments: { query: goal, limit: 3 } },
      { tool: 'aura_use_design_system', arguments: a.system !== 'auto-pick' ? { slug: a.system } : { slug: 'auto-pick: search first' } },
      { tool: 'aura_scaffold_page', arguments: { goal, system: a.system } },
    ],
    page_urls: ['https://www.aura.build/design-systems', 'https://www.aura.build/components'],
    sources: PROMPT_SOURCES,
    surfaces: surfaces.length ? surfaces : ['components', 'design_systems', 'assets', 'skills'],
    credit: PROMPT_CREDIT,
  };
};

// Module: inspo-mappers — pure zero-dep translators between Inspo evidence and
// Aura calls. No fetch: the agent pastes slim Inspo evidence in, gets Aura call
// plans out. Same seam for tools + tests + docs (mirrors buildPrompt).
const INSPO_MACROS = ['bento-grid', 'long-document', 'marquee-hero', 'stat-led', 'conversational-faq', 'manifesto', 'photographic', 'specimen', 'catalogue', 'letter', 'index-first', 'narrative-workflow', 'split-studio', 'feature-stack', 'type-specimen', 'portfolio-grid', 'map-diagram', 'ecosystem-index', 'component-playground'];
const INSPO_VIBES = ['calm', 'loud', 'playful', 'serious', 'luxe', 'raw', 'soft', 'technical', 'warm', 'cold'];
const INSPO_MODES = ['light', 'dark'];
const INSPO_COMP_TYPES = ['hero', 'pricing', 'features', 'cta', 'nav', 'footer', 'testimonial', 'logo-cloud', 'faq', 'stat'];
const INSPO_STYLES = ['minimalism', 'editorial', 'brutalism', 'glassmorphism', 'swiss', 'maximalism', 'playful', 'dark-mode', 'monochrome', 'vintage', 'futurist'];
const INSPO_MACRO_TO_CATEGORY = {
  'bento-grid': 'feature', 'long-document': 'section', 'marquee-hero': 'hero',
  'stat-led': 'feature', 'conversational-faq': 'form', 'manifesto': 'heading',
  'photographic': 'background', 'specimen': 'card', 'catalogue': 'card',
  'letter': 'heading', 'index-first': 'header', 'narrative-workflow': 'section',
  'split-studio': 'hero', 'feature-stack': 'feature', 'type-specimen': 'heading',
  'portfolio-grid': 'card', 'map-diagram': 'feature', 'ecosystem-index': 'section',
  'component-playground': 'section',
};
const INSPO_COMP_TO_CATEGORY = {
  hero: 'hero', pricing: 'pricing', features: 'feature', cta: 'section',
  nav: 'header', footer: 'footer', testimonial: 'testimonial',
  'logo-cloud': 'logo', faq: 'form', stat: 'feature',
};
const INSPO_LICENSE = 'Reference JSX is Inspo-canonical (copy-pasteable, tweak tokens to the brand). Aura markup/assets are all-rights-reserved per Aura Terms §4 — fine to prototype, check each page_url before commercial ship.';
const INSPO_SLIM_KEYS = ['slug', 'palette', 'fonts', 'macro', 'macrostructure', 'mode', 'vibe', 'style', 'type', 'id', 'brief', 'brand_hex', 'background', 'text'];
// Palette priority (locked): brand hex > Inspo evidence > Aura tokens. Aura keeps structure/spacing.
const INSPO_ORDER = ['1 tokens.css', '2 system preview_html', '3 component markup in listed order'];
const INSPO_IMAGE_PLAN = { draft: 'image_800w', prod: 'image_original', srcset: [320, 800, 1600], alt_from: 'title', swap_hotlinked: ['pravatar', 'placehold', 'dummyimage', 'example.com'], weight_cap: 's|m only — full:true on the winner alone' };

function inspoBad(msg) { const e = new Error(msg); e.code = 'BAD_ARGS'; throw e; }
function inspoHex(v, name) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^#?[0-9a-f]{3}([0-9a-f]{3})?$|^#?[0-9a-f]{6}$/i.test(v.trim())) inspoBad(name + ' must be a hex color like "#c7402f"');
  const h = v.trim().replace(/^#/, '');
  return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h).toLowerCase();
}
function inspoLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function inspoContrastWarn(bg, text) {
  if (!bg || !text) return null;
  const l1 = inspoLum(bg), l2 = inspoLum(text);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return ratio < 4.5 ? 'contrast ' + ratio.toFixed(2) + ':1 (' + bg + ' on ' + text + ') is below 4.5 — ask the user which side moves' : null;
}
function inspoSlimCheck(ev, name) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) inspoBad(name + ' must be an object with slim keys only: ' + INSPO_SLIM_KEYS.join(','));
  for (const k of Object.keys(ev)) {
    if (!INSPO_SLIM_KEYS.includes(k)) inspoBad(name + '.' + k + ' is not slim — pass slugs+palette+fonts+macro+mode+vibe only, no autopsy/screenshots');
  }
  return ev;
}

function buildInspoRecommend(input = {}) {
  const brief = typeof input.brief === 'string' ? input.brief.trim() : '';
  if (!brief) inspoBad('brief (string) is required');
  const mode = input.mode === undefined ? undefined : (INSPO_MODES.includes(input.mode) ? input.mode : inspoBad('mode must be light|dark'));
  const vibe = input.vibe === undefined ? undefined : (INSPO_VIBES.includes(input.vibe) ? input.vibe : inspoBad('vibe must be one of ' + INSPO_VIBES.join('|')));
  const macro = input.macrostructure === undefined ? undefined : (INSPO_MACROS.includes(input.macrostructure) ? input.macrostructure : inspoBad('macrostructure must be one of ' + INSPO_MACROS.join('|')));
  const brand = inspoHex(input.brand_hex, 'brand_hex');
  // Strict macro gate (locked): no macro on file means run Inspo first — never scaffold generic.
  if (!macro) {
    return {
      need_macro: true,
      brief, mode: mode || null, vibe: vibe || null, brand_hex: brand || null,
      inspo_call: { tool: 'inspo.recommend', arguments: { brief, ...(mode ? { mode } : {}), ...(vibe ? { vibe } : {}) } },
      note: 'No macrostructure yet — call inspo.recommend first, then call aura_inspo_recommend again with its macrostructure. Never scaffold without a macro.',
      palette_priority: ['brand_hex', 'inspo_evidence', 'aura_tokens'],
      order: INSPO_ORDER,
      license_note: INSPO_LICENSE,
    };
  }
  const category = INSPO_MACRO_TO_CATEGORY[macro];
  return {
    need_macro: false,
    brief, mode: mode || null, vibe: vibe || null, brand_hex: brand || null,
    macrostructure: macro, aura_category: category,
    inspo_call: { tool: 'inspo.recommend', arguments: { brief, macrostructure: macro, ...(mode ? { mode } : {}), ...(vibe ? { vibe } : {}) } },
    aura_calls: [
      { tool: 'aura_search_all', arguments: { query: brief, limit: 3, ...(mode ? { theme: mode } : {}) } },
      { tool: 'aura_recommend', arguments: { goal: brief, ...(mode ? { theme: mode } : {}) } },
      { tool: 'aura_search_components', arguments: { query: brief, category, ...(mode ? { theme: mode } : {}) } },
    ],
    palette_priority: ['brand_hex', 'inspo_evidence', 'aura_tokens'],
    image_plan: INSPO_IMAGE_PLAN,
    order: INSPO_ORDER,
    next: { tool: 'aura_inspo_components', arguments: { evidence: { type: 'hero', macrostructure: macro, ...(mode ? { mode } : {}) }, brief } },
    license_note: INSPO_LICENSE,
  };
}

function buildInspoComponents(input = {}) {
  const ev = input.evidence && typeof input.evidence === 'object' && !Array.isArray(input.evidence) ? input.evidence : inspoBad('evidence {type, ...} is required');
  if (!INSPO_COMP_TYPES.includes(ev.type)) inspoBad('evidence.type must be one of ' + INSPO_COMP_TYPES.join('|'));
  if (ev.style !== undefined && !INSPO_STYLES.includes(ev.style)) inspoBad('evidence.style must be one of ' + INSPO_STYLES.join('|'));
  if (ev.macrostructure !== undefined && !INSPO_MACROS.includes(ev.macrostructure)) inspoBad('evidence.macrostructure must be one of ' + INSPO_MACROS.join('|'));
  if (ev.mode !== undefined && !INSPO_MODES.includes(ev.mode)) inspoBad('evidence.mode must be light|dark');
  for (const k of Object.keys(ev)) {
    if (!['type', 'style', 'macrostructure', 'mode', 'macro', 'vibe'].includes(k)) inspoBad('evidence.' + k + ' is not slim — type/style/macrostructure/mode only');
  }
  const brief = typeof input.brief === 'string' && input.brief.trim() ? input.brief.trim() : ev.type;
  const category = INSPO_COMP_TO_CATEGORY[ev.type];
  return {
    evidence: { ...ev },
    aura_category: category,
    inspo_call: { tool: 'inspo.find_components', arguments: { ...ev } },
    aura_search: { tool: 'aura_search_components', arguments: { query: brief, category, ...(ev.mode ? { theme: ev.mode } : {}) } },
    scaffold_hint: { order: INSPO_ORDER, weight_cap: 's|m only', tokens_first: true },
    image_plan: INSPO_IMAGE_PLAN,
    license_note: INSPO_LICENSE,
  };
}

function buildInspoReference(input = {}) {
  const ev = input.evidence && typeof input.evidence === 'object' && !Array.isArray(input.evidence) ? input.evidence : inspoBad('evidence {type, id} is required');
  if (!INSPO_COMP_TYPES.includes(ev.type)) inspoBad('evidence.type must be one of ' + INSPO_COMP_TYPES.join('|'));
  if (typeof ev.id !== 'string' || !ev.id.trim()) inspoBad('evidence.id (string) is required');
  const ac = input.aura_component && typeof input.aura_component === 'object' && !Array.isArray(input.aura_component) ? input.aura_component : inspoBad('aura_component {id|slug} is required');
  const ref = typeof ac.id === 'string' && ac.id ? ac.id : (typeof ac.slug === 'string' && ac.slug ? ac.slug : inspoBad('aura_component needs id or slug'));
  const scope = 'aura-' + String(ref).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return {
    evidence: { type: ev.type, id: ev.id.trim() },
    aura_component: ref,
    inspo_call: { tool: 'inspo.get_reference_jsx', arguments: { type: ev.type, id: ev.id.trim() } },
    aura_call: { tool: 'aura_get_component', arguments: { id: ref } },
    adapt_plan: {
      scope, css_scope_how: 'rewrite bare selectors as .' + scope + ' <selector>; leave Tailwind utilities, :root vars, @keyframes untouched',
      token_swaps: ['--inspo-* -> --aura-* (brand hex wins ties)'],
      files: [{ path: 'styles/tokens.css', contains: 'merged tokens first' }, { path: 'components/' + ref + '.html', contains: 'adapted markup' }],
      steps: ['Fetch both sources', 'Swap Inspo tokens to brand/Aura tokens', 'Scope CSS with .' + scope, 'Replace hotlinked demo images (see image_plan)'],
    },
    image_plan: INSPO_IMAGE_PLAN,
    license_note: INSPO_LICENSE,
  };
}

function buildInspoSystem(input = {}) {
  const toks = input.inspo_tokens && typeof input.inspo_tokens === 'object' && !Array.isArray(input.inspo_tokens) ? inspoSlimCheck(input.inspo_tokens, 'inspo_tokens') : inspoBad('inspo_tokens {palette, fonts, ...} is required');
  const slug = typeof input.aura_system === 'string' && input.aura_system.trim() ? input.aura_system.trim()
    : (input.aura_system && typeof input.aura_system.slug === 'string' && input.aura_system.slug.trim() ? input.aura_system.slug.trim() : inspoBad('aura_system slug (string) is required'));
  const palette = Array.isArray(toks.palette) ? toks.palette.map((c) => inspoHex(c, 'inspo_tokens.palette[]')) : [];
  const brand = inspoHex(toks.brand_hex, 'inspo_tokens.brand_hex');
  const bg = toks.background ? inspoHex(toks.background, 'inspo_tokens.background') : (brand || palette[0]);
  const tx = toks.text ? inspoHex(toks.text, 'inspo_tokens.text') : null;
  const contrast_warning = bg && tx ? inspoContrastWarn(bg, tx) : null;
  return {
    aura_system: slug,
    palette_priority: ['brand_hex', 'inspo_evidence', 'aura_tokens'],
    optionA_inspo: { palette, fonts: Array.isArray(toks.fonts) ? toks.fonts.slice(0, 4) : [] },
    optionB_aura: { fetch: { tool: 'aura_get_design_system', arguments: { slug } }, note: 'Fetch Aura tokens, then compare side by side.' },
    optionC_blend: { colors_from: brand ? 'brand_hex' : 'inspo palette', structure_from: 'aura DESIGN.md', note: 'Brand/Inspo colors on Aura spacing/type skeleton.' },
    contrast_warning,
    question: { key: 'system_choice', question: 'Inspo palette and Aura tokens disagree — which wins?', options: ['A-inspo', 'B-aura', 'C-blend'] },
    files: [{ path: 'styles/tokens.css', contains: 'merged winning tokens — paste first' }, { path: 'DESIGN.md', contains: 'winning system rules' }],
    order: INSPO_ORDER,
    tokens_first: true,
    license_note: INSPO_LICENSE,
  };
}

function buildInspoCompare(input = {}) {  const list = Array.isArray(input.evidence) ? input.evidence : inspoBad('evidence must be an array of 2-4 slim site objects');
  if (list.length < 2 || list.length > 4) inspoBad('evidence must hold 2-4 sites — got ' + list.length);
  const sites = list.map((s, i) => {
    const o = inspoSlimCheck(s, 'evidence[' + i + ']');
    if (typeof o.slug !== 'string' || !o.slug.trim()) inspoBad('evidence[' + i + '].slug (string) is required');
    if (o.mode !== undefined && !INSPO_MODES.includes(o.mode)) inspoBad('evidence[' + i + '].mode must be light|dark');
    if (o.macrostructure !== undefined && !INSPO_MACROS.includes(o.macrostructure)) inspoBad('evidence[' + i + '].macrostructure must be one of ' + INSPO_MACROS.join('|'));
    return o;
  });
  const votes = {};
  for (const s of sites) for (const k of ['macrostructure', 'macro', 'mode']) {
    if (s[k]) votes[s[k]] = (votes[s[k]] || 0) + 1;
  }
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const house = { macrostructure: (sites.map((s) => s.macrostructure || s.macro).find(Boolean)) || null, mode: sites.map((s) => s.mode).find(Boolean) || null, agreement: top ? top[0] + ' x' + top[1] + '/' + sites.length : 'none' };
  const macro = house.macrostructure;
  const category = macro && INSPO_MACRO_TO_CATEGORY[macro] ? INSPO_MACRO_TO_CATEGORY[macro] : null;
  return {
    sites: sites.map((s) => s.slug),
    house_style: house,
    inspo_call: { tool: 'inspo.compare', arguments: { slugs: sites.map((s) => s.slug) } },
    closest_aura_systems_query: { tool: 'aura_search_design_systems', arguments: { query: macro || house.agreement, limit: 3 } },
    ranked_components_query: category ? { tool: 'aura_search_components', arguments: { query: macro, category } } : null,
    order: INSPO_ORDER,
    license_note: INSPO_LICENSE,
  };
}

// Module: docs-helpers — pure planners linking Aura output to fresh Context7
// docs. No fetch: the agent calls Context7, Aura shapes the lookup and applies
// the answer. Same seam for tools + tests + docs.
const DOCS_TRUSTED = {
  tailwind: { label: 'Tailwind CSS', resolve: 'tailwindcss', id: null, cdn: 'https://cdn.tailwindcss.com', aura: ['installGuide tailwindcss dep', 'styles/tokens.css', 'scaffold order'] },
  gsap: { label: 'GSAP + ScrollTrigger', resolve: 'gsap', id: null, cdn: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js', aura: ['installGuide gsap dep', 'preview_html motion'] },
  lenis: { label: 'Lenis smooth scroll', resolve: 'lenis', id: '/darkroomengineering/lenis', cdn: 'unpkg lenis@1 (confirm exact file via lookup)', aura: ['aura_motion_smooth wiring'] },
  iconify: { label: 'Iconify icons', resolve: 'iconify', id: null, cdn: 'https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js', aura: ['installGuide iconify-icon dep'] },
};
// Markers verified against renames we know happened; version pins below are
// never declared stale — they go to needs_check for a live lookup instead.
const DOCS_STALE_MARKERS = [
  { lib: 'lenis', re: /studio-freight/i, fix: 'Package renamed studio-freight -> lenis. Swap the import/CDN path, keep option names; look unchanged.' },
];
const DOCS_PIN_HINTS = [
  { lib: 'tailwind', re: /cdn\.tailwindcss\.com/i, check: 'Confirm v3 Play CDN vs v4 @tailwindcss/browser build via lookup.' },
  { lib: 'gsap', re: /cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/[\d.]+/i, check: 'Confirm latest 3.x pin via lookup.' },
  { lib: 'lenis', re: /unpkg\.com\/lenis/i, check: 'Confirm latest 1.x file via lookup.' },
  { lib: 'iconify', re: /iconify-icon\/[\d.]+/i, check: 'Confirm latest iconify-icon pin via lookup.' },
];
const DOCS_DEP_TO_LIB = { tailwindcss: 'tailwind', gsap: 'gsap', 'gsap-ScrollTrigger': 'gsap', 'iconify-icon': 'iconify' };

function docsBad(msg) { const e = new Error(msg); e.code = 'BAD_ARGS'; throw e; }

function docsStampFor(deps) {
  const libs = [];
  for (const d of (deps || [])) {
    const lib = DOCS_DEP_TO_LIB[d && d.name];
    if (lib && !libs.includes(lib)) libs.push(lib);
  }
  return {
    status: 'unchecked',
    needs_check: libs.map((l) => l + ': confirm CDN/version via aura_docs_plan + Context7'),
    note: 'Vendored Aura code is a snapshot — verify pins before shipping.',
  };
}

function buildDocsPlan(input = {}) {
  const raw = typeof input.library === 'string' ? input.library.trim().toLowerCase() : '';
  if (!raw) docsBad('library (string) is required');
  const need = typeof input.need === 'string' ? input.need.trim() : '';
  if (!need) docsBad('need (string) is required — what question should the docs answer?');
  const t = DOCS_TRUSTED[raw] || null;
  return {
    library: raw,
    trusted: !!t,
    context7: t
      ? { resolve: t.resolve, ...(t.id ? { id: t.id } : {}), query: need, note: t.id ? 'ID verified — query it directly.' : 'Resolve the id first via Context7, then query.' }
      : { resolve: raw, query: need, note: 'Unlisted library — resolve the id first via Context7, then query. Apply guidance is generic.' },
    apply: t
      ? { aura_touchpoints: t.aura, steps: ['Look up via Context7', 'Adapt Aura code to the fresh API (keep the look identical)', 'Update the docs_stamp from unchecked to checked'] }
      : { aura_touchpoints: [], steps: ['Look up via Context7', 'Apply carefully — no Aura mapping exists for this library'] },
    stamp: { status: 'planned', needs_check: [raw + ': ' + need] },
  };
}

function buildDocsCheck(input = {}) {
  const raw = typeof input.library === 'string' ? input.library.trim().toLowerCase() : '';
  if (!raw) docsBad('library (string) is required');
  const code = typeof input.code_excerpt === 'string' ? input.code_excerpt : docsBad('code_excerpt (string) is required');
  if (!code.trim()) docsBad('code_excerpt must not be empty');
  if (code.length > 20000) docsBad('code_excerpt is ' + code.length + ' chars — paste excerpts under 20000 chars, not full pages');
  const note = typeof input.docs_note === 'string' && input.docs_note.trim() ? input.docs_note.trim() : null;
  const fixes = [];
  for (const m of DOCS_STALE_MARKERS) {
    if (m.re.test(code)) fixes.push({ lib: m.lib, fix: m.fix });
  }
  const needs = [];
  for (const h of DOCS_PIN_HINTS) {
    if (h.re.test(code) && !needs.includes(h.lib + ': ' + h.check)) needs.push(h.lib + ': ' + h.check);
  }
  if (note) needs.push('agent-reported docs change: ' + note.slice(0, 200));
  return {
    library: raw,
    verdict: fixes.length ? 'needs-update' : 'current',
    fixes,
    needs_check: needs,
    rule: 'Fresh docs win on API, but edits must preserve the look — adapt Aura code, never restyle.',
    stamp: { status: fixes.length || note ? 'checked-with-findings' : 'checked', findings: fixes.length + (note ? 1 : 0) },
  };
}

// ---- icons.mjs ----
// Module: icons — live icon fetch (Font Awesome Free + HackerNoon pixel
// library) over jsDelivr. One interface: getIcon({name, source, style}).
// URLs verified live 2026-10-10; licenses verified against the repos'
// own license pages (FA Free: CC BY 4.0 icons; pixel .svg/.png: CC BY 4.0).

const ICON_TTL_MS = 24 * 60 * 60 * 1000; // icons are static — remember 24h
const ICON_MAX_KEYS = 500;
const ICON_MAX_BYTES = 50 * 1024;
const ICON_FA_BASE = "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/svgs";
const ICON_FA_CSS = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css";
const ICON_PX_BASE = "https://cdn.jsdelivr.net/gh/hackernoon/pixel-icon-library@main/icons/SVG";
const ICON_PX_CSS = "https://cdn.jsdelivr.net/npm/@hackernoon/pixel-icon-library@latest/fonts/iconfont.css";
const ICON_FA_STYLES = ["solid", "regular", "brands"];
const ICON_SOURCES = ["auto", "fontawesome", "pixel"];
const ICON_STYLES = ["auto", "solid", "regular", "brands"];

function iconBad(msg) { const e = new Error(msg); e.code = "BAD_ARGS"; throw e; }
function iconMissing(msg) { const e = new Error(msg); e.code = "NOT_FOUND"; throw e; }

const ICON_CREDITS = {
  fontawesome: {
    license: "CC BY 4.0 (icons) — https://fontawesome.com/license/free",
    credit: "Icon by Font Awesome Free (CC BY 4.0) — https://fontawesome.com",
  },
  pixel: {
    license: "CC BY 4.0 — https://github.com/hackernoon/pixel-icon-library#license-free--starter--pro",
    credit: "Icon by HackerNoon Pixel Icon Library (CC BY 4.0) — https://pixeliconlibrary.com (give credit + link, note changes)",
  },
};

function iconCredit(source) {
  const c = ICON_CREDITS[source];
  if (!c) iconBad("source must be fontawesome|pixel");
  return { ...c };
}

// Candidate URLs in fallback order. Pixel solid variants use a -solid suffix
// (see iconfont.css hn-*-solid classes); FA uses per-style directories.
function iconCandidates(name, source, style) {
  const out = [];
  const faStyles = style === "auto" ? ICON_FA_STYLES : [style];
  const pxCats = style === "auto" ? ["regular", "solid", "brands"] : [style];
  if (source === "auto" || source === "fontawesome") {
    for (const s of faStyles) out.push({ source: "fontawesome", style: s, url: ICON_FA_BASE + "/" + s + "/" + name + ".svg" });
  }
  if (source === "auto" || source === "pixel") {
    for (const c of pxCats) {
      out.push({ source: "pixel", style: c, url: ICON_PX_BASE + "/" + c + "/" + name + ".svg" });
      out.push({ source: "pixel", style: c, url: ICON_PX_BASE + "/" + c + "/" + name + "-solid.svg" });
    }
  }
  return out;
}

function createIcons({ fetcher, now = () => Date.now() }) {
  if (!fetcher || typeof fetcher.getText !== "function") throw new Error("fetcher.getText is required");
  const cache = new Map();

  async function getIcon(q = {}) {
    const raw = typeof q.name === "string" ? q.name.trim().toLowerCase() : "";
    if (!raw) iconBad("name (string) is required — e.g. {name:'bolt'}");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) iconBad("name must be kebab-case like 'bolt' or 'arrow-down'");
    const source = q.source === undefined ? "auto" : q.source;
    const style = q.style === undefined ? "auto" : q.style;
    if (!ICON_SOURCES.includes(source)) iconBad("source must be one of " + ICON_SOURCES.join("|"));
    if (!ICON_STYLES.includes(style)) iconBad("style must be one of " + ICON_STYLES.join("|"));

    const key = [source, style, raw].join("|");
    const hit = cache.get(key);
    if (hit && now() - hit.t < ICON_TTL_MS) return { ...hit.v, cached: true };
    if (hit) cache.delete(key);

    const tried = [];
    let lastFetchErr = null;
    for (const c of iconCandidates(raw, source, style)) {
      let body = null;
      try {
        body = await fetcher.getText(c.url, {});
      } catch (e) {
        // Network-level failure is not a miss: remember it, keep walking the
        // chain in case only one host is down, and rethrow at the end if
        // nothing else explains the failure (never disguise an outage as
        // "not found").
        lastFetchErr = e instanceof Error ? e : new Error(String(e));
        tried.push({ url: c.url, ok: false, why: "fetch-error" });
        continue;
      }
      if (body === null || body === undefined) { tried.push({ url: c.url, ok: false, why: "404" }); continue; }
      const text = String(body).replace(/^\s*<\?xml[^?]*\?>\s*/, "");
      if (!text.trim().startsWith("<svg")) { tried.push({ url: c.url, ok: false, why: "not-svg" }); continue; }
      if (text.length > ICON_MAX_BYTES) { tried.push({ url: c.url, ok: false, why: "oversize" }); continue; }
      const lic = ICON_CREDITS[c.source];
      const out = {
        name: raw, source: c.source, style: c.style, svg: text, bytes: text.length,
        source_url: c.url, license: lic.license, credit: lic.credit,
        alt: c.source === "pixel"
          ? { iconfont_css: ICON_PX_CSS, class: "hn hn-" + raw, use: '<link rel="stylesheet" href="' + ICON_PX_CSS + '"> + <i class="hn hn-' + raw + '"></i>' }
          : { css: ICON_FA_CSS, class: "fa-" + c.style + " fa-" + raw, use: '<link rel="stylesheet" href="' + ICON_FA_CSS + '"> + <i class="fa-' + c.style + " fa-" + raw + '"></i>' },
        tried: tried.map((t) => t.url),
        cached: false,
      };
      cache.set(key, { t: now(), v: out });
      while (cache.size > ICON_MAX_KEYS) cache.delete(cache.keys().next().value);
      return out;
    }
    if (lastFetchErr && tried.every((t) => t.why === "fetch-error")) throw lastFetchErr;
    iconMissing("icon not found: '" + raw + "' (" + source + "/" + style + ") — checked " + tried.length + " URLs; check spelling (FA names use dashes, e.g. 'arrow-down')");
  }

  return { getIcon };
}

// ---- version.mjs ----
// Module: version — running vs npm-published version check. One small
// interface (getVersion) over a registry fetch with a long cache. Never
// throws: offline or unpublished registries return latest:null and a note.

const VERSION_TTL_MS = 60 * 60 * 1000; // re-check npm at most hourly
const VERSION_URL = "https://registry.npmjs.org/aura-components-mcp/latest";
const VERSION_INSTALL = "npm i -g aura-components-mcp@latest (or npx -y aura-components-mcp@latest), then restart the MCP client";

function createVersion({ fetcher, running, now = () => Date.now() }) {
  if (!fetcher || typeof fetcher.getText !== "function") throw new Error("fetcher.getText is required");
  const run = typeof running === "string" && running ? running : "0.0.0-dev";
  let cached = null;

  function cmp(a, b) {
    const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    }
    return 0;
  }

  async function getVersion() {
    if (cached && now() - cached.t < VERSION_TTL_MS) return { ...cached.v, cached: true };
    let latest = null;
    try {
      const body = await fetcher.getText(VERSION_URL, { accept: "application/json" });
      const j = body ? JSON.parse(body) : null;
      if (j && typeof j.version === "string" && /^\d+\.\d+\.\d+/.test(j.version)) latest = j.version;
    } catch { latest = null; }
    const behind = latest !== null && cmp(run, latest) < 0;
    const v = latest === null
      ? { running: run, latest: null, update_available: false, cached: false, checked_at: new Date(now()).toISOString(), notice: "Could not reach the npm registry — running v" + run + ". Prefer the latest published version when you can check." }
      : behind
        ? { running: run, latest, update_available: true, cached: false, checked_at: new Date(now()).toISOString(), notice: "Update available: running v" + run + ", npm publishes v" + latest + ". Prefer latest — " + VERSION_INSTALL + "." }
        : { running: run, latest, update_available: false, cached: false, checked_at: new Date(now()).toISOString(), notice: "Running v" + run + " — latest published. Prefer latest on every new session." };
    cached = { t: now(), v };
    return { ...v };
  }

  return { getVersion };
}

// ---- tools.mjs ----
// Module: tools — thin adapters. Each tool validates args at the seam,
// calls one catalog/guide method, wraps textResult. No retries/caching here
// (except aura_recommend's single bounded auto-retry + editorial fill).
const TOOL_SORTS = ['popular', 'recent', 'trending', 'updated'];
const TOOL_CATS = ['hero','section','button','card','background','header','logo','feature','pricing','testimonial','footer','form','heading'];
function toolFn_bad(msg) { const e = new Error(msg); e.code = 'BAD_ARGS'; throw e; }
function toolFn_str(v, name) { if (v !== undefined && typeof v !== 'string') toolFn_bad(name + ' must be a string'); return v; }
function toolFn_num(v, name) { if (v !== undefined && typeof v !== 'number') toolFn_bad(name + ' must be a number'); return v; }
function toolFn_bool(v, name) { if (v !== undefined && typeof v !== 'boolean') toolFn_bad(name + ' must be a boolean'); return v; }
function toolFn_sort(v) { if (v !== undefined && !TOOL_SORTS.includes(v)) toolFn_bad('sort must be one of ' + TOOL_SORTS.join('|')); return v; }
function theme(v) { if (v !== undefined && v !== 'dark' && v !== 'light') toolFn_bad('theme must be dark|light'); return v; }
function normRefs(v, name) {
  if (v === undefined) return v;
  let preview = '';
  try { preview = JSON.stringify(v).slice(0, 120); } catch { preview = String(v).slice(0, 120); }
  const ex = name + ' must be an array like ["732","1364"] or [{id:"732"}] — got ' + preview;
  if (!Array.isArray(v) || !v.length || v.length > 8) toolFn_bad(ex);
  const out = [];
  for (const e of v) {
    if (typeof e === 'string' && e) out.push(e);
    else if (typeof e === 'number' && Number.isFinite(e)) out.push(String(e));
    else if (e && typeof e === 'object' && !Array.isArray(e)) {
      if (typeof e.id === 'string' && e.id) out.push(e.id);
      else if (typeof e.id === 'number' && Number.isFinite(e.id)) out.push(String(e.id));
      else if (typeof e.slug === 'string' && e.slug) out.push(e.slug);
      else toolFn_bad(ex);
    } else toolFn_bad(ex);
  }
  if (!out.length) toolFn_bad(ex);
  return out;
}
function toolFn_cat(v) { if (v !== undefined && !TOOL_CATS.includes(v)) toolFn_bad('category must be one of ' + TOOL_CATS.join('|')); return v; }
function inspoMode(v) { if (v !== undefined && !INSPO_MODES.includes(v)) toolFn_bad('mode must be light|dark'); return v; }
function inspoVibe(v) { if (v !== undefined && !INSPO_VIBES.includes(v)) toolFn_bad('vibe must be one of ' + INSPO_VIBES.join('|')); return v; }
function inspoMacro(v) { if (v !== undefined && !INSPO_MACROS.includes(v)) toolFn_bad('macrostructure must be one of ' + INSPO_MACROS.join('|')); return v; }
function inspoEvidence(v, name) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) toolFn_bad((name || 'evidence') + ' must be an object (slim keys only)');
  return v;
}
const TOOL_DEFS = [
  { name: 'aura_status', description: 'Catalogue health plus free counts (components, skills, assets, design systems). Free only, no login. Start here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_search_components', description: 'Search free Aura UI components (2,495). Text over title and description, optional category tag, theme dark|light filter, negative_theme exclusion, min_views floor, sorts. Slim rows by default (excerpt + fetch pointer, no full code; slim:false for full). exact_match:true skips fallbacks (honest empty).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: TOOL_CATS }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_component', description: 'Full free component detail with HTML/Tailwind source, preview image, page URL. Numeric id or slug. Chunk param pages large code (see code_info). full:true returns full code (ignores chunk).', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' }, chunk: { type: 'number' }, full: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_skills', description: 'Search free Aura agent skills (192). Metadata only, slim by default; use aura_get_skill for the full SKILL.md content. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_skill', description: 'Full free agent-skill content (SKILL.md body) plus source_url and page URL. Skill id. Chunk param pages large bodies (see content_info).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, chunk: { type: 'number' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_search_assets', description: 'Search free Aura assets (images and video). Keywords, media_type image or video. Slim rows by default. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, mediaType: { type: 'string', enum: ['image', 'video'] }, commercial_ok: { type: 'boolean' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_design_systems', description: 'Search free Aura DESIGN.md systems (725). Metadata + snippets, slim by default; use aura_get_design_system for content. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_design_system', description: 'Full free DESIGN.md content plus preview_html, tokens, and page URL. System id or slug. Chunk param pages large preview_html (see preview_info).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' }, chunk: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_search_all', description: 'One call across components, skills, assets, and design systems in parallel. Free only. Slim rows by default (excerpts, no blobs). Each surface runs its own fallback pipeline, so mixed outcomes are normal (skills may fall back while components go honestly empty) — read isFallback/no_match per surface, not once globally.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' }, slim: { type: 'boolean' }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_recommend', description: 'Starter kit for a goal: top 3 free hits per surface with page URLs and rationale. Slim rows + commercial-use note. Empty components auto-retry once via suggested_queries, then editorial picks.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, slim: { type: 'boolean' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_install_component', description: 'Paste-ready setup for a free component: dependency list, setup steps, file map, fonts. Goes beyond the official Aura MCP, which only reads project source.', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_install_skill', description: 'Save-and-load plan for a free skill: where to put SKILL.md per client plus upstream source.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_use_design_system', description: 'Apply a free DESIGN.md system: token starter CSS plus copy order (tokens first, then markup).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_bundle', description: 'Bulk-fetch 2-8 component details in one call (ids or slugs). Per-item errors never fail the batch.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: {} }, slugs: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
  { name: 'aura_scaffold_page', description: 'One ordered page build: DESIGN.md tokens.css + system preview + component markup in dependency order, combined deps + files[]. Merges install_* + use_* in a single turn. components accepts string|number|{id}|{slug} refs, e.g. ["732","1364"] or [{id:"732"}] or [{slug:"..."}]; full:true returns full bodies.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, system: { type: 'string' }, components: { type: 'array', items: {} }, full: { type: 'boolean' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_related', description: 'More-like-this: 3 related items for a component/skill/design-system by tag + text overlap. Discovery never dead-ends.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'skills', 'design_systems'] }, id: {} }, required: ['kind', 'id'], additionalProperties: false } },
  { name: 'aura_bulk_fetch', description: 'Bulk-fetch 2-8 details in one call for components, design_systems, or assets. Alias-friendly name for aura_bundle. Per-item errors never fail the batch.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'design_systems', 'assets'] }, ids: { type: 'array', items: {} } }, required: ['kind', 'ids'], additionalProperties: false } },
  { name: 'aura_install_asset', description: 'Legal drop-in plan for an asset: direct download URL, preview URL, license (all-rights-reserved per Aura Terms §4 — check page before commercial use), suggested file path.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_categories', description: 'The 13 component categories with live free counts. Pick one, then search within it.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_prompt', description: 'Need-based design prompt in 2 passes: Pass 1 (goal only) returns draft + 6 questions (theme, sections, system, assets, macrostructure, vibe — mode folds into theme); ask the user via native question UI, then Pass 2 (goal + answers) returns copy-paste final_prompt + plan order + suggested calls starting at inspo.recommend. Always confirm with user before scaffolding.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, surfaces: { type: 'array', items: { type: 'string' } }, system: { type: 'string' }, answers: { type: 'object' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_inspo_recommend', description: 'Map a brief onto Inspo + Aura calls (pure, no fetch). Strict macro gate: without macrostructure returns need_macro:true — run inspo.recommend first, never scaffold generic. With macro returns inspo_call + 3 aura_calls + palette priority (brand > Inspo > Aura).', inputSchema: { type: 'object', properties: { brief: { type: 'string' }, mode: { type: 'string', enum: ['dark', 'light'] }, vibe: { type: 'string' }, macrostructure: { type: 'string' }, brand_hex: { type: 'string' } }, required: ['brief'], additionalProperties: false } },
  { name: 'aura_inspo_components', description: 'Map an Inspo component filter onto Aura search (pure). evidence.type hero|pricing|features|cta|nav|footer|testimonial|logo-cloud|faq|stat plus style/macrostructure/mode. Returns inspo.find_components call + aura_search + scaffold_hint (tokens first, weight s|m).', inputSchema: { type: 'object', properties: { evidence: { type: 'object' }, brief: { type: 'string' } }, required: ['evidence'], additionalProperties: false } },
  { name: 'aura_inspo_reference', description: 'Adapt one Inspo reference JSX onto one Aura component (pure). evidence {type, id} + aura_component {id|slug}. Returns inspo.get_reference_jsx + aura_get_component calls plus scoped adapt_plan (token swaps, css scope, files).', inputSchema: { type: 'object', properties: { evidence: { type: 'object' }, aura_component: { type: 'object' } }, required: ['evidence', 'aura_component'], additionalProperties: false } },
  { name: 'aura_inspo_system', description: 'Resolve Inspo tokens vs Aura DESIGN system (pure). inspo_tokens {palette, fonts, background?, text?, brand_hex?} + aura_system slug. Returns option A (Inspo) vs B (Aura fetch) vs C (blend) plus one system_choice question payload (A-inspo|B-aura|C-blend) and contrast warning. Tokens first.', inputSchema: { type: 'object', properties: { inspo_tokens: { type: 'object' }, aura_system: {} }, required: ['inspo_tokens', 'aura_system'], additionalProperties: false } },
  { name: 'aura_inspo_compare', description: 'Triangulate a house style from 2-4 slim Inspo sites (pure). evidence[] of {slug, palette?, fonts?, macrostructure?, mode?} — slim keys only, no autopsy. Returns inspo.compare call + closest Aura system/component queries.', inputSchema: { type: 'object', properties: { evidence: { type: 'array', items: { type: 'object' } } }, required: ['evidence'], additionalProperties: false } },
  { name: 'aura_docs_plan', description: 'Plan a fresh-docs lookup (pure, no fetch). library + need -> Context7 resolve/query plan (trusted: tailwind, gsap, lenis, iconify) + apply steps for Aura files + docs stamp slot. The agent calls Context7, Aura shapes the rest.', inputSchema: { type: 'object', properties: { library: { type: 'string' }, need: { type: 'string' } }, required: ['library', 'need'], additionalProperties: false } },
  { name: 'aura_docs_check', description: 'Check pasted code against fresh docs (pure). library + code_excerpt (under 20000 chars, excerpts not full pages) + optional docs_note -> verdict current|needs-update, look-preserving fixes, version-pin needs_check. Fresh API wins, look stays identical.', inputSchema: { type: 'object', properties: { library: { type: 'string' }, code_excerpt: { type: 'string' }, docs_note: { type: 'string' } }, required: ['library', 'code_excerpt'], additionalProperties: false } },
  { name: 'aura_icon', description: 'Fetch one free icon as ready-to-paste SVG (live). name in kebab-case (bolt, arrow-down). source auto|fontawesome|pixel, style auto|solid|regular|brands. Auto-fallback across styles then libraries; every hit carries license + credit (CC BY 4.0, credit always) plus a font/CSS alternative. 24h icon cache.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, source: { type: 'string', enum: ['auto', 'fontawesome', 'pixel'] }, style: { type: 'string', enum: ['solid', 'regular', 'brands', 'auto'] } }, required: ['name'], additionalProperties: false } },
  { name: 'aura_version', description: 'Running vs npm-published version (live, hourly cache). Returns update_available + notice telling the agent to prefer latest (npm i -g aura-components-mcp@latest) when behind. Never fails — offline registries return latest:null. aura_status already carries this verdict on every call.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
function createHandlers(catalog, icons, version) {
  // Automatic update notice: every aura_status carries the cached version
  // verdict (hourly npm re-check), so agents learn about updates unprompted.
  const versionNote = async () => {
    try {
      if (version && typeof version.getVersion === "function") return await version.getVersion();
    } catch { /* status must never fail on version check */ }
    return null;
  };
  return {
    aura_status: async () => {
      const [status, update] = await Promise.all([catalog.getStatus(), versionNote()]);
      return textResult(update ? { ...status, update } : status);
    },
    aura_search_components: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('components', {
      query: toolFn_str(a.query, 'query'), tag: toolFn_cat(a.category), freeOnly: true, theme: theme(a.theme),
      negative_theme: a.negative_theme === undefined ? undefined : theme(a.negative_theme),
      min_views: toolFn_num(a.min_views, 'min_views'),
      sort: toolFn_sort(a.sort), limit: toolFn_num(a.limit, 'limit'), offset: toolFn_num(a.offset, 'offset'),
      slim: a.slim === undefined ? undefined : toolFn_bool(a.slim, 'slim'),
      exact_match: a.exact_match === undefined ? undefined : toolFn_bool(a.exact_match, 'exact_match'),
    })); },
    aura_get_component: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (id === undefined || (typeof id !== 'string' && typeof id !== 'number')) toolFn_bad('provide id (number) or slug (string)');
      const full = a.full === undefined ? undefined : toolFn_bool(a.full, 'full');
      if (full === true) return textResult(await catalog.getItem('components', id, { full: true }));
      const chunk = a.chunk === undefined ? 0 : toolFn_num(a.chunk, 'chunk');
      return textResult(await catalog.getItem('components', id, { chunk })); },
    aura_search_skills: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('skills', {
      query: toolFn_str(a.query, 'query'), sort: toolFn_sort(a.sort), limit: toolFn_num(a.limit, 'limit'), offset: toolFn_num(a.offset, 'offset'),
      slim: a.slim === undefined ? undefined : toolFn_bool(a.slim, 'slim'),
      exact_match: a.exact_match === undefined ? undefined : toolFn_bool(a.exact_match, 'exact_match'),
    })); },
    aura_get_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) toolFn_bad('id (string) is required');
      const chunk = a.chunk === undefined ? 0 : toolFn_num(a.chunk, 'chunk');
      return textResult(await catalog.getItem('skills', a.id, { chunk })); },
    aura_search_assets: async (a) => { a = a || {}; const co = a.commercial_ok === undefined ? undefined : toolFn_bool(a.commercial_ok, 'commercial_ok');
      const r = await catalog.searchCatalog('assets', { query: toolFn_str(a.query, 'query'), mediaType: a.mediaType === undefined ? undefined : (a.mediaType === 'image' || a.mediaType === 'video' ? a.mediaType : toolFn_bad('mediaType must be image|video')), freeOnly: true, sort: toolFn_sort(a.sort), limit: toolFn_num(a.limit, 'limit'), offset: toolFn_num(a.offset, 'offset'), slim: a.slim === undefined ? undefined : toolFn_bool(a.slim, 'slim'), exact_match: a.exact_match === undefined ? undefined : toolFn_bool(a.exact_match, 'exact_match') });
      // Gap 5: commercial_ok filter (all-rights-reserved per Aura Terms S4).
      // commercial_ok:true returns [] with explanation, never silence.
      if (co === true) return textResult({ ...r, items: [], commercial_ok: false, commercial_note: 'All Aura catalogue assets are all-rights-reserved per Aura Terms S4. Preview/personal use via page_url; commercial reuse needs Aura permission.' });
      return textResult(r); },
    aura_search_design_systems: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('design_systems', {
      query: toolFn_str(a.query, 'query'), sort: toolFn_sort(a.sort), limit: toolFn_num(a.limit, 'limit'), offset: toolFn_num(a.offset, 'offset'),
      slim: a.slim === undefined ? undefined : toolFn_bool(a.slim, 'slim'),
      exact_match: a.exact_match === undefined ? undefined : toolFn_bool(a.exact_match, 'exact_match'),
    })); },
    aura_get_design_system: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (typeof id !== 'string' || !id) toolFn_bad('provide id or slug (string)');
      const chunk = a.chunk === undefined ? 0 : toolFn_num(a.chunk, 'chunk');
      return textResult(await catalog.getItem('design_systems', id, { chunk })); },
    aura_search_all: async (a) => { a = a || {}; const query = toolFn_str(a.query, 'query'), limit = toolFn_num(a.limit, 'limit') || 5;
      const slim = a.slim === undefined ? undefined : toolFn_bool(a.slim, 'slim');
      const themeV = a.theme === undefined ? undefined : theme(a.theme);
      const negV = a.negative_theme === undefined ? undefined : theme(a.negative_theme);
      const minV = toolFn_num(a.min_views, 'min_views');
      const exactV = a.exact_match === undefined ? undefined : toolFn_bool(a.exact_match, 'exact_match');
      const r = await Promise.all([
        catalog.searchCatalog('components', { query, freeOnly: true, limit, slim, theme: themeV, negative_theme: negV, min_views: minV, exact_match: exactV }),
        catalog.searchCatalog('skills', { query, limit, slim, min_views: minV, exact_match: exactV }),
        catalog.searchCatalog('assets', { query, freeOnly: true, limit, slim, min_views: minV, exact_match: exactV }),
        catalog.searchCatalog('design_systems', { query, limit, slim, min_views: minV, exact_match: exactV }),
      ]);
      return textResult({ query: query || null, components: r[0], skills: r[1], assets: r[2], design_systems: r[3] }); },
    aura_recommend: async (a) => { a = a || {}; if (typeof a.goal !== 'string' || !a.goal.trim()) toolFn_bad('goal (string) is required');
      // Gap 1: recommend hard-filters theme (not just reranks) — starter kits must not
      // mix light rows into a dark ask. min_views gates noise; both are explicit params.
      const themeV = a.theme === undefined ? undefined : theme(a.theme);
      const negative_themeV = a.negative_theme === undefined ? undefined : theme(a.negative_theme);
      const min_views = toolFn_num(a.min_views, 'min_views');
      const slim = a.slim === undefined ? undefined : toolFn_bool(a.slim, 'slim');
      const r = await Promise.all([
        catalog.searchCatalog('components', { query: a.goal, freeOnly: true, limit: 3, theme: themeV, negative_theme: negative_themeV, min_views, slim }),
        catalog.searchCatalog('skills', { query: a.goal, limit: 3, slim }),
        catalog.searchCatalog('assets', { query: a.goal, freeOnly: true, limit: 3, slim }),
        catalog.searchCatalog('design_systems', { query: a.goal, limit: 3, slim }),
      ]);
      // P0 auto-retry (bounded: max 1 retry + 1 picks call, no loops): an honest-empty
      // components surface (no_match) retries once via suggested_queries[0] with the
      // same filters, then falls back to human-grade editorial picks so the kit fills.
      if (r[0] && r[0].no_match === true && (!Array.isArray(r[0].items) || !r[0].items.length)) {
        const sq = Array.isArray(r[0].suggested_queries) ? r[0].suggested_queries.filter((q) => typeof q === 'string' && q.trim()) : [];
        let filled = false;
        if (sq.length) {
          try {
            const retry = await catalog.searchCatalog('components', { query: sq[0], freeOnly: true, limit: 3, theme: themeV, negative_theme: negative_themeV, min_views, slim });
            if (retry && Array.isArray(retry.items) && retry.items.length) {
              retry.retried = true;
              retry.retried_from = sq[0];
              r[0] = retry;
              filled = true;
            }
          } catch { /* keep the original honest-empty */ }
        }
        if (!filled && (!Array.isArray(r[0].items) || !r[0].items.length)) {
          try {
            const picks = typeof catalog.editorialPicks === 'function' ? await catalog.editorialPicks(3) : [];
            if (Array.isArray(picks) && picks.length) {
              r[0] = { kind: 'components', total: picks.length, items: picks, editorial_fallback: true, editorial_note: 'Goal matched nothing — showing human-grade free picks instead.' };
            }
          } catch { /* keep the original honest-empty */ }
        }
      }
      r[0].items = (r[0].items || []).slice(0, 3);
      const pick = (x) => ((x && x.items) || []).slice(0, 3).map((i) => ({ title: i.title, page_url: i.page_url }));
      return textResult({ goal: a.goal, freeOnly: true,
        rationale: 'Top 3 free catalogue hits per surface, ranked by Aura views. Open the page_url previews, then fetch full source or content for finalists.',
        commercial_note: 'Assets (and component art) are all-rights-reserved per Aura Terms §4: fine to prototype, get Aura permission before commercial ship.',
        components: r[0], skills: r[1], assets: r[2], design_systems: r[3],
        starter_kit: { components: pick(r[0]), skills: pick(r[1]), assets: pick(r[2]), design_systems: pick(r[3]) } }); },
    aura_install_component: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (id === undefined || (typeof id !== 'string' && typeof id !== 'number')) toolFn_bad('provide id (number) or slug (string)');
      const got = await catalog.getItem('components', id);
      // Pro refusal enforced centrally in catalog.getItem (fail-closed).
      const compInstall = installGuide('components', got.item);
      return textResult({ item: got.item, install: compInstall, docs_stamp: docsStampFor(compInstall.deps) }); },
    aura_install_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) toolFn_bad('id (string) is required');
      const got = await catalog.getItem('skills', a.id);
      return textResult({ item: got.item, install: installGuide('skills', got.item), docs_stamp: { status: 'unchecked', needs_check: ['SKILL.md is a vendored snapshot — re-check source_url for updates'], note: 'No library pins in skill installs.' } }); },
    aura_use_design_system: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (typeof id !== 'string' || !id) toolFn_bad('provide id or slug (string)');
      const got = await catalog.getItem('design_systems', id);
      const dsInstall = installGuide('design_systems', got.item);
      return textResult({ item: got.item, install: dsInstall, tokens: tokenHints(got.item.content || '', got.item.preview_html || ''), docs_stamp: docsStampFor(dsInstall.deps) }); },
    aura_categories: async () => { const cats = await catalog.categoryCounts();
      const s = (cats || []).reduce((n, c) => n + (typeof c.free === 'number' ? c.free : 0), 0);
      return textResult({ categories: cats, overlap_note: 'Counts overlap: components carry multiple tags, so per-category free counts sum to ' + s + ' (> 2495 free total). They triage depth, not a partition.' }); },
    aura_prompt: async (a) => { a = a || {}; return textResult(buildPrompt({ goal: typeof a.goal === 'string' ? a.goal : undefined, theme: a.theme, surfaces: a.surfaces, system: a.system, answers: a.answers })); },
    aura_inspo_recommend: async (a) => { a = a || {}; return textResult(buildInspoRecommend({
      brief: typeof a.brief === 'string' ? a.brief : undefined, mode: inspoMode(a.mode), vibe: inspoVibe(a.vibe),
      macrostructure: inspoMacro(a.macrostructure), brand_hex: toolFn_str(a.brand_hex, 'brand_hex'),
    })); },
    aura_inspo_components: async (a) => { a = a || {}; return textResult(buildInspoComponents({ evidence: inspoEvidence(a.evidence, 'evidence'), brief: toolFn_str(a.brief, 'brief') })); },
    aura_inspo_reference: async (a) => { a = a || {}; return textResult(buildInspoReference({ evidence: inspoEvidence(a.evidence, 'evidence'), aura_component: inspoEvidence(a.aura_component, 'aura_component') })); },
    aura_inspo_system: async (a) => { a = a || {}; const sys = (typeof a.aura_system === 'string' || (a.aura_system && typeof a.aura_system === 'object')) ? a.aura_system : toolFn_bad('aura_system slug (string) is required');
      return textResult(buildInspoSystem({ inspo_tokens: inspoEvidence(a.inspo_tokens, 'inspo_tokens'), aura_system: sys })); },
    aura_inspo_compare: async (a) => { a = a || {}; if (!Array.isArray(a.evidence)) toolFn_bad('evidence must be an array of 2-4 slim site objects');
      return textResult(buildInspoCompare({ evidence: a.evidence })); },
    aura_docs_plan: async (a) => { a = a || {}; return textResult(buildDocsPlan({ library: typeof a.library === 'string' ? a.library : undefined, need: typeof a.need === 'string' ? a.need : undefined })); },
    aura_docs_check: async (a) => { a = a || {}; return textResult(buildDocsCheck({ library: typeof a.library === 'string' ? a.library : undefined, code_excerpt: typeof a.code_excerpt === 'string' ? a.code_excerpt : undefined, docs_note: toolFn_str(a.docs_note, 'docs_note') })); },
    aura_icon: async (a) => { a = a || {}; if (!icons || typeof icons.getIcon !== 'function') { const e = new Error('icons backend not wired'); throw e; }
      const name = typeof a.name === 'string' ? a.name : toolFn_bad('name (string) is required — e.g. {name:"bolt"}');
      const source = a.source === undefined ? undefined : (a.source === 'auto' || a.source === 'fontawesome' || a.source === 'pixel' ? a.source : toolFn_bad('source must be auto|fontawesome|pixel'));
      const style = a.style === undefined ? undefined : (a.style === 'auto' || a.style === 'solid' || a.style === 'regular' || a.style === 'brands' ? a.style : toolFn_bad('style must be auto|solid|regular|brands'));
      return textResult(await icons.getIcon({ name, source, style })); },
    aura_version: async () => { if (!version || typeof version.getVersion !== 'function') { const e = new Error('version backend not wired'); throw e; }
      return textResult(await version.getVersion()); },
    aura_bundle: async (a) => { a = a || {}; const ids = normRefs(a.ids, 'ids') || normRefs(a.slugs, 'slugs');
      if (!ids || !ids.length) toolFn_bad('provide ids (array of 1-8 numbers/strings) or slugs (array of strings)');
      return textResult({ kind: 'components', results: await catalog.bundleItems('components', ids) }); },
    aura_related: async (a) => { a = a || {}; const k = a.kind;
      if (k !== 'components' && k !== 'skills' && k !== 'design_systems') toolFn_bad('kind must be components|skills|design_systems');
      const id = a.id; if (typeof id !== 'string' && typeof id !== 'number') toolFn_bad('id is required');
      return textResult(await catalog.relatedItems(k, id, 3)); },
    aura_install_asset: async (a) => { a = a || {}; if (typeof a.id !== 'number') toolFn_bad('id (number) is required');
      const got = await catalog.getItem('assets', a.id);
      const it = got.item; const fx = (it.facets || {});
      return textResult({ item: it, install: { kind: 'assets', title: it.title, page_url: it.page_url, license: fx.license || 'all-rights-reserved (Aura Terms §4)', terms_url: 'https://www.aura.build/terms', download: fx.download || null, preview: fx.preview || null, files: [{ path: 'assets/' + it.id + '-' + String(it.title || 'asset').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.jpg', contains: 'downloaded original' }], steps: ['Check the license on the Aura asset page before commercial use — this server reports unknown, never assumes free-to-sell.', 'Download the download URL into the suggested path.', 'Use the preview URL for <img> srcset while drafting.'] }, docs_stamp: { status: 'unchecked', needs_check: ['license per page_url — terms can change'], note: 'No library pins in asset installs.' } }); },
    aura_bulk_fetch: async (a) => { a = a || {}; const kind = a.kind;
      if (kind !== 'components' && kind !== 'design_systems' && kind !== 'assets') toolFn_bad('kind must be components|design_systems|assets');
      const ids = normRefs(a.ids, 'ids');
      if (!ids || !ids.length) toolFn_bad('provide ids (array of 1-8)');
      return textResult({ kind, results: await catalog.bundleItems(kind, ids) }); },
    aura_scaffold_page: async (a) => { a = a || {}; if (typeof a.goal !== 'string' || !a.goal.trim()) toolFn_bad('goal (string) is required');
      const sysRef = (typeof a.system === 'string' && a.system) ? a.system : null;
      const compRefs = normRefs(a.components, 'components') || [];
      const full = a.full === undefined ? undefined : toolFn_bool(a.full, 'full');
      const fullOpt = full === undefined ? {} : { full };
      const [sys, bundle] = await Promise.all([
        sysRef ? catalog.getItem('design_systems', sysRef, fullOpt).catch(() => null) : catalog.searchCatalog('design_systems', { query: a.goal, limit: 1 }).then((r) => (r.items[0] ? { item: r.items[0] } : null)),
        compRefs.length ? catalog.bundleItems('components', compRefs, 8, fullOpt).then((rs) => ({ items: rs.filter((x) => x.ok).map((x) => x.item), dropped: rs.filter((x) => !x.ok).length })) : catalog.searchCatalog('components', { query: a.goal, freeOnly: true, limit: 3 }).then((r) => ({ items: r.items, dropped: 0 })),
      ]);
      const comps = bundle.items;
      // Pro guard: explicit-id bundles can name Pro rows — free flows never ship them.
      const freeComps = (comps || []).filter((c) => c && c.premium === false);
      const proFiltered = (comps || []).length - freeComps.length;
      const sysItem = sys && sys.item ? sys.item : null;
      const toks = sysItem ? tokenHints(sysItem.content || '') : { tokens: {}, css: '' };
      const { guides, combined_deps: deps, files } = combineScaffold(sysItem, freeComps);
      return textResult({ goal: a.goal, order: ['1 tokens.css', '2 system preview_html', '3 component markup in listed order'], tokens_css: toks.css || '', system: sysItem, components: freeComps || [], guides, combined_deps: deps, files, docs_stamp: docsStampFor(deps), ...(bundle.dropped ? { dropped_refs: bundle.dropped, dropped_note: 'Some requested refs resolved to missing or Pro (paid) components and were omitted — see per-id errors via aura_bundle.' } : {}), ...(proFiltered ? { pro_filtered_out: proFiltered, pro_note: 'Pro (paid) components were refused — free-only scaffold ships free rows.' } : {}), license_note: 'Markup and any pulled assets are all-rights-reserved per Aura Terms §4 — fine to prototype, check each page_url before commercial ship.' }); },
  };
};

// ---- server.mjs (main) ----
// Module: server — composition root. Wires config -> fetcher -> catalog ->
// tools -> protocol session over stdio. Only framing + wiring lives here.









const config = loadConfig();
const fetcher = createFetcher({ fetchImpl: globalThis.fetch, timeoutMs: config.timeoutMs, retries: config.retries, userAgent: config.userAgent });
const catalog = createCatalog({ fetcher, config, facetsFn: facets });
const icons = createIcons({ fetcher });
const version = createVersion({ fetcher, running: SERVER_INFO.version });
const handlers = createHandlers(catalog, icons, version);

let buffer = "";
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const { dispatch } = createSession(send, { tools: TOOL_DEFS, handlers });

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    dispatch(msg);
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();

// Startup cinematics live on stderr only: stdout is reserved for JSON-RPC.
// Sequence: aura moment -> catalogue credit -> builder credit -> running.
const BANNER = [
  "  <<<  aura-components-mcp  >>>",
  "  free Aura catalogue, every AI agent",
];
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const paint = (s) => process.stderr.write(s + "\n");
async function typeLine(text, cps = 90) {
  for (const ch of text) { process.stderr.write(ch); await sleepMs(1000 / cps); }
  process.stderr.write("\n");
}
async function dots(label, n = 3) {
  process.stderr.write(label);
  for (let i = 0; i < n; i++) { await sleepMs(160); process.stderr.write("."); }
  process.stderr.write("\n");
}
async function boot() {
  if (process.env.AURA_QUIET === "1" || process.argv.includes("--quiet")) {
    paint(SERVER_INFO.name + " v" + SERVER_INFO.version + " listening on stdio");
    return;
  }
  for (const l of BANNER) paint(l);
  await typeLine("starting your aura for designing...");
  await dots("warming catalogue cache");
  paint("catalogue credit: Aura (aura.build) — components, skills, assets, systems");
  await sleepMs(180);
  paint("built by swastiksingh-dev — free to use, MIT, no paywall");
  await sleepMs(180);
  paint(SERVER_INFO.name + " v" + SERVER_INFO.version + " running — " + TOOL_DEFS.length + " tools on stdio");
}
boot();
