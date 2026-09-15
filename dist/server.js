#!/usr/bin/env node
// aura-components-mcp v1.6.1 — bundled (zero deps). Built by swastiksingh-dev.

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
    userAgent: env.AURA_USER_AGENT ?? "aura-components-mcp/1.0.0",
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
  async function getJson(url, headers) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await once(url, { headers });
        if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
          lastErr = new Error("transient upstream status " + res.status);
        } else if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error("upstream " + res.status + ": " + body.slice(0, 300));
        } else {
          const range = res.headers?.get?.("content-range") ?? null;
          const total = range && range.includes("/") ? Number(range.split("/").pop()) : null;
          const rows = await res.json();
          return { rows: Array.isArray(rows) ? rows : [rows], total: Number.isFinite(total) ? total : null };
        }
      } catch (err) {
        lastErr = err;
        if (err && err.name === "AbortError") break; // timeout: retrying rarely helps
      }
      if (attempt < retries) await sleep(120 * 2 ** attempt + Math.floor(Math.random() * 60));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  return { getJson };
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

function windowAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function weekAgoIso() { return windowAgoIso(7); }
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
    else ors.push("title.ilike." + v + ",description.ilike." + v);
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
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + "…[truncated]" : s);
function chunkText(s, n, chunk = 0) {
  const full = String(s || "");
  const total = Math.max(1, Math.ceil(full.length / n));
  const i = Math.max(0, Math.min(chunk, total - 1));
  return { text: full.slice(i * n, (i + 1) * n) + (i < total - 1 ? "…[truncated]" : ""), chunk: i, chunks: total, full_length: full.length, truncated: total > 1 };
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
  // Facets probe the first 600 chars of FULL code before truncation, so search facets
  // equal detail facets for icons/fonts/theme. Weight uses the true length (ISS1/2/3).
  if (kind === "components" && typeof base.code === "string") {
    base.code_chars = base.code.length;
    if (withFacets) { try { base.facets = withFacets(kind, { ...base, code: base.code.slice(0, 600) }, { fullLength: base.code.length }); } catch { /* never break rows */ } }
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

  const clampLimit = (l) => Math.min(config.maxLimit, Math.max(1, l ?? config.defaultLimit));

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
    // the cache key so filtered/unfiltered variants never collide.
    const negTheme = q.negative_theme ? String(q.negative_theme).toLowerCase() : "";
    const minViews = Math.max(0, q.min_views ?? 0);
    const key = ["search", kind, q.query ?? "", q.tag ?? "", q.mediaType ?? "", sort, limit, offset, freeOnly, negTheme, minViews].join("|");
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
      if ((!rows || !rows.length) && toks.length) {
        // Pass 1: OR over tokens, same filters (drops the AND-phrase requirement).
        const orParts = [];
        for (const t of toks) {
          const v = ilike(t);
          orParts.push("title.ilike." + v + ",description.ilike." + v);
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
          } catch { /* keep original empty result */ }
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
      if ((kind === "design_systems" || kind === "skills") && rows.length) {
        const topIds = rows.slice(0, 5).map((r) => r.id);
        try {
          const idList = topIds.map((id) => encodeURIComponent(String(id))).join(",");
          const sel = kind === "design_systems" ? "id,content,preview_html" : "id,content,source_url";
          const { rows: full } = await fetcher.getJson(base + "/rest/v1/" + kind + "?select=" + encodeURIComponent(sel) + "&id=in.(" + idList + ")", headers);
          const byId = new Map(full.map((r) => [String(r.id), r]));
          rows = rows.map((r) => {
            const f = byId.get(String(r.id));
            if (!f) return r;
            if (kind === "design_systems") return { ...r, preview_snippet: String(f.preview_html || "").slice(0, 800), tokens_snippet: String(f.content || "").slice(0, 800) };
            return { ...r, content_snippet: String(f.content || "").slice(0, 800) };
          });
        } catch { /* snippets are best-effort; rows still return */ }
      }
      const enriched = await enrichAuthors(rows);
      const out = { kind, total, limit, offset, items: enriched.map((r) => shapeRow(kind, r, config, facetsFn)), cached: false };
      if (deduped) out.deduped = deduped;
      // Gap 1: min_views quality floor (views-gated surfaces only) + negative_theme
      // hard exclusion. Both apply before theme re-rank so counts stay honest.
      if (minViews > 0) out.items = out.items.filter((it) => (it.views || 0) >= minViews);
      if (negTheme && kind === "components") {
        const before = out.items.length;
        out.items = out.items.filter((it) => !it.facets || it.facets.theme !== negTheme);
        if (out.items.length < before) out.negative_theme_filtered_out = before - out.items.length;
      }
      // Theme-aware re-rank (components): theme hint from query (dark/light/cinematic)
      // or explicit q.theme reorders so matches come first — never silently drops rows,
      // but reports how many were filtered out of the top for transparency.
      if (kind === "components" && effTheme) {
        const scored = scoreRows(kind, out.items, toks, effTheme);
        const topTheme = scored.filter((s) => s.themeOk).map((s) => s.r);
        const dropped = out.items.length - topTheme.length;
        if (topTheme.length) {
          out.items = topTheme;
          out.theme_hint = effTheme;
          if (dropped) out.theme_filtered_out = dropped;
        } else {
          out.theme_hint = effTheme;
          out.theme_warning = "no " + effTheme + "-theme rows in top results; showing unfiltered, check facets.theme per row";
        }
      }
      // ISS15: transparent fallback — agents see what happened, not a magic string.
      if (fallback) {
        out.fallback = fallback; out.isFallback = true;
        const scoredTop = out.items[0];
        const topTitle = scoredTop ? String(scoredTop.title || "").toLowerCase() : "";
        const hits = toks.filter((t) => topTitle.includes(t)).length;
        out.fallback_score = "token-overlap:" + hits + "/" + toks.length + "-terms" + (effTheme ? ";theme:" + effTheme : "");
      }
      else if ((!rows || !rows.length) && toks.length) { out.isFallback = false; out.suggested_queries = suggest(toks).filter((s) => !/^[a-z0-9]{8,}$/i.test(s.replace(/\s/g, ""))); if (!out.suggested_queries.length) out.suggested_queries = ["hero", "pricing", "landing page"]; }
      cacheSet(key, out);
      return out;
    })();
    inflight.set(key, p);
    try { return await p; } finally { inflight.delete(key); }
  }

  async function getItem(kind, idOrSlug, opts = {}) {
    const chunk = Math.max(0, opts.chunk ?? 0);
    const key = ["get", kind, String(idOrSlug), "c" + chunk].join("|");
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
    const enriched = await enrichAuthors(rows);
    const full = enriched[0];
    // Chunked fetch: re-slice full blobs per requested chunk so agents can page
    // through 18k-70k payloads instead of hitting one silent truncation wall.
    const item = shapeRow(kind, full, config, facetsFn);
    if (chunk > 0) {
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
    const out = { site: SITE, catalogue: "aura.build public catalogue (PostgREST, anon)", counts, cached: false };
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
      return enriched.map((r) => shapeRow("components", r, config, facetsFn));
    } catch { return []; }
  }

  // Bulk fetch: N details in one parallel round (backs aura_bundle + aura_scaffold_page).
  // Per-id errors are captured, never thrown: { ok:true, item } or { ok:false, id, error }.
  async function bundleItems(kind, ids, max = 5) {
    const list = [...new Set((ids || []).map(String))].slice(0, Math.max(1, Math.min(max, 8)));
    const out = await Promise.all(list.map(async (id) => {
      try { const got = await getItem(kind, id); return { ok: true, id, item: got.item }; }
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
      return { item: shapeRow(kind, item, config), related: enriched.map((r) => shapeRow(kind, r, config)) };
    } catch { return { item: shapeRow(kind, item, config), related: [] }; }
  }

  return { searchCatalog, getItem, getStatus, categoryCounts, bundleItems, relatedItems, editorialPicks };
}

// ---- protocol.mjs ----
const SERVER_INFO = { name: "aura-components-mcp", version: "1.6.1" };
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
    return { kind, title: row.title, page_url: url, free: row.premium === false, steps, deps, files, needs, css_scope: scope, code_truncated: isTrunc };
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
  return { tokens, css, preview_mode: mode, mode_warning: warn };
};

// ---- tools.mjs ----
// Module: tools â€” thin adapters. Each tool validates args at the seam,
// calls one catalog/guide method, wraps textResult. No retries/caching here.
const TOOL_KINDS = ['components', 'skills', 'assets', 'design_systems'];
const TOOL_SORTS = ['popular', 'recent', 'trending', 'updated'];
const TOOL_CATS = ['hero','section','button','card','background','header','logo','feature','pricing','testimonial','footer','form','heading'];
function toolFn_bad(msg) { const e = new Error(msg); e.code = 'BAD_ARGS'; throw e; }
function toolFn_str(v, name) { if (v !== undefined && typeof v !== 'string') toolFn_bad(name + ' must be a string'); return v; }
function toolFn_num(v, name) { if (v !== undefined && typeof v !== 'number') toolFn_bad(name + ' must be a number'); return v; }
function toolFn_bool(v, name) { if (v !== undefined && typeof v !== 'boolean') toolFn_bad(name + ' must be a boolean'); return v; }
function toolFn_sort(v) { if (v !== undefined && !TOOL_SORTS.includes(v)) toolFn_bad('sort must be one of ' + TOOL_SORTS.join('|')); return v; }
function theme(v) { if (v !== undefined && v !== 'dark' && v !== 'light') toolFn_bad('theme must be dark|light'); return v; }
function idList(v, name) { if (v === undefined) return v; if (!Array.isArray(v) || !v.length || v.length > 8 || v.some((x) => typeof x !== 'string' && typeof x !== 'number')) toolFn_bad(name + ' must be an array of 1-8 ids'); return v; }
function toolFn_cat(v) { if (v !== undefined && !TOOL_CATS.includes(v)) toolFn_bad('category must be one of ' + TOOL_CATS.join('|')); return v; }
const TOOL_DEFS = [
  { name: 'aura_status', description: 'Catalogue health plus free counts (components, skills, assets, design systems). Free only, no login. Start here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_search_components', description: 'Search free Aura UI components (2,495). Text over title and description, optional category tag, theme dark|light filter, negative_theme exclusion, min_views floor, sorts. Items carry facets (theme/weight/needs).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: TOOL_CATS }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_get_component', description: 'Full free component detail with HTML/Tailwind source, preview image, page URL. Numeric id or slug. Chunk param pages large code (see code_info).', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' }, chunk: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_search_skills', description: 'Search free Aura agent skills (187). Metadata only; use aura_get_skill for the full SKILL.md content.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_get_skill', description: 'Full free agent-skill content (SKILL.md body) plus source_url and page URL. Skill id. Chunk param pages large bodies (see content_info).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, chunk: { type: 'number' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_search_assets', description: 'Search free Aura assets (images and video). Keywords, media_type image or video.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, mediaType: { type: 'string', enum: ['image', 'video'] }, commercial_ok: { type: 'boolean' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_search_design_systems', description: 'Search free Aura DESIGN.md systems (725). Metadata only; use aura_get_design_system for content.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_get_design_system', description: 'Full free DESIGN.md content plus preview_html, tokens, and page URL. System id or slug. Chunk param pages large preview_html (see preview_info).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' }, chunk: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_search_all', description: 'One call across components, skills, assets, and design systems in parallel. Free only.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_recommend', description: 'Starter kit for a goal: top free components, skills, design systems, and assets with page URLs and rationale.', inputSchema: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_install_component', description: 'Paste-ready setup for a free component: dependency list, setup steps, file map, fonts. Goes beyond the official Aura MCP, which only reads project source.', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_install_skill', description: 'Save-and-load plan for a free skill: where to put SKILL.md per client plus upstream source.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_use_design_system', description: 'Apply a free DESIGN.md system: token starter CSS plus copy order (tokens first, then markup).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_trending', description: 'What is new and popular across the free catalogue: top components, skills, assets, design systems in one call.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_bundle', description: 'Bulk-fetch 2-8 component details in one call (ids or slugs). Per-item errors never fail the batch.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: {} }, slugs: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
  { name: 'aura_scaffold_page', description: 'One ordered page build: DESIGN.md tokens.css + system preview + component markup in dependency order, combined deps + files[]. Merges install_* + use_* in a single turn.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, system: { type: 'string' }, components: { type: 'array', items: {} } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_related', description: 'More-like-this: 3 related items for a component/skill/design-system by tag + text overlap. Discovery never dead-ends.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'skills', 'design_systems'] }, id: {} }, required: ['kind', 'id'], additionalProperties: false } },
  { name: 'aura_bulk_fetch', description: 'Bulk-fetch 2-8 details in one call for components, design_systems, or assets. Alias-friendly name for aura_bundle. Per-item errors never fail the batch.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'design_systems', 'assets'] }, ids: { type: 'array', items: {} } }, required: ['kind', 'ids'], additionalProperties: false } },
  { name: 'aura_install_asset', description: 'Legal drop-in plan for an asset: direct download URL, preview URL, license (all-rights-reserved per Aura Terms Â§4 â€” check page before commercial use), suggested file path.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_categories', description: 'The 13 component categories with live free counts. Pick one, then search within it.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
function createHandlers(catalog) {
  const free = { freeOnly: true };
  return {
    aura_status: async () => textResult(await catalog.getStatus()),
    aura_search_components: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('components', {
      query: toolFn_str(a.query, 'query'), tag: toolFn_cat(a.category), freeOnly: true, theme: theme(a.theme),
      negative_theme: a.negative_theme === undefined ? undefined : theme(a.negative_theme),
      min_views: toolFn_num(a.min_views, 'min_views'),
      sort: toolFn_sort(a.sort), limit: toolFn_num(a.limit, 'limit'), offset: toolFn_num(a.offset, 'offset'),
    })); },
    aura_get_component: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (id === undefined || (typeof id !== 'string' && typeof id !== 'number')) toolFn_bad('provide id (number) or slug (string)');
      const chunk = a.chunk === undefined ? 0 : toolFn_num(a.chunk, 'chunk');
      return textResult(await catalog.getItem('components', id, { chunk })); },
    aura_search_skills: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('skills', {
      query: toolFn_str(a.query, 'query'), sort: toolFn_sort(a.sort), limit: toolFn_num(a.limit, 'limit'), offset: toolFn_num(a.offset, 'offset'),
    })); },
    aura_get_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) toolFn_bad('id (string) is required');
      const chunk = a.chunk === undefined ? 0 : toolFn_num(a.chunk, 'chunk');
      return textResult(await catalog.getItem('skills', a.id, { chunk })); },
    aura_search_assets: async (a) => { a = a || {}; const co = a.commercial_ok === undefined ? undefined : toolFn_bool(a.commercial_ok, 'commercial_ok');
      const r = await catalog.searchCatalog('assets', { query: toolFn_str(a.query, 'query'), mediaType: a.mediaType === undefined ? undefined : (a.mediaType === 'image' || a.mediaType === 'video' ? a.mediaType : toolFn_bad('mediaType must be image|video')), freeOnly: true, sort: toolFn_sort(a.sort), limit: toolFn_num(a.limit, 'limit'), offset: toolFn_num(a.offset, 'offset') });
      // Gap 5: commercial_ok filter (all-rights-reserved per Aura Terms S4).
      // commercial_ok:true returns [] with explanation, never silence.
      if (co === true) return textResult({ ...r, items: [], commercial_ok: false, commercial_note: 'All Aura catalogue assets are all-rights-reserved per Aura Terms S4. Preview/personal use via page_url; commercial reuse needs Aura permission.' });
      if (co === true) return textResult({ ...r, items: [], commercial_ok: false, commercial_note: 'x' });
      if (co === true) return textResult({ ...r, items: [], commercial_ok: false, commercial_note: 'All Aura catalogue assets are all-rights-reserved per Aura Terms S4.' });
      return textResult(r); },
    aura_search_design_systems: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('design_systems', {
      query: toolFn_str(a.query, 'query'), sort: toolFn_sort(a.sort), limit: toolFn_num(a.limit, 'limit'), offset: toolFn_num(a.offset, 'offset'),
    })); },
    aura_get_design_system: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (typeof id !== 'string' || !id) toolFn_bad('provide id or slug (string)');
      const chunk = a.chunk === undefined ? 0 : toolFn_num(a.chunk, 'chunk');
      return textResult(await catalog.getItem('design_systems', id, { chunk })); },
    aura_search_all: async (a) => { a = a || {}; const query = toolFn_str(a.query, 'query'), limit = toolFn_num(a.limit, 'limit') || 5;
      const r = await Promise.all([
        catalog.searchCatalog('components', { query, freeOnly: true, limit }),
        catalog.searchCatalog('skills', { query, limit }),
        catalog.searchCatalog('assets', { query, freeOnly: true, limit }),
        catalog.searchCatalog('design_systems', { query, limit }),
      ]);
      return textResult({ query: query || null, components: r[0], skills: r[1], assets: r[2], design_systems: r[3] }); },
    aura_recommend: async (a) => { a = a || {}; if (typeof a.goal !== 'string' || !a.goal.trim()) toolFn_bad('goal (string) is required');
      // Gap 1: recommend hard-filters theme (not just reranks) â€” starter kits must not
      // mix light rows into a dark ask. min_views gates noise; both are explicit params.
      const themeV = a.theme === undefined ? undefined : theme(a.theme);
      const negative_themeV = a.negative_theme === undefined ? undefined : theme(a.negative_theme);
      const min_views = toolFn_num(a.min_views, 'min_views');
      const r = await Promise.all([
        catalog.searchCatalog('components', { query: a.goal, freeOnly: true, limit: 8, theme: themeV, negative_theme: negative_themeV, min_views }),
        catalog.searchCatalog('skills', { query: a.goal, limit: 5 }),
        catalog.searchCatalog('assets', { query: a.goal, freeOnly: true, limit: 3 }),
        catalog.searchCatalog('design_systems', { query: a.goal, limit: 3 }),
      ]);
      r[0].items = r[0].items.slice(0, 5);
      const pick = (x) => (x.items || []).slice(0, 3).map((i) => ({ title: i.title, page_url: i.page_url }));
      return textResult({ goal: a.goal, freeOnly: true,
        rationale: 'Top free catalogue hits per surface, ranked by Aura views. Open the page_url previews, then fetch full source or content for finalists.',
        components: r[0], skills: r[1], assets: r[2], design_systems: r[3],
        starter_kit: { components: pick(r[0]), skills: pick(r[1]), assets: pick(r[2]), design_systems: pick(r[3]) } }); },
    aura_install_component: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (id === undefined || (typeof id !== 'string' && typeof id !== 'number')) toolFn_bad('provide id (number) or slug (string)');
      const got = await catalog.getItem('components', id);
      if (got.item && got.item.premium !== false) toolFn_bad('that component is Pro (paid). Search with freeOnly or pick a free one.');
      return textResult({ item: got.item, install: installGuide('components', got.item) }); },
    aura_install_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) toolFn_bad('id (string) is required');
      const got = await catalog.getItem('skills', a.id);
      return textResult({ item: got.item, install: installGuide('skills', got.item) }); },
    aura_use_design_system: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (typeof id !== 'string' || !id) toolFn_bad('provide id or slug (string)');
      const got = await catalog.getItem('design_systems', id);
      return textResult({ item: got.item, install: installGuide('design_systems', got.item), tokens: tokenHints(got.item.content || '', got.item.preview_html || '') }); },
    aura_trending: async (a) => { a = a || {}; const limit = toolFn_num(a.limit, 'limit') || 5;
      // Gap 2: 30d rolling window + editorial picks. Components at 90d/views are noise
      // (total 2, views 0-5); skills/assets already work and keep their own signal.
      const windowDays = a.window_days === undefined ? 30 : toolFn_num(a.window_days, 'window_days');
      const r = await Promise.all([
        catalog.searchCatalog('components', { freeOnly: true, sort: 'trending', limit, window_days: windowDays }),
        catalog.searchCatalog('skills', { sort: 'trending', limit }),
        catalog.searchCatalog('assets', { freeOnly: true, sort: 'trending', limit }),
        catalog.searchCatalog('design_systems', { sort: 'trending', limit }),
      ]);
      const picks = await catalog.editorialPicks(Math.min(limit, 5)).catch(() => []);
      return textResult({ window: 'last ' + windowDays + ' days by views', window_note: 'Components at 90d/views are low-signal (total 2, views 0-5): see editorial_picks for human-grade component leads; skills/assets trending is organic.', editorial_picks: picks, components: r[0], skills: r[1], assets: r[2], design_systems: r[3] });},
    aura_categories: async () => textResult({ categories: await catalog.categoryCounts() }),
    aura_bundle: async (a) => { a = a || {}; const ids = idList(a.ids, 'ids') || idList(a.slugs, 'slugs');
      if (!ids || !ids.length) toolFn_bad('provide ids (array of 1-8 numbers/strings) or slugs (array of strings)');
      return textResult({ kind: 'components', results: await catalog.bundleItems('components', ids) }); },
    aura_related: async (a) => { a = a || {}; const k = a.kind;
      if (k !== 'components' && k !== 'skills' && k !== 'design_systems') toolFn_bad('kind must be components|skills|design_systems');
      const id = a.id; if (typeof id !== 'string' && typeof id !== 'number') toolFn_bad('id is required');
      return textResult(await catalog.relatedItems(k, id, 3)); },
    aura_install_asset: async (a) => { a = a || {}; if (typeof a.id !== 'number') toolFn_bad('id (number) is required');
      const got = await catalog.getItem('assets', a.id);
      const it = got.item; const fx = (it.facets || {});
      return textResult({ item: it, install: { kind: 'assets', title: it.title, page_url: it.page_url, license: fx.license || 'all-rights-reserved (Aura Terms Â§4)', terms_url: 'https://www.aura.build/terms', download: fx.download || null, preview: fx.preview || null, files: [{ path: 'assets/' + it.id + '-' + String(it.title || 'asset').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.jpg', contains: 'downloaded original' }], steps: ['Check the license on the Aura asset page before commercial use â€” this server reports unknown, never assumes free-to-sell.', 'Download the download URL into the suggested path.', 'Use the preview URL for <img> srcset while drafting.'] } }); },
    aura_bulk_fetch: async (a) => { a = a || {}; const kind = a.kind;
      if (kind !== 'components' && kind !== 'design_systems' && kind !== 'assets') toolFn_bad('kind must be components|design_systems|assets');
      const ids = idList(a.ids, 'ids');
      if (!ids || !ids.length) toolFn_bad('provide ids (array of 1-8)');
      return textResult({ kind, results: await catalog.bundleItems(kind, ids) }); },
    aura_scaffold_page: async (a) => { a = a || {}; if (typeof a.goal !== 'string' || !a.goal.trim()) toolFn_bad('goal (string) is required');
      const sysRef = (typeof a.system === 'string' && a.system) ? a.system : null;
      const compRefs = idList(a.components, 'components') || [];
      const [sys, comps] = await Promise.all([
        sysRef ? catalog.getItem('design_systems', sysRef).catch(() => null) : catalog.searchCatalog('design_systems', { query: a.goal, limit: 1 }).then((r) => (r.items[0] ? { item: r.items[0] } : null)),
        compRefs.length ? catalog.bundleItems('components', compRefs).then((rs) => rs.filter((x) => x.ok).map((x) => x.item)) : catalog.searchCatalog('components', { query: a.goal, freeOnly: true, limit: 3 }).then((r) => r.items),
      ]);
      const sysItem = sys && sys.item ? sys.item : null;
      const toks = sysItem ? tokenHints(sysItem.content || '') : { tokens: {}, css: '' };
      const guides = (comps || []).map((c) => installGuide('components', c));
      const deps = []; const seen = new Set();
      for (const g of guides) for (const d of (g.deps || [])) if (!seen.has(d.name)) { seen.add(d.name); deps.push(d); }
      const files = [{ path: 'styles/tokens.css', contains: 'tokens.css from use_design_system' }];
      if (sysItem) files.push({ path: 'DESIGN.md', contains: 'system rules' });
      for (const g of guides) for (const f of (g.files || [])) files.push(f);
      return textResult({ goal: a.goal, order: ['1 tokens.css', '2 system preview_html', '3 component markup in listed order'], tokens_css: toks.css || '', system: sysItem, components: comps || [], guides, combined_deps: deps, files }); },
  };
};

// ---- server.mjs (main) ----
// Module: server — composition root. Wires config -> fetcher -> catalog ->
// tools -> protocol session over stdio. Only framing + wiring lives here.







const config = loadConfig();
const fetcher = createFetcher({ fetchImpl: globalThis.fetch, timeoutMs: config.timeoutMs, retries: config.retries, userAgent: config.userAgent });
const catalog = createCatalog({ fetcher, config, facetsFn: facets });
const handlers = createHandlers(catalog);

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
  paint(SERVER_INFO.name + " v" + SERVER_INFO.version + " running — 15 tools on stdio");
}
boot();
