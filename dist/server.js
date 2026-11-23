#!/usr/bin/env node
// aura-components-mcp v1.7.3 — bundled (zero deps). Built by swastiksingh-dev.

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
    defaultLimit: num(env.AURA_DEFAULT_LIMIT, 5, { min: 1, max: 50 }),
    maxLimit: num(env.AURA_MAX_LIMIT, 25, { min: 1, max: 50 }),
    codeChars: num(env.AURA_CODE_CHARS, 12_000, { min: 1_000, max: 60_000 }),
    contentChars: num(env.AURA_CONTENT_CHARS, 12_000, { min: 1_000, max: 60_000 }),
    freeOnlyDefault: bool(env.AURA_FREE_ONLY_DEFAULT, true),
    userAgent: env.AURA_USER_AGENT ?? "aura-components-mcp/1.7.3",
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
// pct: percent-encode chars that break PostgREST query parsing when raw —
// "#" would start a URL fragment (PGRST100), "," splits value lists,
// "()" groups logic, quotes break string parsing, raw "%" corrupts decoding.
// encodeURIComponent deliberately leaves !'()* raw, so escEq finishes the job.
const pct = (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase();
const escEq = (s) => encodeURIComponent(String(s)).replace(/[!'()*]/g, pct);
// ilike patterns keep our own "*" wildcards; everything user-typed that is
// PostgREST-significant gets encoded so goals like "page #0a0a0b (dark)"
// match literally instead of crashing the query.
const ilike = (v) => "*" + String(v).replaceAll("*", "").trim().replace(/[%#()'",]/g, pct) + "*";

// Split a goal sentence into significant tokens for OR fallback (stop-word filtered).
// Theme words (dark/light) are NOT search tokens — they become rank/filter signals
// (see detectThemeHint + scoreByTheme), so "dark cinematic" can't match light rows.
// Hex codes (#0a0a0b, bare 6-hex with a digit) are NOT search tokens either —
// catalogue titles never contain them, so they only poison overlap counts while
// still riding along for palette synthesis elsewhere. 3-hex words without #
// ("red", "tan") are kept: too often real words to drop.
const STOP = new Set("a,an,the,for,with,and,or,of,to,in,on,my,new,free,also,that,this,from,into,plus,vs,top,best,up".split(","));
const THEME_WORDS = new Set(["dark", "light", "midnight", "noir", "black", "white", "bright", "airy", "minimal"]);
function queryTokens(q, max = 4) {
  const raw = String(q ?? "").toLowerCase();
  const hashed = new Set([...raw.matchAll(/#([0-9a-z]+)/g)].map((m) => m[1]));
  const isHexNoise = (t) => hashed.has(t) || (/^(?=.*\d)[0-9a-f]{6}$/.test(t));
  return raw.replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 2 && !STOP.has(t) && !THEME_WORDS.has(t) && !isHexNoise(t)).slice(0, max);
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
// Light suffix stemming so inflected query words still hit literal titles
// (glassy→glass, magazines→magazine). Same rule family as the award ranker;
// applied symmetrically to query tokens AND haystacks, so counts only grow
// when both sides agree on the stem — honest-empty behavior preserved.
function stemTok(t) {
  let s = String(t ?? "").toLowerCase();
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 4 && s.endsWith("es") && /(ses|xes|zes|ches|shes)$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  else if (s.length > 4 && s.endsWith("y")) s = s.slice(0, -1);
  return s;
}
// Conservative one-edit fallback for already-fetched candidates only. It adds
// no upstream calls and requires a 4+ character token to avoid noisy matches.
function tokenNear(a, b) {
  const rawLeft = String(a || "").toLowerCase();
  const rawRight = String(b || "").toLowerCase();
  const near = (left, right) => {
    if (left === right) return true;
    if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (left.length > right.length) i++;
      else if (right.length > left.length) j++;
      else { i++; j++; }
    }
    return edits + ((i < left.length || j < right.length) ? 1 : 0) <= 1;
  };
  if (near(rawLeft, rawRight)) return true;
  const left = stemTok(rawLeft);
  const right = stemTok(rawRight);
  return near(left, right);
}
const fuzzyTitleHit = (token, title) => String(title || "").toLowerCase().split(/[^a-z0-9]+/).some((part) => tokenNear(token, part));
// Rank rows: +2 per matched token in title, +1 in description/tags, theme match first.
// Returns { rows, scored } where scored explains the top pick for fallback_score.
function scoreRows(kind, rows, toks, themeHint) {
  const scored = rows.map((r) => {
    const title = String(r.title || "").toLowerCase();
    const desc = String(r.description || "").toLowerCase();
    const tags = ((r.tags || []).map((x) => String(x).toLowerCase()).join(" "));
    let s = 0;
    for (const raw of toks) {
      const t = stemTok(raw);
      if (title.includes(raw) || (t !== raw && title.includes(t)) || fuzzyTitleHit(t, title)) s += 2;
      else if (desc.includes(raw) || tags.includes(raw) || (t !== raw && (desc.includes(t) || tags.includes(t)))) s += 1;
    }
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
      const stem = stemTok(tok);
      if (tok && (title.includes(tok) || (stem !== tok && title.includes(stem)) || fuzzyTitleHit(stem, title))) n++;
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
    const stem = stemTok(tok);
    if (tok && (hay.includes(tok) || (stem !== tok && hay.includes(stem)) || parts.some((part) => fuzzyTitleHit(stem, part)))) n++;
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
// Explicit slim:false remains bounded by boundSearchBodies below.
function slimRows(kind, items) {
  return (items || []).map((it) => {
    const o = { ...it };
    if (kind === "components" && typeof o.code === "string") {
      delete o.code; // keep code_excerpt + code_info + full_fetch
      if (typeof o.code_excerpt === "string") o.code_excerpt = o.code_excerpt.slice(0, 300);
    }
    if (kind === "skills" && typeof o.content === "string") { o.content_excerpt = String(o.content).slice(0, 300); delete o.content; }
    if (kind === "design_systems") {
      if (typeof o.content === "string") { o.content_excerpt = String(o.content).slice(0, 300); delete o.content; }
      if (typeof o.preview_html === "string") { o.preview_excerpt = String(o.preview_html).slice(0, 300); delete o.preview_html; }
    }
    return o;
  });
}
function boundSearchBodies(kind, items, maxChars = 1200) {
  const fields = kind === "components" ? ["code"] : kind === "skills" ? ["content"] : kind === "design_systems" ? ["content", "preview_html"] : [];
  return (items || []).map((item) => {
    const out = { ...item };
    for (const field of fields) {
      if (typeof out[field] !== "string" || out[field].length <= maxChars) continue;
      const fullLength = out[field].length;
      out[field] = out[field].slice(0, maxChars) + "…[truncated]";
      out[field + "_info"] = { full_length: fullLength, preview_chars: maxChars, truncated: true };
      out[field + "_fetch"] = { tool: kind === "components" ? "aura_get_component" : kind === "skills" ? "aura_get_skill" : "aura_get_design_system", id: out.id ?? out.slug, chunk: 0 };
    }
    return out;
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
  if (kind === "components") {
    // Upstream drift can return a component without a slug. Never publish
    // /component/undefined: fall back to the catalogue search that the title
    // can actually resolve, and keep the row usable.
    const slug = typeof row.slug === "string" ? row.slug.trim() : "";
    return slug
      ? SITE + "/component/" + encodeURIComponent(slug)
      : SITE + "/components?q=" + encodeURIComponent(row.title ?? "");
  }
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
          const idList = topIds.map((id) => escEq(id)).join(",");
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
      const out = { kind, summary: formed.length + " " + kind.replaceAll("_", " ") + " result(s)", total, limit, offset, items: formed.map((r) => shapeRow(kind, r, config, facetsFn)), cached: false, provenance: { source: "Aura public catalogue" } };
      out.truncated = typeof total === "number" ? offset + limit < total : null;
      out.next_offset = out.truncated === true ? offset + limit : null;
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
      // Zero-overlap refusal: fallback engaged but NO row matches ≥1 token —
      // honest empty instead of irrelevant popular rows. Direct hits never
      // refused. The gate judges the BEST row, not just the first: a single
      // irrelevant views-leader must not veto relevant rows below it.
      // Matching rows are re-ranked first (theme-ok, then overlap, views
      // order kept within ties) and fallback_score is refreshed to the new
      // top row so the disclosed score always describes returned rows.
      // Kind-aware: components/assets stay title-only strict; skills/systems
      // use the wider net (title+description+tags+snippets) via matchOverlap.
      if (fallback != null && toks.length > 0) {
        const themeOf = (it) => (it && it.facets && it.facets.theme) || "unknown";
        const themeOkOf = (it) => !effTheme || themeOf(it) === effTheme || themeOf(it) === "mixed" || themeOf(it) === "unknown";
        const scored = out.items.map((it) => ({ it, hits: matchOverlap(kind, toks, it), themeOk: themeOkOf(it) }));
        scored.sort((a, b) => (((b.themeOk ? 1 : 0) - (a.themeOk ? 1 : 0)) || (b.hits - a.hits)));
        // Refusal judges the GLOBAL best: theme-first ordering must never
        // let a 0-hit row veto a matching row below it.
        const best = scored.length ? Math.max(...scored.map((s) => s.hits)) : 0;
        if (best === 0) {
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
        } else {
          out.items = scored.map((s) => s.it);
          out.fallback_score = "token-overlap:" + best + "/" + toks.length + "-terms" + (effTheme ? ";theme:" + effTheme : "");
        }
      }
      if (slim) out.items = slimRows(kind, out.items);
      else {
        out.items = boundSearchBodies(kind, out.items);
        out.item_body_limit = 1200;
      }
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
      ? (isUuid ? "id=eq." + escEq(idOrSlug) : "slug=eq." + escEq(idOrSlug))
      : (kind === "components" && !isNum
        ? "slug=eq." + escEq(idOrSlug)
        : "id=eq." + escEq(idOrSlug));
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
        const ch = chunkText(full.code, config.codeChars, 0);
        item.code = ch.text;
        item.code_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: ch.chunk, truncated: ch.truncated };
      }
      if (kind === "skills" && typeof full.content === "string") {
        const ch = chunkText(full.content, config.contentChars, 0);
        item.content = ch.text;
        item.content_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: ch.chunk, truncated: ch.truncated };
      }
      if (kind === "design_systems") {
        if (typeof full.content === "string") {
          const ch = chunkText(full.content, config.contentChars, 0);
          item.content = ch.text;
          item.content_info = { full_length: ch.full_length, chunks: ch.chunks, chunk: ch.chunk, truncated: ch.truncated };
        }
        if (typeof full.preview_html === "string") {
          const ch = chunkText(full.preview_html, config.codeChars, 0);
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
      // `assets` stays the upstream total (all entitlements); the explicit
      // free/pro split is what the free-only access policy actually serves.
      ["assets", "assets?select=id&private=eq.false&limit=1"],
      ["assets_free", "assets?select=id&private=eq.false&premium=eq.false&limit=1"],
      ["assets_pro", "assets?select=id&private=eq.false&premium=eq.true&limit=1"],
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
    const out = { site: SITE, catalogue: "aura.build public catalogue (PostgREST, anon)", counts, counts_note: "components_free/components_pro and assets_free/assets_pro are split by premium; assets is all assets (free+pro). skills and design_systems have no premium flag.", freshness, cached: false };
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
      try {
        const got = await getItem(kind, id, { full: !!opts.full });
        const item = { ...got.item };
        if (!opts.full) {
          const sourceKey = kind === "components" ? "code" : kind === "skills" ? "content" : null;
          if (sourceKey && typeof item[sourceKey] === "string") delete item[sourceKey];
          if (kind === "design_systems") { delete item.content; delete item.preview_html; }
          item.detail_fetch = { tool: kind === "components" ? "aura_get_component" : kind === "design_systems" ? "aura_get_design_system" : "aura_get_skill", id };
        }
        return { ok: true, id, item };
      }
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
    const selfId = escEq(item.id);
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
const SERVER_INFO = { name: "aura-components-mcp", version: "1.7.3" };
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
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
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
    + 'CALLS: aura_search_components/aura_search_all -> inspect finalists -> aura_use_design_system -> aura_scaffold_page';
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
      { key: 'macrostructure', question: 'What overall page structure fits your brief, or should Aura suggest options?', options: ['auto-pick', 'single-page', 'editorial', 'product-led'] },
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

const DOCS_TRUSTED = {
  tailwind: { label: 'Tailwind CSS', resolve: 'tailwindcss', id: null, cdn: 'https://cdn.tailwindcss.com', aura: ['installGuide tailwindcss dep', 'styles/tokens.css', 'scaffold order'] },
  gsap: { label: 'GSAP + ScrollTrigger', resolve: 'gsap', id: null, cdn: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js', aura: ['installGuide gsap dep', 'preview_html motion'] },
  lenis: { label: 'Lenis smooth scroll', resolve: 'lenis', id: '/darkroomengineering/lenis', cdn: 'unpkg lenis@1 (confirm exact file via lookup)', aura: ['aura_motion_smooth wiring'] },
  iconify: { label: 'Iconify icons', resolve: 'iconify', id: null, cdn: 'https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js', aura: ['installGuide iconify-icon dep'] },
};
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
  for (const d of (deps || [])) { const lib = DOCS_DEP_TO_LIB[d && d.name]; if (lib && !libs.includes(lib)) libs.push(lib); }
  return { status: 'unchecked', needs_check: libs.map((l) => l + ': confirm CDN/version via aura_docs_plan + Context7'), note: 'Vendored Aura code is a snapshot — verify pins before shipping.' };
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

// ---- awards.mjs ----
// Module: awards — award-website discovery, retrieval, parsing, ranking.
// Reimplements the useful Awwwards-mcp behaviors (site discovery, detail
// design-DNA, elements, taxonomy, winners) in Aura's native zero-dep style:
// pure parsers + polite fetch client + deterministic local ranking.
// Upstream inspiration: INSANE0777/Awwwards-mcp (MIT, (c) 2026 Afjal) —
// behavior reimplemented here, not copied; see THIRD_PARTY_NOTICES.md.
// No invented metadata: every record carries source/evidence fields.

const AWARD_SCHEMA_VERSION = 1;
const AWARD_BASE_URL = "https://www.awwwards.com";
const AWARD_ASSETS_URL = "https://assets.awwwards.com";
const AWARD_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 aura-components-mcp/1.7.3";
const AWARD_ALLOWED_HOSTS = ["www.awwwards.com", "awwwards.com", "assets.awwwards.com"];
const AWARD_TIMEOUT_MS = 10000;
const AWARD_MAX_BYTES = 2 * 1024 * 1024;
const AWARD_RATE_MS = 1000;
const AWARD_FILTERS = { sotd: "websites/sites_of_the_day", developer: "websites/developer", honorable: "websites/honorable" };
const AWARD_FILTER_NAMES = ["sotd", "developer", "honorable"];
const AWARD_SECTIONS = ["hero", "proof", "features", "showcase", "pricing", "testimonials", "faq", "cta", "footer"];

function awardErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
function awardBad(message) { return awardErr("BAD_ARGS", message); }
function awardNotFound(message) { return awardErr("NOT_FOUND", message); }
function awardUpstream(message) { return awardErr("UPSTREAM_ERROR", message); }

const AWARD_ENTITIES = { "&quot;": '"', "&amp;": "&", "&#039;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
function awardDecodeEntities(s) {
  return String(s ?? "").replace(/&(?:quot|amp|#0?39|lt|gt|nbsp);/g, (e) => AWARD_ENTITIES[e] ?? e);
}
function awardStripTags(s) {
  return awardDecodeEntities(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function awardNormalizeSlug(s) {
  const v = String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!v || v.length > 120) throw awardBad("slug must be 1-120 chars of [a-z0-9-], got: " + String(s).slice(0, 80));
  return v;
}
// Watches of kind "url" target a site slug. Accept either a bare slug or a
// canonical Awwwards site URL and reduce both to the same slug, so a stored
// watch always compares equal to the indexed slug (legacy raw-URL records
// are normalized at match time too).
function awardWatchTargetSlug(raw) {
  const s = String(raw ?? "").trim();
  if (!s) throw awardBad("url watch needs a site slug or an awwwards /sites/<slug> url");
  let slug = s;
  if (/^https?:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { throw awardBad("url watch is not a parseable url: " + s.slice(0, 120)); }
    const host = u.hostname.toLowerCase();
    if (!AWARD_ALLOWED_HOSTS.includes(host)) throw awardBad("url watch must point at awwwards.com, got: " + host);
    const m = /^\/sites\/([^/]+)\/?$/.exec(u.pathname);
    if (!m) throw awardBad("url watch must be an awwwards.com/sites/<slug> url, got path: " + u.pathname.slice(0, 120));
    slug = m[1];
  }
  return awardNormalizeSlug(slug);
}

// ---- URL safety (SSRF guard) ----
// Parsed-address classification, not regex matching: WHATWG URL already
// canonicalizes alternate IPv4 spellings (0x7f000001 → 127.0.0.1, 2130706433
// → 127.0.0.1) and IPv4-mapped IPv6 (::ffff:127.0.0.1 → ::ffff:7f00:1), so
// policy decisions run on normalized forms. allowLocal relaxes LOOPBACK ONLY
// (127.0.0.0/8, ::1, localhost names) for intended local dev builds; private
// ranges, link-local, CGNAT, ULA, multicast/reserved and cloud metadata stay
// blocked regardless of allowLocal. See SECURITY.md.
const AWARD_METADATA_HOSTNAMES = new Set(["metadata.google.internal", "metadata.goog", "instance-data", "instance-data.ec2.internal"]);
const AWARD_LOCAL_HOST_SUFFIXES = [".local", ".internal", ".home.arpa"];
function awardIpv4Number(a, b, c, d) { return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0; }
function awardInIpv4Range(n, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((base & mask) >>> 0);
}
function awardParseIpv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || ""));
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return awardIpv4Number(parts[0], parts[1], parts[2], parts[3]);
}
function awardClassifyIpv4(n) {
  if (awardInIpv4Range(n, 0x7f000000, 8)) return "loopback";
  if (awardInIpv4Range(n, 0x0a000000, 8)) return "private";
  if (awardInIpv4Range(n, 0xac100000, 12)) return "private";
  if (awardInIpv4Range(n, 0xc0a80000, 16)) return "private";
  if (awardInIpv4Range(n, 0x64400000, 10)) return "private"; // 100.64.0.0/10 CGNAT (incl. Alibaba metadata)
  if (awardInIpv4Range(n, 0xa9fe0000, 16)) return "link-local"; // 169.254/16 (incl. AWS/GCP/Azure IMDS)
  if (n === 0) return "unspecified";
  if (awardInIpv4Range(n, 0xe0000000, 4)) return "multicast";
  if (awardInIpv4Range(n, 0xf0000000, 4)) return "reserved"; // 240/4 incl. broadcast
  if (awardInIpv4Range(n, 0xc0000000, 24)) return "reserved"; // 192.0.0.0/24 (incl. Oracle metadata .192)
  if (awardInIpv4Range(n, 0xc0000200, 24)) return "reserved"; // 192.0.2.0/24 TEST-NET-1
  if (awardInIpv4Range(n, 0xc6120000, 15)) return "reserved"; // 198.18.0.0/15 benchmark
  if (awardInIpv4Range(n, 0xc6336400, 24)) return "reserved"; // 198.51.100.0/24 TEST-NET-2
  if (awardInIpv4Range(n, 0xcb007100, 24)) return "reserved"; // 203.0.113.0/24 TEST-NET-3
  return "public";
}
function awardParseIpv6(s) {
  let t = String(s || "").toLowerCase();
  if (t.startsWith("[") && t.endsWith("]")) t = t.slice(1, -1);
  if (!t.includes(":")) return null;
  let head = t, tail = null;
  const dc = t.indexOf("::");
  if (dc >= 0) { head = t.slice(0, dc); tail = t.slice(dc + 2); }
  const groups = (part) => (part ? part.split(":") : []);
  const headG = groups(head), tailG = groups(tail);
  const bytes = [];
  const pushGroup = (g) => {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(g)) {
      const n = awardParseIpv4(g);
      if (n === null) return false;
      bytes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      return true;
    }
    if (!/^[0-9a-f]{1,4}$/.test(g)) return false;
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 255, v & 255);
    return true;
  };
  for (const g of headG) if (!pushGroup(g)) return null;
  if (tail !== null) {
    const left = 16 - bytes.length;
    if (left < 0) return null;
    const tailBytes = [];
    for (const g of tailG) {
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(g)) {
        const n = awardParseIpv4(g);
        if (n === null) return null;
        tailBytes.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
        const v = parseInt(g, 16);
        tailBytes.push((v >> 8) & 255, v & 255);
      }
      if (bytes.length + tailBytes.length > 16) return null;
    }
    const voidCount = 16 - bytes.length - tailBytes.length;
    if (voidCount < 0) return null;
    for (let i = 0; i < voidCount; i++) bytes.push(0);
    bytes.push(...tailBytes);
  }
  if (bytes.length !== 16) return null;
  return bytes;
}
function awardClassifyIpv6(bytes) {
  const allZero = bytes.every((b) => b === 0);
  if (allZero) return "unspecified";
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return "loopback";
  const first10 = bytes.slice(0, 10).every((b) => b === 0);
  const mapped = first10 && bytes[10] === 0xff && bytes[11] === 0xff; // ::ffff:0:0/96
  const compatible = first10 && bytes[10] === 0 && bytes[11] === 0 && bytes.slice(12, 15).some((b) => b !== 0); // deprecated ::a.b.c.d
  if (mapped || compatible) {
    const v4 = awardClassifyIpv4(awardIpv4Number(bytes[12], bytes[13], bytes[14], bytes[15]));
    return mapped ? v4 : (v4 === "public" ? "reserved" : v4);
  }
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 destination.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((b) => b === 0)) {
    return awardClassifyIpv4(awardIpv4Number(bytes[12], bytes[13], bytes[14], bytes[15]));
  }
  if ((bytes[0] & 0xfe) === 0xfc) return "private"; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return "link-local"; // fe80::/10
  if (bytes[0] === 0xff) return "multicast";
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return "reserved"; // 2001:db8::/32 documentation
  return "public";
}
function awardClassifyHost(hostname) {
  let h = String(hostname ?? "").toLowerCase().replace(/\.+$/, "");
  if (!h) return { kind: "invalid", host: String(hostname ?? "") };
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h.includes(":")) {
    const bytes = awardParseIpv6(h);
    if (!bytes) return { kind: "invalid", host: h };
    return { kind: awardClassifyIpv6(bytes), version: 6, host: h };
  }
  const v4 = awardParseIpv4(h);
  if (v4 !== null) return { kind: awardClassifyIpv4(v4), version: 4, host: h };
  if (/^[0-9.]+$/.test(h)) return { kind: "invalid", host: h }; // numeric-looking but unparseable
  if (h === "localhost" || h.endsWith(".localhost")) return { kind: "loopback", version: null, host: h };
  if (AWARD_METADATA_HOSTNAMES.has(h)) return { kind: "metadata", version: null, host: h };
  if (AWARD_LOCAL_HOST_SUFFIXES.some((suf) => h.endsWith(suf))) return { kind: "local-name", version: null, host: h };
  return { kind: "public", version: null, host: h };
}
function awardIsBlockedHost(hostname) {
  return awardClassifyHost(hostname).kind !== "public";
}
function awardValidateHttpUrl(raw, { allowLocal = false } = {}) {
  if (typeof raw !== "string" || !raw.trim()) throw awardBad("url must be a non-empty http(s) string");
  if (raw.length > 2000) throw awardBad("url too long (max 2000 chars)");
  let u;
  try { u = new URL(raw.trim()); } catch { throw awardBad("url is not parseable: " + raw.slice(0, 120)); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw awardBad("only http/https urls are allowed, got: " + u.protocol);
  if (u.username || u.password) throw awardBad("urls with credentials are not allowed");
  const cls = awardClassifyHost(u.hostname);
  if (cls.kind === "public") return u.toString();
  if (allowLocal && cls.kind === "loopback") return u.toString();
  const e = new Error(awardBlockedReason(cls, u.hostname));
  e.code = "UNSUPPORTED_OPERATION";
  e.hostKind = cls.kind;
  throw e;
}
function awardBlockedReason(cls, hostname) {
  const h = String(hostname);
  if (cls.kind === "loopback") return "loopback target blocked (pass allowLocal:true for intended local dev builds): " + h;
  if (cls.kind === "metadata") return "cloud metadata endpoints are never fetched: " + h;
  if (cls.kind === "private") return "private-network targets are never fetched, even with allowLocal:true (allowLocal permits loopback only): " + h;
  if (cls.kind === "link-local") return "link-local targets are never fetched (" + h + ")";
  if (cls.kind === "unspecified" || cls.kind === "multicast" || cls.kind === "reserved") return "non-routable target blocked (" + cls.kind + "): " + h;
  if (cls.kind === "local-name") return "local-network hostname blocked (" + h + "); only loopback dev targets are permitted with allowLocal:true";
  return "unrecognized host is not fetched: " + h;
}

// ---- DNS resolution guard ----
// Best-effort and positive-blocking only: a hostname that RESOLVES to a
// prohibited address is refused; a lookup that fails (offline DNS) is not an
// error here — the real connection decides, and every redirect hop is
// re-validated anyway. Bounded: lookups that take too long return unchecked
// instead of stalling a tool call.
async function awardCheckHostResolution(rawUrl, { lookup = null, allowLocal = false, timeoutMs = 1500 } = {}) {
  const out = { url: String(rawUrl), host: null, checked: false, blocked: false, addresses: [], blockedAddresses: [], reason: null };
  let u;
  try { u = new URL(String(rawUrl)); } catch { out.reason = "unparseable url"; return out; }
  const cls = awardClassifyHost(u.hostname);
  out.host = cls.host;
  if (cls.version !== null) { out.checked = true; return out; } // IP literals were classified at validation time
  const fn = lookup || awardDefaultLookup();
  if (typeof fn !== "function") { out.reason = "no dns lookup available"; return out; }
  let addrs;
  let timer = null;
  try {
    addrs = await Promise.race([
      Promise.resolve(fn(cls.host, { all: true })),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch (e) { out.reason = "dns lookup failed: " + String((e && e.message) || e).slice(0, 120); return out; }
  finally { if (timer) clearTimeout(timer); }
  if (addrs === null || addrs === undefined) { out.reason = "dns lookup timed out"; return out; }
  const list = Array.isArray(addrs) ? addrs : [addrs];
  out.checked = true;
  for (const a of list) {
    const address = typeof a === "string" ? a : (a && a.address) || "";
    if (!address) continue;
    out.addresses.push(address);
    const k = awardClassifyHost(address).kind;
    const loopbackOk = allowLocal && k === "loopback";
    if (k !== "public" && !loopbackOk) out.blockedAddresses.push(address);
  }
  out.blocked = out.blockedAddresses.length > 0;
  return out;
}
function awardDefaultLookup() {
  const g = globalThis.process && globalThis.process.getBuiltinModule ? globalThis.process.getBuiltinModule : null;
  if (typeof g !== "function") return null;
  try { return g.call(globalThis.process, "node:dns").promises.lookup; } catch { return null; }
}
function awardValidateAwardPath(pathOrUrl) {
  const s = String(pathOrUrl ?? "");
  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    if (!AWARD_ALLOWED_HOSTS.includes(u.hostname.toLowerCase())) throw awardBad("award source host not allowed: " + u.hostname);
    return u.pathname + (u.search || "");
  }
  if (!s.startsWith("/")) throw awardBad("award path must start with / (e.g. /sites/slug)");
  if (s.includes("..") || s.includes("\\") || /[\s<>"]/.test(s)) throw awardBad("unsafe award path");
  return s;
}

// ---- Filter URL builder (one filter per URL; rest applied client-side) ----
function awardFilterUrl(filters = {}) {
  if (filters.color) {
    const c = String(filters.color).replace("#", "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(c)) throw awardBad("color must be a hex like #FF5733");
    return AWARD_BASE_URL + "/websites/%23" + c + "/";
  }
  if (filters.award) {
    if (!AWARD_FILTERS[filters.award]) throw awardBad("award must be one of " + AWARD_FILTER_NAMES.join("|"));
    return AWARD_BASE_URL + "/" + AWARD_FILTERS[filters.award] + "/";
  }
  const tag = filters.technology ?? (Array.isArray(filters.tags) ? filters.tags[0] : null);
  if (tag) {
    const t = String(tag).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    if (!t || t.length > 60) throw awardBad("tag/technology must be 2-60 chars");
    return AWARD_BASE_URL + "/websites/" + encodeURIComponent(t) + "/";
  }
  return AWARD_BASE_URL + "/websites/";
}
function awardSiteUrl(slug) { return AWARD_BASE_URL + "/sites/" + awardNormalizeSlug(slug); }
function awardThumbnailUrl(thumbPath, size = 880) {
  const dim = size === 440 ? "440_330" : "880_660";
  return AWARD_ASSETS_URL + "/awards/media/cache/thumb_" + dim + "/" + String(thumbPath).replace(/^\/+/, "");
}
function awardElementUrl(mediaPath) { return AWARD_ASSETS_URL + "/awards/" + String(mediaPath).replace(/^\/+/, ""); }

// ---- Parsers (scoped, fixture-driven, resilient to missing fields) ----
const AWARD_LABELS = { sotd: "Site of the Day", dev: "Developer Award", hm: "Honorable Mention", sotm: "Site of the Month", mobile: "Mobile Excellence", ecom: "E-Commerce Award" };
// Bump when the listing parser's expectations about upstream markup change;
// diagnostics carry it so callers can tell "page is empty" from "parser can
// no longer read the page" without guessing.
const AWARD_PARSER_VERSION = 1;
const AWARD_FIELD_BOUNDS = { slug: 120, title: 200, tag: 40, tags: 20, studio: 120, liveUrl: 500, thumb: 500 };
function awardBoundStr(v, max) { return String(v ?? "").slice(0, max); }
function awardParseListingEx(html) {
  const src = String(html || "");
  const diagnostics = { parserVersion: AWARD_PARSER_VERSION, bytes: src.length, blobs: 0, parsed: 0, filtered: 0, malformed: 0, anchors: 0, verdict: "empty-input" };
  if (!src) return { sites: [], diagnostics };
  const sites = [];
  const seen = new Set();
  const parts = src.split('data-collectable-model-value="');
  const blobParts = parts.slice(1);
  diagnostics.blobs = blobParts.length;
  for (const part of blobParts) {
    const end = part.indexOf('">');
    if (end < 0 || end > 20000) { diagnostics.malformed++; continue; }
    let meta;
    try { meta = JSON.parse(awardDecodeEntities(part.slice(0, end))); } catch { diagnostics.malformed++; continue; }
    if (!meta || !meta.slug || !meta.title) { diagnostics.filtered++; continue; }
    if (meta.type && meta.type !== "submission") { diagnostics.filtered++; continue; }
    const slug = awardBoundStr(String(meta.slug).toLowerCase(), AWARD_FIELD_BOUNDS.slug);
    if (seen.has(slug)) { diagnostics.filtered++; continue; }
    const card = part.slice(end, end + 8000);
    const detailMatch = card.match(/href="(\/sites\/[^"#?]+)"/);
    if (!detailMatch) { diagnostics.filtered++; continue; }
    const liveMatch = card.match(/class="figure-rollover__bt"[^>]*href="(https?:\/\/[^"]+)"/);
    const awards = [...new Set([...card.matchAll(/budget-tag--([a-z-]+)/g)].map((m) => AWARD_LABELS[m[1]] ?? m[1]))];
    const studioMatch = card.match(/avatar-name__title">([^<]+)</);
    seen.add(slug);
    sites.push({
      slug,
      title: awardBoundStr(awardDecodeEntities(meta.title).trim(), AWARD_FIELD_BOUNDS.title),
      createdAt: Number(meta.createdAt) || 0,
      tags: Array.isArray(meta.tags) ? meta.tags.map((t) => awardBoundStr(awardDecodeEntities(t), AWARD_FIELD_BOUNDS.tag)).filter(Boolean).slice(0, AWARD_FIELD_BOUNDS.tags) : [],
      thumbnailPath: (meta.images && meta.images.thumbnail) ? awardBoundStr(meta.images.thumbnail, AWARD_FIELD_BOUNDS.thumb) : "",
      liveUrl: liveMatch ? awardBoundStr(awardDecodeEntities(liveMatch[1]), AWARD_FIELD_BOUNDS.liveUrl) : null,
      detailPath: detailMatch[1],
      awards,
      studio: studioMatch ? awardBoundStr(awardDecodeEntities(studioMatch[1]).trim(), AWARD_FIELD_BOUNDS.studio) : null,
      source: "awwwards",
      sourceUrl: AWARD_BASE_URL + detailMatch[1],
    });
  }
  // Fallback: plain /sites/ anchors only when the blob scheme is entirely
  // absent (true drift). Filtered blobs (collections, untitled) mean the
  // parser saw the page correctly and found no sites — return empty.
  if (!sites.length && !blobParts.length) {
    const anchors = [...src.matchAll(/href="\/sites\/([a-z0-9-]{1,120})\/?"[^>]*>([^<]{1,120})</gi)];
    for (const m of anchors) {
      const slug = m[1].toLowerCase();
      if (seen.has(slug)) continue;
      seen.add(slug);
      sites.push({ slug, title: awardStripTags(m[2]) || slug, createdAt: 0, tags: [], thumbnailPath: "", liveUrl: null, detailPath: "/sites/" + slug, awards: [], studio: null, source: "awwwards", sourceUrl: AWARD_BASE_URL + "/sites/" + slug });
      if (sites.length >= 50) break;
    }
    diagnostics.anchors = sites.length;
  }
  diagnostics.parsed = sites.length;
  // Verdict: "ok" whenever cards were read. With zero cards, distinguish a
  // page the parser understood (filtered/empty listing) from markup it can
  // no longer read (drift) — callers can keep trust on the former and warn
  // or abort on the latter instead of treating 0 as an error everywhere.
  if (sites.length) diagnostics.verdict = "ok";
  else if (diagnostics.malformed > 0) diagnostics.verdict = "drift-empty";
  else if (blobParts.length > 0) diagnostics.verdict = "filtered-empty";
  else if (/awwwards|data-collectable|\/sites\//i.test(src)) diagnostics.verdict = "empty-listing";
  else diagnostics.verdict = "drift-empty";
  return { sites, diagnostics };
}
function awardParseListing(html) {
  return awardParseListingEx(html).sites;
}
function awardIsNomineePage(html) { return /<h2 class="text-default">\s*Nominee\b/.test(String(html || "")); }
function awardParseScore(html) {
  const m = /c-heading-score__note[^>]*>[^<]*?([\d]+(?:\.\d{1,2})?)/.exec(String(html || ""));
  return m ? parseFloat(m[1]) : null;
}
function awardParseDetail(html, slug) {
  const src = String(html || "");
  const norm = awardNormalizeSlug(slug);
  const palette = [...new Set([...src.matchAll(/<strong>HEX<\/strong>\s*#([0-9A-Fa-f]{6})/g)].map((m) => "#" + m[1].toUpperCase()))];
  const techTitle = src.search(/Technologies\s*(&|&amp;)\s*Tools<\/h2>/);
  const techIdx = techTitle >= 0 ? techTitle : -1;
  const techSection = techIdx >= 0 ? src.slice(techIdx, techIdx + 6000) : "";
  const technologies = [...new Set([...techSection.matchAll(/class="button button--tag"[^>]*>([^<]+)</g)].map((m) => awardStripTags(m[1])))].filter(Boolean);
  const elStart = src.indexOf(">Elements</h2>");
  const elEnd = elStart >= 0 ? src.indexOf(">Color Palette</h2>", elStart) : -1;
  const elSection = elStart >= 0 && elEnd > elStart ? src.slice(elStart, elEnd) : "";
  const elements = [...elSection.matchAll(/collectableTitle&quot;:&quot;(.+?)&quot;/g)].map((m) => awardDecodeEntities(m[1])).filter(Boolean);
  const awards = [...src.matchAll(/(Site of the Day|Developer Award|Honorable Mention|Site of the Month|Mobile Excellence|E-Commerce Award)\s*[-–]\s*([A-Z][a-z]+ \d{1,2}, \d{4})/g)].map((m) => ({ title: m[1], date: m[2] }));
  const descIdx = src.indexOf(">Description</h2>");
  const descMatch = descIdx >= 0 ? src.slice(descIdx, descIdx + 3000).match(/<h3 class="heading-6">([\s\S]{0,2000}?)<\/h3>/) : null;
  const curated = descMatch ? awardStripTags(descMatch[1]) || null : null;
  const ogDesc = (src.match(/property="og:description" content="([^"]*)"/) || [])[1];
  const ogImage = (src.match(/property="og:image" content="([^"]+)"/) || [])[1];
  const h1 = src.match(/<h1 class="heading-1[^"]*">\s*<a href="(https?:\/\/(?!www\.awwwards\.com|assets\.awwwards\.com)[^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  const liveFallback = h1 ? null : src.match(/href="(https?:\/\/(?!www\.awwwards\.com|assets\.awwwards\.com)[^"]+)"[^>]*target="_blank" rel="noopener"/);
  const titleMatch = src.match(/property="og:title" content="([^"]+)"/);
  return {
    slug: norm,
    title: titleMatch ? awardDecodeEntities(titleMatch[1]) : (h1 ? awardStripTags(h1[2]) : null),
    description: curated ?? (ogDesc ? awardDecodeEntities(ogDesc).trim() || null : null),
    palette, technologies, elements, awards,
    nominee: awardIsNomineePage(src),
    score: awardParseScore(src),
    ogImage: ogImage ? awardDecodeEntities(ogImage) : null,
    liveUrl: (h1 && h1[1]) || (liveFallback && liveFallback[1]) ? awardDecodeEntities((h1 && h1[1]) || liveFallback[1]) : null,
    source: "awwwards",
    sourceUrl: awardSiteUrl(norm),
    retrievedAt: new Date().toISOString(),
  };
}
function awardParseCategories(html) {
  const src = String(html || "");
  const colors = [...new Set([...src.matchAll(/href="\/websites\/%23([0-9A-Fa-f]{6})\/"/g)].map((m) => "#" + m[1].toUpperCase()))].sort();
  const filters = [...new Set([...src.matchAll(/href="\/websites\/([a-z0-9-]{2,60})\/"/g)].map((m) => m[1]))].filter((s) => s !== "sites_of_the_day").sort();
  return { colors, filters };
}
function awardParseElementsSection(html) {
  const src = String(html || "");
  const start = src.indexOf(">Elements</h2>");
  if (start < 0) return null;
  const end = src.indexOf(">Color Palette</h2>", start);
  const section = end > start ? src.slice(start, end) : src.slice(start);
  const out = [];
  for (const part of section.split('data-collectable-model-value="').slice(1)) {
    const stop = part.indexOf('">');
    if (stop < 0) continue;
    let blob;
    try { blob = JSON.parse(awardDecodeEntities(part.slice(0, stop))); } catch { continue; }
    const mp = blob && blob.collectableImage;
    if (typeof mp === "string" && /^(element|external)\//.test(mp)) out.push({ title: awardDecodeEntities(String(blob.collectableTitle ?? "")), mediaPath: mp });
  }
  return out;
}
function awardParseElementGallery(html) {
  const src = String(html || "");
  const slugs = [...new Set([...src.matchAll(/href="\/inspiration\/([\w-]{1,120})\/?"/g)].map((m) => m[1]))];
  return slugs;
}
function awardParseElementPage(html) {
  const src = String(html || "");
  const slug = (src.match(/rel="canonical" href="[^"]*?\/inspiration\/([\w-]{1,120})\/?"/) || [])[1] ?? awardParseElementGallery(src)[0] ?? null;
  if (!slug) return null;
  const titleRaw = (src.match(/<h1[^>]*>\s*([\s\S]{2,200}?)\s*(?:<small>from<\/small>|<\/h1>)/) || [])[1];
  const authorRaw = (src.match(/from<\/small>\s*<a(?:[^>"']|"[^"]*"|'[^']*')*>\s*([\s\S]{2,120}?)<\/a>/) || [])[1];
  const siteSlug = (src.match(/from<\/small>\s*<a[^>]*?href="\/sites\/([\w-]{1,120})"/) || [])[1] ?? null;
  const builtI = src.indexOf("was built with...</p>");
  const builtWith = [];
  if (builtI >= 0) for (const t of src.slice(builtI, builtI + 2000).matchAll(/button--tag[^>]*>([^<]{2,30})</g)) {
    const v = t[1].trim();
    if (v && !builtWith.includes(v)) builtWith.push(v);
  }
  let mediaPath = null;
  for (const part of src.split('data-collectable-model-value="').slice(1)) {
    const stop = part.indexOf('"');
    if (stop < 0) continue;
    try {
      const blob = JSON.parse(awardDecodeEntities(part.slice(0, stop)));
      if (blob && blob.collectableImage) { mediaPath = blob.collectableImage; break; }
    } catch { /* ignore */ }
  }
  const category = (src.match(/href="\/elements\/([\w-]{1,60})\/"/) || [])[1] ?? null;
  return {
    slug,
    title: titleRaw ? awardStripTags(titleRaw) : slug,
    author: authorRaw ? awardStripTags(authorRaw) : null,
    siteSlug, builtWith,
    related: awardParseElementGallery(src).filter((s) => s !== slug).slice(0, 12),
    mediaPath, mediaType: mediaPath ? (mediaPath.endsWith(".mp4") ? "video" : "image") : null,
    mediaUrl: mediaPath ? awardElementUrl(mediaPath) : null,
    category,
    source: "awwwards",
    sourceUrl: AWARD_BASE_URL + "/inspiration/" + slug,
  };
}

// ---- Deterministic local ranking (token + prefix + BM25-style idf) ----
const AWARD_STOP = new Set("a,an,the,for,with,and,or,of,to,in,on,my,new,also,that,this,from,into,plus,vs,top,best,up,site,website,web,design".split(","));
function awardTokens(q, max = 6) {
  return String(q ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).map((t) => t.trim()).filter((t) => t.length > 1 && !AWARD_STOP.has(t)).slice(0, max);
}
// Theme words are rank signals, not just match tokens: a "dark …" query
// boosts dark-tagged sites even when no title literally says "dark".
function awardThemeHint(q) {
  const t = String(q ?? "").toLowerCase();
  const dark = /\bdark\b|\bmidnight\b|\bnoir\b|\bblack\b|\bmoody\b|\bcinematic\b/.test(t);
  const light = /\blight\b|\bbright\b|\bairy\b|\bwhite\b|\bpastel\b/.test(t);
  if (dark && !light) return "dark";
  if (light && !dark) return "light";
  return null;
}
// Design-vocabulary aliases: "glassy" should find glassmorphism-tagged sites,
// "3d" should find webgl/three.js ones. Aliases only ADD candidates — the
// reason string always names the original query word, never the alias.
const AWARD_ALIASES = {
  glassy: ["glass", "glassmorphism"], glass: ["glassmorphism"], neon: ["glow", "fluorescent"],
  "3d": ["webgl", "three", "threejs", "3-d"], minimal: ["minimalist", "minimalism"],
  bold: ["brutalist", "brutalism"], playful: ["fun", "quirky"], luxury: ["luxe", "premium", "elegant"],
  dark: ["black", "noir", "midnight", "moody"], light: ["white", "airy", "bright", "pastel"],
};
function awardExpandToken(tok) {
  const t = String(tok).toLowerCase();
  return [t, ...(AWARD_ALIASES[t] || [])];
}
function awardStemLite(tok) {
  let t = String(tok).toLowerCase();
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ies")) t = t.slice(0, -3) + "y";
  else if (t.length > 4 && t.endsWith("es") && /(ses|xes|zes|ches|shes)$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s")) t = t.slice(0, -1);
  return t;
}
function awardFieldHay(site) {
  return {
    title: String(site.title || "").toLowerCase(),
    tags: (Array.isArray(site.tags) ? site.tags : []).map((t) => String(t).toLowerCase()),
    awards: (Array.isArray(site.awards) ? site.awards : []).map((t) => String(t).toLowerCase()),
    studio: String(site.studio || "").toLowerCase(),
  };
}
function awardScoreSites(sites, query, { technology, color } = {}) {
  const toks = awardTokens(query).map(awardStemLite);
  const n = Math.max(1, sites.length);
  const df = new Map();
  for (const t of toks) {
    let c = 0;
    for (const s of sites) {
      const h = awardFieldHay(s);
      const hay = (h.title + " " + h.tags.join(" ") + " " + h.studio).toLowerCase();
      if (hay.includes(t)) c++;
    }
    df.set(t, c);
  }
  const scored = (sites || []).map((s) => {
    const h = awardFieldHay(s);
    let score = 0;
    const reasons = [];
    const hint = awardThemeHint(query);
    for (const raw of awardTokens(query)) {
      const variants = awardExpandToken(awardStemLite(raw));
      const idf = Math.log(1 + n / (1 + (df.get(awardStemLite(raw)) || 0)));
      const titleHit = variants.some((v) => h.title.toLowerCase().includes(v));
      const tagHit = variants.some((v) => h.tags.some((g) => g === v || g.startsWith(v) || awardStemLite(g) === v));
      if (titleHit) { score += 3 * idf; reasons.push("title:" + raw); }
      else if (tagHit) { score += 2 * idf; reasons.push("tag:" + raw); }
      else if (variants.some((v) => (h.title + " " + h.tags.join(" ")).toLowerCase().includes(v))) { score += 1 * idf; reasons.push("text:" + raw); }
      else if (h.studio.includes(raw)) { score += 1.2 * idf; reasons.push("studio:" + raw); }
    }
    // Theme-hint boost (dark/light): tag-level signal, labeled as such.
    if (hint && (h.tags.includes(hint) || h.tags.some((g) => (AWARD_ALIASES[hint] || []).includes(g)))) {
      if (reasons.length > 0 || !toks.length) { score += 1.2; reasons.push("theme:" + hint); }
    }
    // Award/filter bonuses are tie-breakers for matched rows only: they must
    // never rescue a zero-token row into a "match" (honest-empty stays honest).
    const matched = reasons.length > 0 || !toks.length;
    if (technology && h.tags.includes(String(technology).toLowerCase()) && matched) { score += 1.5; reasons.push("tech-filter"); }
    if (color && JSON.stringify(s).toLowerCase().includes(String(color).toLowerCase()) && matched) { score += 0.5; reasons.push("color-hint"); }
    if (Array.isArray(s.awards) && s.awards.length && matched) score += 0.3;
    return { site: s, score: Math.round(score * 100) / 100, reasons: [...new Set(reasons)].slice(0, 6) };
  });
  scored.sort((a, b) => (b.score - a.score) || String(a.site.title).localeCompare(String(b.site.title)) || String(a.site.slug).localeCompare(String(b.site.slug)));
  return { tokens: awardTokens(query), scored };
}
function awardSuggestQueries(query, taxonomy) {
  const toks = awardTokens(query);
  const out = [];
  if (toks.length > 1) out.push(toks.slice(0, Math.min(3, toks.length)).join(" "));
  for (const t of toks.slice(0, 3)) out.push(t);
  const filters = (taxonomy && taxonomy.filters) || [];
  for (const t of toks) {
    const hit = filters.find((f) => f.startsWith(t.slice(0, 4)));
    if (hit && !out.includes(hit)) out.push(hit);
  }
  for (const fb of ["portfolio", "hero", "minimal"]) if (!out.includes(fb) && out.length < 5) out.push(fb);
  return [...new Set(out)].slice(0, 5);
}
function awardCompactSite(s, scoreInfo) {
  const tags = (s.tags || []).slice(0, 8);
  // try_for: agent-actionable cue derived ONLY from observed tags
  // ("dark hero sections" from tags [dark, hero]) — absent when no tags.
  const tryFor = tags.length ? "use for: " + tags.slice(0, 3).join(" ") + " sections" : null;
  return {
    slug: s.slug, title: s.title,
    sourceUrl: s.sourceUrl || awardSiteUrl(s.slug),
    liveUrl: s.liveUrl || null,
    tags,
    awards: s.awards || [],
    studio: s.studio || null,
    previewUrl: s.thumbnailPath ? awardThumbnailUrl(s.thumbnailPath, 880) : (s.ogImage || null),
    ...(tryFor ? { try_for: tryFor } : {}),
    ...(scoreInfo ? { relevance: scoreInfo.score, matchReasons: scoreInfo.reasons } : {}),
    evidence: { source: "awwwards", detailPath: s.detailPath || ("/sites/" + s.slug) },
  };
}
function awardFullSite(s, detail, scoreInfo) {
  const base = awardCompactSite(s, scoreInfo);
  return { ...base, description: (detail && detail.description) || null, palette: (detail && detail.palette) || [], technologies: (detail && detail.technologies) || [], elements: (detail && detail.elements) || [], awardHistory: (detail && detail.awards) || [], score: (detail && detail.score) ?? null, nominee: !!(detail && detail.nominee), retrievedAt: (detail && detail.retrievedAt) || null };
}

// awardSiteIdeas: agent-usable design ideas derived ONLY from observed
// detail fields. Every idea carries status:"suggested" + basis naming the
// evidence — never presented as observed fact. Count contract: 0–6 ideas
// depending on how much evidence the detail holds (1 idea on thin evidence
// is valid, not a failure); null detail yields [].
function awardSiteIdeas(detail) {
  if (!detail) return [];
  const ideas = [];
  const bands = new Set((detail.palette || []).map((c) => {
    const l = awardLuminance(String(c).toUpperCase());
    return l >= 0.7 ? "light" : l <= 0.3 ? "dark" : "mid";
  }));
  if (bands.has("dark") && !bands.has("light")) ideas.push({ idea: "near-black grounds with one saturated accent; keep body text light and verify 4.5:1", status: "suggested", basis: "observed palette skews dark" });
  if (bands.has("light") && !bands.has("dark")) ideas.push({ idea: "light grounds with dark ink; reserve saturated hues for CTAs and focus rings", status: "suggested", basis: "observed palette skews light" });
  const els = (detail.elements || []).join(" ").toLowerCase();
  if (/hero/.test(els)) ideas.push({ idea: "full-viewport hero with a single primary CTA above the fold", status: "suggested", basis: "observed element: hero" });
  if (/pricing|faq/.test(els)) ideas.push({ idea: "comparison table for pricing, accordion for faq — one pattern per section", status: "suggested", basis: "observed elements" });
  if (/testimonial|review/.test(els)) ideas.push({ idea: "social proof as a logo strip plus 2–3 short quotes, not a carousel", status: "suggested", basis: "observed elements" });
  const techs = (detail.technologies || []).join(" ").toLowerCase();
  if (/gsap|scrolltrigger/.test(techs)) ideas.push({ idea: "scroll reveals under 500ms with scrub only on pinned storytelling", status: "suggested", basis: "observed technology: gsap" });
  if (/webgl|three/.test(techs)) ideas.push({ idea: "keep WebGL to one hero canvas with a static-image fallback and reduced-motion off-switch", status: "suggested", basis: "observed technology: webgl" });
  return ideas.slice(0, 6);
}

// ---- Bounded body reader ----
// Reads at most maxBytes from a fetch Response without trusting
// content-length: a streaming read stops as soon as the threshold is
// crossed, so a missing or lying header cannot balloon memory. Falls back
// to res.text() (with a size post-check) when the response exposes no byte
// stream, which keeps plain test doubles working.
async function awardReadBoundedBody(res, maxBytes, label = "response") {
  if (!res) throw awardUpstream(label + " has no response body");
  const len = res.headers && typeof res.headers.get === "function" ? Number(res.headers.get("content-length")) : NaN;
  if (Number.isFinite(len) && len > maxBytes) throw awardUpstream(label + " exceeds " + maxBytes + " bytes");
  const body = res.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    let oversize = false;
    try {
      for (;;) {
        const step = await reader.read();
        if (!step || step.done) break;
        const value = step.value;
        if (value === undefined || value === null) continue;
        total += typeof value === "string" ? value.length : (value.byteLength || 0);
        if (total > maxBytes) { oversize = true; throw awardUpstream(label + " exceeds " + maxBytes + " bytes"); }
        chunks.push(value);
      }
    } finally {
      if (oversize) { try { await reader.cancel(); } catch { /* stream already errored */ } }
    }
    const decoder = new TextDecoder("utf-8");
    let text = "";
    for (const c of chunks) text += typeof c === "string" ? c : decoder.decode(c, { stream: true });
    return text + decoder.decode();
  }
  const text = await res.text();
  if (typeof text === "string" && text.length > maxBytes) throw awardUpstream(label + " exceeds " + maxBytes + " bytes");
  return text || "";
}

// ---- Polite fetch client (1 req/s, bounded, distinct errors) ----
function createAwardClient({ fetchImpl, timeoutMs = AWARD_TIMEOUT_MS, rateMs = AWARD_RATE_MS, userAgent = AWARD_USER_AGENT } = {}) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("fetchImpl must be a function");
  let last = 0;
  let chain = Promise.resolve();
  const acquire = () => {
    const next = chain.then(async () => {
      const wait = last + rateMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
    });
    chain = next.catch(() => {});
    return next;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isRedirect = (status) => status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
  async function getAwardHtml(pathOrUrl) {
    const path = awardValidateAwardPath(pathOrUrl);
    const startUrl = AWARD_BASE_URL + path;
    let url = startUrl;
    let retried = false;   // single retry shared by 5xx and network failures
    let redirects = 0;     // redirects do not consume the retry budget
    for (;;) {
      await acquire();
      const ctrl = new AbortController();
      let timedOut = false;
      // One deadline covers connect AND body read: a stalled stream aborts too.
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
      let res = null;
      let outcome = null;
      try {
        try {
          res = await fetchFn(url, { headers: { "user-agent": userAgent, accept: "text/html,*/*" }, redirect: "manual", signal: ctrl.signal });
        } catch (e) {
          outcome = { kind: timedOut ? "timeout" : "network", error: e };
        }
        if (!outcome) {
          const status = res.status;
          if (isRedirect(status)) {
            const loc = res.headers && typeof res.headers.get === "function" ? res.headers.get("location") : null;
            redirects += 1;
            if (!loc) outcome = { kind: "throw", error: awardUpstream("redirect without location for " + url) };
            else if (redirects > 5) outcome = { kind: "throw", error: awardUpstream("too many redirects fetching " + startUrl) };
            else {
              // Per-hop re-validation: fresh SSRF classification + host allow-list.
              try {
                const next = awardValidateHttpUrl(new URL(loc, url).toString());
                const host = new URL(next).hostname.toLowerCase();
                if (!AWARD_ALLOWED_HOSTS.includes(host)) throw awardUpstream("redirect leaves award hosts: " + host);
                url = next;
                outcome = { kind: "redirect" };
              } catch (e) {
                outcome = { kind: "throw", error: e && e.code ? e : awardUpstream("bad redirect for " + url) };
              }
            }
          } else if (status === 404) {
            outcome = { kind: "throw", error: awardNotFound("awwwards page not found: " + url) };
          } else if (status === 403 || status === 429) {
            const e = awardUpstream("awwwards is blocking requests (HTTP " + status + " on " + url + "). Try again later; blocks are never retried.");
            e.blocked = true;
            e.status = status;
            outcome = { kind: "throw", error: e };
          } else if (status >= 500 && status < 600) {
            outcome = retried
              ? { kind: "throw", error: awardUpstream("transient awwwards status " + status + " on " + url) }
              : { kind: "retry" };
          } else if (!res.ok) {
            outcome = { kind: "throw", error: awardUpstream("awwwards HTTP " + status + " on " + url) };
          } else {
            try {
              const html = await awardReadBoundedBody(res, AWARD_MAX_BYTES, "awwwards page");
              outcome = { kind: "html", html };
              res = null; // body fully consumed — nothing left to drain
            } catch (e) {
              outcome = { kind: "throw", error: e && e.code ? e : awardUpstream((timedOut ? "timeout fetching " : "awwwards body read failed for ") + url) };
            }
          }
        }
      } finally {
        clearTimeout(timer);
        if (res && !res.bodyUsed) { try { if (res.body && typeof res.body.cancel === "function") await res.body.cancel(); } catch { /* socket already released */ } }
      }
      if (outcome.kind === "html") return { html: outcome.html, finalUrl: url };
      if (outcome.kind === "redirect") continue;
      if (timedOut) throw awardUpstream("timeout fetching " + url);
      if (outcome.kind === "retry") {
        retried = true;
        await sleep(400);
        continue;
      }
      if (outcome.kind === "network") {
        if (!retried) { retried = true; await sleep(300); continue; }
        throw awardUpstream("network error fetching " + url + ": " + String((outcome.error && outcome.error.message) || outcome.error).slice(0, 200));
      }
      throw outcome.error;
    }
  }
  return { getAwardHtml };
}

// awardStaticSummary: one-line human rendering of a static-motion record.
// Lives with the data shape (locality); the blueprint handler just maps it.
function awardStaticSummary(slug, st) {
  if (!st || st.status !== "static-markup") return null;
  return slug + ": " + [st.libs.length ? st.libs.join("+") : "vanilla", st.keyframes ? st.keyframes + " keyframes" : null, st.transitions ? st.transitions + " transitions" : null, st.canvases ? st.canvases + " canvas" : null, st.scrollCues.length ? "cues(" + st.scrollCues.slice(0, 4).join(",") + ")" : null].filter(Boolean).join(", ");
}

// ---- Static motion cues: real markup evidence without a browser ----
// Fetches a public reference URL (bounded, SSRF-guarded) and scans for
// animation library scripts, @keyframes, transitions, scroll cues, and
// media elements. Status is ALWAYS "static-markup" — this is observed page
// source, never runtime behavior: ScrollTrigger counts, scrub ratios, and
// easing vocabularies still require a recorded browser study. Failures
// return {status:"unavailable", reason} instead of throwing (except empty
// input, which is a contract violation → BAD_ARGS).
const AWARD_STATIC_LIBS = [
  { lib: "gsap", res: [/gsap(\.min)?\.js/i, /scrolltrigger/i, /gsap\./i] },
  { lib: "lenis", res: [/lenis/i] },
  { lib: "locomotive", res: [/locomotive/i] },
  { lib: "swiper", res: [/swiper/i] },
  { lib: "framer", res: [/framer/i] },
  { lib: "lottie", res: [/lottie/i, /dotlottie/i] },
  { lib: "three", res: [/three(\.min)?\.js/i, /three\./i] },
  { lib: "pixi", res: [/pixi/i] },
  { lib: "aos", res: [/aos(\.min)?\.js/i, /data-aos/i] },
  { lib: "barba", res: [/barba/i] },
];
const AWARD_STATIC_CUES = ["data-aos", "data-scroll", "scrolltrigger", "sticky", "parallax", "marquee", "reveal", "loader", "preloader"];
// ---- Guarded HTML fetch (shared by static motion + audit static fallback) ----
// Manual redirects (≤3 hops) with per-hop URL classification and a
// best-effort DNS guard, one deadline per hop covering the body read, and a
// streaming bounded read. Returns {ok:true, url, finalUrl, html} or
// {ok:false, reason, status?}; only a contract violation (empty input)
// throws.
async function awardFetchGuardedHtml(rawUrl, { fetchImpl, lookup = null, timeoutMs = AWARD_TIMEOUT_MS, maxBytes = 1500000, allowLocal = false, label = "page" } = {}) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) throw awardErr("BAD_ARGS", "url must be a non-empty string");
  let target;
  try { target = awardValidateHttpUrl(rawUrl, { allowLocal }); }
  catch (e) { return { ok: false, reason: (e && e.message) || String(e) }; }
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, reason: "no fetch available" };
  const guard = async (u) => {
    try {
      const dns = await awardCheckHostResolution(u, { lookup, allowLocal });
      return dns.blocked ? "host resolves to a blocked address (" + dns.blockedAddresses.join(", ") + ")" : null;
    } catch { return null; }
  };
  const firstBlock = await guard(target);
  if (firstBlock) return { ok: false, reason: firstBlock };
  let url = target;
  for (let hop = 0; hop <= 3; hop++) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    let res = null;
    try {
      try {
        res = await fetchFn(url, { headers: { "user-agent": AWARD_USER_AGENT, accept: "text/html,*/*" }, redirect: "manual", signal: ctrl.signal });
      } catch (e) {
        return { ok: false, reason: timedOut ? "timeout fetching " + url : "network error: " + String((e && e.message) || e).slice(0, 120) };
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers && typeof res.headers.get === "function" ? res.headers.get("location") : null;
        if (!loc) return { ok: false, reason: "redirect without location for " + url, status: res.status };
        if (hop === 3) return { ok: false, reason: "too many redirects for " + target };
        let next;
        try { next = awardValidateHttpUrl(new URL(loc, url).toString(), { allowLocal }); }
        catch (e) { return { ok: false, reason: "redirect blocked: " + ((e && e.message) || e), status: res.status }; }
        const hopBlock = await guard(next);
        if (hopBlock) return { ok: false, reason: hopBlock, status: res.status };
        url = next;
        continue;
      }
      if (res.status === 404) return { ok: false, reason: "HTTP 404 for " + url, status: 404 };
      if (!res.ok) return { ok: false, reason: "HTTP " + res.status + " for " + url, status: res.status };
      let html;
      try {
        html = await awardReadBoundedBody(res, maxBytes, label);
        res = null;
      } catch (e) {
        return { ok: false, reason: timedOut ? "timeout fetching " + url : String((e && e.message) || e).slice(0, 160) };
      }
      if (!html || !html.length) return { ok: false, reason: "empty body for " + url, status: 200 };
      return { ok: true, url: target, finalUrl: url, html };
    } finally {
      clearTimeout(timer);
      if (res && !res.bodyUsed) { try { if (res.body && typeof res.body.cancel === "function") await res.body.cancel(); } catch { /* socket already released */ } }
    }
  }
  return { ok: false, reason: "redirect loop for " + target };
}
async function awardStaticMotion(rawUrl, { fetchImpl, lookup = null, timeoutMs = AWARD_TIMEOUT_MS, maxBytes = 1500000, allowLocal = false } = {}) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) throw awardErr("BAD_ARGS", "url must be a non-empty string");
  const fail = (reason) => ({ status: "unavailable", url: String(rawUrl).slice(0, 200), reason: String(reason).slice(0, 200) });
  const got = await awardFetchGuardedHtml(rawUrl, { fetchImpl, lookup, timeoutMs, maxBytes, allowLocal, label: "static page" });
  if (!got.ok) return fail(got.reason);
  const html = got.html;
  const src = html.slice(0, maxBytes);
  const count = (re) => Math.min(999, (src.match(re) || []).length);
  const libs = AWARD_STATIC_LIBS.filter(({ res }) => res.some((re) => re.test(src))).map(({ lib }) => lib);
  return {
    status: "static-markup", url: got.url,
    libs, keyframes: count(/@keyframes\s/gi), animations: count(/animation\s*:/gi), transitions: count(/transition\s*:/gi),
    canvases: count(/<canvas/gi), videos: count(/<video/gi),
    scrollCues: AWARD_STATIC_CUES.filter((c) => src.toLowerCase().includes(c)),
    reducedMotion: /prefers-reduced-motion/i.test(src),
    bytes: src.length,
    evidence: "static page markup (not runtime observation): record a browser study for trigger counts and easing vocab",
    fetchedAt: new Date().toISOString(),
  };
}

// ---- Design-brief builder (pure): observed facts vs patterns vs proposals ----
const AWARD_BLUEPRINT_VERSION = 1;
function awardFreq(rows) {
  const by = new Map();
  for (const r of rows) for (const v of new Set((r.values || []).map((x) => String(x).toLowerCase()).filter(Boolean))) {
    if (!by.has(v)) by.set(v, new Set());
    by.get(v).add(r.slug);
  }
  return [...by].map(([value, slugs]) => ({ value, frequency: slugs.size, sourceSlugs: [...slugs].sort() }))
    .sort((a, b) => (b.frequency - a.frequency) || a.value.localeCompare(b.value));
}
function awardLuminance(hex) {
  try {
    const ch = hex.slice(1).match(/.{2}/g).map((p) => parseInt(p, 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  } catch { return 0.5; }
}
// Technology families for compare: "WebGL" and "Three.js" are the same stack
// choice spelled differently. Canonicalization applies ONLY to the family
// overlap signal — per-site raw values stay verbatim.
const AWARD_TECH_FAMILIES = [
  { family: "webgl", members: ["webgl", "three", "three.js", "threejs", "babylon", "pixi", "glsl", "shader"] },
  { family: "gsap", members: ["gsap", "greensock", "scrolltrigger"] },
  { family: "lenis", members: ["lenis", "studio-freight"] },
  { family: "react", members: ["react", "next", "next.js", "gatsby"] },
  { family: "tailwind", members: ["tailwind", "tailwindcss"] },
];
function awardTechFamily(tech) {
  const t = String(tech || "").toLowerCase().trim();
  for (const f of AWARD_TECH_FAMILIES) if (f.family === t || f.members.includes(t)) return f.family;
  return t;
}
function awardCompareSites(entries) {
  // entries: [{ slug, detail|null, motion|null }]
  const usable = entries.filter((e) => e.detail);
  const tech = awardFreq(usable.map((e) => ({ slug: e.slug, values: e.detail.technologies || [] })));
  const techFamilies = awardFreq(usable.map((e) => ({ slug: e.slug, values: (e.detail.technologies || []).map(awardTechFamily) })));
  const elements = awardFreq(usable.map((e) => ({ slug: e.slug, values: e.detail.elements || [] })));
  const palette = awardFreq(usable.map((e) => ({ slug: e.slug, values: e.detail.palette || [] })));
  // Fuzzy element overlap: "Hero Section" and "hero banner" share the keyword
  // hero even when full strings differ — reported as keyword overlap, and the
  // exact strings stay visible per site so nothing is overstated.
  const elemKeywords = awardFreq(usable.map((e) => {
    const words = new Set();
    for (const el of (e.detail.elements || [])) for (const w of String(el).toLowerCase().split(/[^a-z0-9]+/)) if (w.length > 3) words.add(w);
    return { slug: e.slug, values: [...words] };
  }));
  const bandOf = (hex) => (awardLuminance(String(hex).toUpperCase()) >= 0.7 ? "light" : awardLuminance(String(hex).toUpperCase()) <= 0.3 ? "dark" : "mid");
  const bands = usable.map((e) => ({ slug: e.slug, bands: [...new Set((e.detail.palette || []).map(bandOf))] }));
  const bandVotes = {};
  for (const b of bands) for (const x of b.bands) bandVotes[x] = (bandVotes[x] || 0) + 1;
  const direction = [];
  const topBand = Object.entries(bandVotes).sort((a, b) => b[1] - a[1])[0];
  if (topBand && topBand[1] >= 2) direction.push("all refs skew " + topBand[0] + " — keep that value range for backgrounds");
  const sharedTech = tech.filter((t) => t.frequency >= 2);
  const sharedTechFamilies = techFamilies.filter((t) => t.frequency >= 2);
  if (sharedTech.length) direction.push("shared stack (" + sharedTech.slice(0, 3).map((t) => t.value).join(", ") + ") — safe default for the build");
  else if (sharedTechFamilies.length) direction.push("shared stack family (" + sharedTechFamilies.slice(0, 3).map((t) => t.value).join(", ") + ") — same capability, different spelling — safe default for the build");
  const per = entries.map((e) => ({
    slug: e.slug,
    title: (e.detail && e.detail.title) || e.slug,
    sourceUrl: (e.detail && e.detail.sourceUrl) || awardSiteUrl(e.slug),
    palette: (e.detail && e.detail.palette) || [],
    luminanceBands: (e.detail && [...new Set((e.detail.palette || []).map(bandOf))]) || [],
    technologies: (e.detail && e.detail.technologies) || [],
    technologiesInferred: !!(e.detail && e.detail.technologiesInferred),
    elements: (e.detail && e.detail.elements) || [],
    awards: (e.detail && e.detail.awards) || [],
    score: (e.detail && e.detail.score) ?? null,
    motion: e.motion ? { libs: e.motion.stack.libs, scrollModel: e.motion.stack.scrollModel } : null,
    gaps: [...(e.detail ? [] : ["detail unavailable"]), ...(e.motion ? [] : ["motion not recorded"])],
  }));
  return { per, sharedTech, sharedTechFamilies, sharedElements: elements.filter((t) => t.frequency >= 2), sharedElementKeywords: elemKeywords.filter((t) => t.frequency >= 2), sharedPalette: palette.filter((t) => t.frequency >= 2), sharedBands: bands, directionHints: direction };
}
function awardBuildBlueprint({ goal, refs, details, auraMatches, structureNotes, motionNotes, motionRecorded = false, constraints = [], technology = null, visualDirection = null, responsive = null, requestedPalette = [], gaps: extraGaps = [] }) {
  if (!goal || !String(goal).trim()) throw awardBad("goal is required");
  const usable = (details || []).filter((d) => d && d.detail);
  const threshold = usable.length === 2 ? 2 : usable.length >= 3 ? Math.ceil(usable.length / 2) : Infinity;
  const tech = awardFreq(usable.map((d) => ({ slug: d.slug, values: d.detail.technologies || [] })));
  const elements = awardFreq(usable.map((d) => ({ slug: d.slug, values: d.detail.elements || [] })));
  const paletteRaw = awardFreq(usable.map((d) => ({ slug: d.slug, values: (d.detail.palette || []).map((c) => String(c).toUpperCase()) })));
  const palette = paletteRaw.map((p) => ({ ...p, luminanceBand: awardLuminance(p.value) >= 0.7 ? "light" : awardLuminance(p.value) <= 0.3 ? "dark" : "mid" }));  const tagged = [...tech.map((s) => ({ ...s, kind: "technology" })), ...elements.map((s) => ({ ...s, kind: "element" })), ...palette.map((s) => ({ ...s, kind: "palette" }))];
  const shared = tagged.filter((s) => s.frequency >= threshold).sort((a, b) => (b.frequency - a.frequency) || a.value.localeCompare(b.value));
  const outliers = usable.length >= 2 ? tagged.filter((s) => s.frequency === 1).sort((a, b) => a.value.localeCompare(b.value)).slice(0, 12) : [];
  const gaps = [];
  for (const r of (refs || [])) {
    const hit = usable.find((d) => d.slug === r);
    if (!hit) gaps.push(r + ": reference detail unavailable (upstream fetch failed or slug unknown)");
  }
  for (const g of (extraGaps || [])) if (!gaps.includes(g)) gaps.push(g);
  if (!usable.length) gaps.push("no reference details available; brief is goal-only and low confidence");
  const sections = AWARD_SECTIONS;
  const lines = [];
  lines.push("# Design brief — " + String(goal).slice(0, 120));
  lines.push("");
  lines.push("_Goal:_ " + goal);
  if (technology) lines.push("_Stack:_ " + technology);
  if (visualDirection) lines.push("_Direction:_ " + visualDirection);
  if (responsive) lines.push("_Responsive:_ " + responsive);
  lines.push("");
  lines.push("## References (evidence)");
  for (const d of (details || [])) {
    const t = d.detail;
    lines.push("- `" + d.slug + "` — " + ((t && t.title) || d.slug) + " — " + ((t && t.sourceUrl) || awardSiteUrl(d.slug)) + (t ? "" : " (detail unavailable)"));
  }
  lines.push("");
  lines.push("## Direction");
  lines.push(shared.length ? "Build on what " + shared.length + " shared signals agree on; treat the outliers below as one-site flavor, not rules." : "No cross-reference consensus; follow the goal and the strongest single reference, and mark choices as proposed.");
  if (shared.length) { lines.push(""); lines.push("### Shared patterns (observed)"); for (const s of shared.slice(0, 12)) lines.push("- " + s.kind + " `" + s.value + "` — " + s.frequency + "/" + usable.length + " refs (" + s.sourceSlugs.join(", ") + ")"); }
  if (outliers.length) { lines.push(""); lines.push("### One-site details (do not generalize)"); for (const s of outliers.slice(0, 8)) lines.push("- " + s.kind + " `" + s.value + "` — only in " + s.sourceSlugs.join(", ")); }
  if (palette.length) { lines.push(""); lines.push("### Palette evidence"); for (const p of palette.slice(0, 8)) lines.push("- `" + p.value + "` (" + p.luminanceBand + ") — " + p.frequency + "/" + usable.length + " refs"); }
  let tokenGround = null, tokenInk = null, tokenAccents = [];
  if (requestedPalette.length) {
    lines.push("");
    lines.push("### Requested palette (proposed, not observed)");
    lines.push("Named in your goal/direction — apply as CSS tokens; verify contrast before shipping:");
    for (const c of requestedPalette) lines.push("- `" + c + "` (" + (awardLuminance(c) >= 0.7 ? "light" : awardLuminance(c) <= 0.3 ? "dark" : "mid") + ", proposed)");
    const observedBands = [...new Set(palette.map((p) => p.luminanceBand))];
    if (observedBands.length) lines.push("- Refs skew " + observedBands.join("/") + "; keep their layout rhythm, recolor to the proposed tokens above.");
    // Paste-ready starter: darkest requested hex = ground, lightest = text,
    // the rest = accents — all labeled proposed, contrast to be verified.
    const lum = requestedPalette.map((c) => ({ c, l: awardLuminance(c) })).sort((a, b) => a.l - b.l);
    let ground = lum[0].c, ink = lum[lum.length - 1].c, inkDefaulted = false;
    if (lum.length === 1) { ink = lum[0].l <= 0.3 ? "#F5F5F5" : "#111318"; inkDefaulted = true; }
    tokenGround = ground; tokenInk = ink; tokenAccents = lum.slice(1, -1).map((x) => x.c);
    const accents = lum.slice(1, -1).map((x) => x.c);
    lines.push("");
    lines.push("```css");
    lines.push("/* proposed tokens — paste into styles/tokens.css first */");
    lines.push(":root {");
    lines.push("  --aw-ground: " + ground + "; --aw-ink: " + ink + ";" + (inkDefaulted ? " /* ink defaulted for contrast — verify */" : ""));
    for (let i = 0; i < tokenAccents.length; i++) lines.push("  --aw-accent-" + (i + 1) + ": " + tokenAccents[i] + ";");
    lines.push("  --aw-glass: color-mix(in srgb, var(--aw-ink) 8%, transparent);");
    lines.push("}");
    lines.push("```");
  }
  lines.push("");
  lines.push("## Aura matches (free-only, real catalogue rows)");
  const matches = (auraMatches && auraMatches.length ? auraMatches : []);
  if (!matches.length) lines.push("- Catalogue lookup unavailable or matched nothing — proceed with tokens only; do not invent component IDs.");
  for (const m of matches.slice(0, 10)) lines.push("- [" + m.section + "] `" + m.componentTitle + "` (" + m.componentId + ") — " + m.pageUrl + " — " + m.why + (m.matchEvidence && m.matchEvidence.fallback ? " (via fallback " + m.matchEvidence.fallback + " — verify the fit before pasting)" : "") + (m.editorial ? " [editorial pick]" : ""));
  lines.push("");
  lines.push("## Sections (proposed order)");
  sections.forEach((s, i) => lines.push((i + 1) + ". " + s));
  lines.push("");
  lines.push("## Motion guidance (evidence-backed only)");
  lines.push(motionNotes || "No recorded motion for these refs; keep entrances <500ms, honor prefers-reduced-motion, add scroll reveals only if a study supports them.");
  if (structureNotes) lines.push("");
  if (structureNotes) lines.push("## Structure evidence");
  if (structureNotes) lines.push(structureNotes);
  lines.push("");
  lines.push("## Accessibility & performance");
  lines.push("- Keyboard: all interactive sections reachable; visible focus; no hover-only content.");
  lines.push("- Contrast: verify palette pairs at 4.5:1 before shipping.");
  lines.push("- Reduced motion: disable/parallax-off under prefers-reduced-motion; content stays readable without JS.");
  lines.push("- Performance: prefer system/Aura assets; lazy-load below-fold media; keep animation <500ms.");
  if (constraints.length) { lines.push(""); lines.push("## Constraints"); for (const c of constraints) lines.push("- Honor constraint: " + c); }
  lines.push("");
  lines.push("## Checklist");
  lines.push("- [ ] Tokens first (palette/type/spacing as CSS vars)");
  lines.push("- [ ] Sections in the order above, responsive at 390/768/1024+");
  lines.push("- [ ] Aura components pasted per match list, CSS scoped");
  lines.push("- [ ] Motion only from evidence; reduced-motion path tested");
  lines.push("- [ ] Contrast + keyboard pass; no copied third-party source");
  lines.push("");
  lines.push("## Evidence gaps");
  if (gaps.length) { for (const g of gaps) lines.push("- " + g); }
  else lines.push("- None material: refs, motion/structure evidence as cited above, catalogue matches listed.");
  // Evidence-scored confidence: base from usable ref count, +1 per
  // independent axis actually present (matched sections, RECORDED motion,
  // measured structure, fully-parsed tech). Static markup cues describe the
  // page source, not observed runtime behavior, so they never add a point.
  // Thin evidence stays low; rich evidence may reach high — same honesty,
  // both directions.
  const why = [];
  let points = Math.min(usable.length, 3);
  why.push(usable.length + " usable ref" + (usable.length === 1 ? "" : "s"));
  const sectionHits = matches.filter((m) => m.section !== "tokens" && !m.editorial).length;
  if (sectionHits >= 4) { points++; why.push(sectionHits + " catalogue sections matched"); }
  if (motionRecorded) { points++; why.push("recorded motion evidence"); }
  if (structureNotes && structureNotes.includes("(live-dom)")) { points++; why.push("measured structure"); }
  if (usable.length >= 2 && usable.every((d) => (d.detail.technologies || []).length && !d.detail.technologiesInferred)) { points++; why.push("fully-parsed technologies (not inferred)"); }
  const confidence = points <= 1 ? "low" : points <= 3 ? "low-medium" : points === 4 ? "medium" : "high";
  const spec = {
    version: AWARD_BLUEPRINT_VERSION, goal,
    refs: (refs || []).map((slug) => {
      const hit = (details || []).find((d) => d.slug === slug);
      const st = hit && hit.motion_static ? hit.motion_static.status : "none";
      return { slug, sourceUrl: awardSiteUrl(slug), motionStatic: st };
    }),
    sharedPatterns: shared, outliers: outliers.slice(0, 12), palette,
    requestedPalette: requestedPalette.map((c) => ({ value: c, status: "proposed" })),
    tokens_css: requestedPalette.length ? (":root{--aw-ground:" + tokenGround + ";--aw-ink:" + tokenInk + ";" + tokenAccents.map((c, i) => "--aw-accent-" + (i + 1) + ":" + c).join(";") + ";}") : "",
    auraMatches: matches.slice(0, 10),
    sections, constraints,
    confidence, confidenceWhy: why,
    gaps,
  };
  return { markdown: lines.join("\n"), spec };
}

// ---- awards-index.mjs ----
// Module: awards-index — persistent local award-reference store.
// File-based JSON (no sqlite dep): atomic writes, versioned schema,
// corrupt recovery, stale-lock single-writer, resume checkpoints, bounded
// growth, winner baselines, watches, motion records. No auto-crawl on boot.

const AWARD_INDEX_VERSION = 1;
const AWARD_INDEX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const AWARD_LOCK_STALE_MS = 30 * 60 * 1000;
const AWARD_MAX_SITES = 5000;
const AWARD_MAX_ELEMENTS = 5000;
const AWARD_MAX_MOTION = 200;
const AWARD_FILES = ["sites.json", "elements.json", "taxonomy.json", "motion.json", "meta.json"];

function awardIdxBuiltins() {
  const g = globalThis.process && globalThis.process.getBuiltinModule ? globalThis.process.getBuiltinModule : null;
  if (typeof g !== "function") throw awardErr("UNSUPPORTED_OPERATION", "file persistence needs Node 22+ (process.getBuiltinModule)");
  const fs = g.call(globalThis.process, "node:fs");
  const path = g.call(globalThis.process, "node:path");
  const os = g.call(globalThis.process, "node:os");
  return { fs, path, os };
}
function awardResolveDir(override) {
  const { path, os } = awardIdxBuiltins();
  if (override && String(override).trim()) {
    const p = String(override);
    if (p.includes("..")) throw awardErr("BAD_ARGS", "awards dir must not contain ..");
    return p;
  }
  const env = globalThis.process && globalThis.process.env ? globalThis.process.env.AURA_AWARDS_DIR : null;
  if (env && String(env).trim()) {
    if (String(env).includes("..")) throw awardErr("BAD_ARGS", "AURA_AWARDS_DIR must not contain ..");
    return String(env);
  }
  return path.join(os.homedir(), ".aura-mcp", "awards");
}
function awardIdxBad(m) { return awardErr("BAD_ARGS", m); }
// url watches may be stored canonically (slug) or as legacy raw records
// (the old code stored the lowercased URL); both reduce to the same target
// at match time so legacy entries keep working.
function awardUrlWatchTarget(pattern) {
  try { return awardWatchTargetSlug(pattern); } catch { return String(pattern || "").trim().toLowerCase(); }
}

function createAwardIndex({ dir, now = () => Date.now() } = {}) {
  const { fs, path } = awardIdxBuiltins();
  const root = awardResolveDir(dir);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, "captures"), { recursive: true });

  const fp = (name) => {
    if (!AWARD_FILES.includes(name) && name !== "lock.json") throw awardIdxBad("unknown index file: " + name);
    const full = path.join(root, name);
    if (path.relative(root, full).startsWith("..")) throw awardIdxBad("path traversal blocked");
    return full;
  };
  function readJson(name, fallback) {
    try {
      if (!fs.existsSync(fp(name))) return fallback;
      const raw = fs.readFileSync(fp(name), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.version !== undefined && parsed.version !== AWARD_INDEX_VERSION && name !== "lock.json") {
        return { ...fallback, version: AWARD_INDEX_VERSION, migratedFrom: parsed.version, updatedAt: new Date(now()).toISOString() };
      }
      return parsed;
    } catch (e) {
      // Corrupt file: quarantine + safe empty (never throw away the session).
      try {
        const bad = fp(name) + ".corrupt-" + now();
        fs.renameSync(fp(name), bad);
      } catch { /* ignore */ }
      const err = awardErr("INDEX_CORRUPT", name + " was corrupt and was quarantined; index rebuilt empty (" + String((e && e.message) || e).slice(0, 120) + ")");
      return { ...fallback, corrupt: err.message, recoveredAt: new Date(now()).toISOString() };
    }
  }
  function writeAtomic(name, obj) {
    const full = fp(name);
    const tmp = full + ".tmp-" + now() + "-" + Math.floor(Math.random() * 1e6);
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 1), "utf8");
    fs.renameSync(tmp, full);
  }
  const emptySites = () => ({ version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), items: [] });
  const emptyElements = () => ({ version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), items: [] });
  const emptyTax = () => ({ version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), colors: [], filters: [] });
  const emptyMotion = () => ({ version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), items: [] });
  const emptyMeta = () => ({ version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), indexStatus: null, progress: [], baselines: {}, watches: [], crawl: null });

  function siteMap() {
    const doc = readJson("sites.json", emptySites());
    const map = new Map();
    for (const s of (doc.items || [])) if (s && s.slug) map.set(String(s.slug).toLowerCase(), s);
    return { doc, map };
  }
  function upsertSitesImpl(sites) {
    const { map } = siteMap();
    let added = 0, updated = 0;
    for (const s of (sites || [])) {
      if (!s || !s.slug) continue;
      const k = String(s.slug).toLowerCase();
      if (map.has(k)) { map.set(k, { ...map.get(k), ...s }); updated++; }
      else { map.set(k, s); added++; }
    }
    let items = [...map.values()];
    if (items.length > AWARD_MAX_SITES) items = items.slice(items.length - AWARD_MAX_SITES);
    writeAtomic("sites.json", { version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), items });
    return { added, updated, total: items.length };
  }
  // Exclusive-create lock (O_EXCL): two processes racing for the same index
  // cannot both believe they own it. A stale/corrupt lock is removed and the
  // create retried once; if another process wins the retry, this caller gets
  // INDEX_BUSY. Stale takeover remains best-effort (see docs/architecture).
  function acquireLock() {
    const lockFile = path.join(root, "lock.json");
    const payload = JSON.stringify({ startedAt: now(), pid: (globalThis.process && globalThis.process.pid) || 0 });
    for (let attempt = 0; attempt < 2; attempt++) {
      let fd = null;
      try {
        fd = fs.openSync(lockFile, "wx");
        fs.writeFileSync(fd, payload, "utf8");
        return;
      } catch (e) {
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } fd = null; try { fs.rmSync(lockFile, { force: true }); } catch { /* never mask */ } }
        if (!e || e.code !== "EEXIST") throw e;
        let prev = null;
        try { prev = JSON.parse(fs.readFileSync(lockFile, "utf8")); } catch { prev = null; }
        if (prev && (now() - (prev.startedAt || 0)) < AWARD_LOCK_STALE_MS) {
          throw awardErr("INDEX_BUSY", "another index run is in progress (lock held since " + new Date(prev.startedAt).toISOString() + ")");
        }
        // Stale or corrupt: remove and retry the exclusive create. Another
        // process may win the retry first — then EEXIST is re-evaluated above.
        try { fs.rmSync(lockFile, { force: true }); } catch { /* retry decides */ }
      } finally {
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } }
      }
    }
    throw awardErr("INDEX_BUSY", "another index run is in progress (lock contested)");
  }
  function releaseLock() { try { fs.rmSync(path.join(root, "lock.json"), { force: true }); } catch { /* never mask */ } }
  // Lock must wrap the whole cycle: acquire first, release in finally; an
  // INDEX_BUSY throw from acquire never releases someone else's lock.
  const withLock = async (fn) => { acquireLock(); try { return await fn(); } finally { releaseLock(); } };

  // One crawl cycle. Caller holds the lock. Returns a report naming the plan,
  // what was fetched this call, and what remains.
  const runCycle = async ({ client, action = "rebuild", tags = null, maxPages = 5, log = () => {}, fresh = false } = {}) => {
    if (!client || typeof client.getAwardHtml !== "function") throw awardIdxBad(action + " needs an award client");
    const startedAt = now();
    const iso = (t = now()) => new Date(t).toISOString();
    const budget = Math.max(1, Math.min(Number(maxPages) || 5, 20));
    const crawlView = (plan) => ({ planId: plan.planId || null, cycle: plan.cycle || 1, pagesTotal: plan.tags.length, pagesDone: plan.done.length, complete: !!plan.finishedAt, startedAt: plan.startedAt || null, finishedAt: plan.finishedAt || null });
    try {
      let meta = readJson("meta.json", emptyMeta());
      const explicit = Array.isArray(tags) && tags.length ? tags.map(String).slice(0, 200) : null;
      const stored = meta.crawl && Array.isArray(meta.crawl.tags) && meta.crawl.tags.length
        ? { ...meta.crawl, tags: meta.crawl.tags.map(String).slice(0, 200), done: (meta.crawl.done || []).map(String) }
        : null;
      if (action === "resume" && stored && stored.finishedAt) {
        // Completed cycle: resume is an explicit no-op, not a silent recrawl.
        return { pagesDone: 0, pagesTotal: stored.tags.length, sitesIndexed: 0, skipped: stored.done.length, completedPages: stored.done.length, complete: true, continued: false, crawl: crawlView(stored), note: "crawl cycle already complete (" + stored.done.length + "/" + stored.tags.length + " pages); use action:refresh to start a new cycle" };
      }
      const explicitMatches = !!(explicit && stored && [...stored.tags].sort().join("|") === [...explicit].sort().join("|"));
      const tagsIgnored = !!(explicit && action === "resume" && stored && !explicitMatches);
      const continueStored = !!(stored && !stored.finishedAt && !fresh && (action === "resume" || !explicit || explicitMatches));
      let plan = null;
      const continued = continueStored;
      if (continueStored) plan = stored;
      if (!plan) {
        // A new plan needs the tag list: explicit tags, or the taxonomy
        // (bootstrapped with one fetch when the index has none yet).
        let wanted = explicit;
        if (!wanted) {
          let tax = readJson("taxonomy.json", emptyTax());
          if (!(tax.filters || []).length) {
            const { html } = await client.getAwardHtml("/websites/");
            tax = { version: AWARD_INDEX_VERSION, updatedAt: iso(), ...awardParseCategories(html) };
            if (!(tax.filters || []).length) throw awardErr("UPSTREAM_ERROR", "awwwards layout may have changed: parsed 0 categories");
            writeAtomic("taxonomy.json", tax);
          }
          wanted = (tax.filters || []).map(String).slice(0, 200);
        }
        if (!wanted.length) throw awardErr("UPSTREAM_ERROR", "no taxonomy to crawl; index has no filters");
        // Legacy checkpoint (a cycle from before plans existed): keep the
        // completed pages that are still part of this plan.
        const seedDone = [];
        if (!fresh && !stored && Array.isArray(meta.progress)) {
          for (const t of meta.progress.map(String)) if (wanted.includes(t) && !seedDone.includes(t)) seedDone.push(t);
        }
        plan = { planId: "cycle-" + startedAt, cycle: ((stored && stored.cycle) || 0) + 1, tags: wanted, done: seedDone, sitesIndexed: 0, startedAt: iso(), finishedAt: null };
        // Persist the plan immediately so a crash before page 1 still leaves
        // resumable state instead of an orphaned taxonomy fetch.
        meta.crawl = plan;
        meta.progress = [...plan.done];
        meta.updatedAt = iso();
        writeAtomic("meta.json", meta);
      }
      let pagesFetched = 0, sitesIndexed = 0;
      const skippedAtStart = plan.done.length;
      for (const tag of plan.tags) {
        if (plan.done.includes(tag)) continue;
        if (pagesFetched >= budget) break;
        const { html } = await client.getAwardHtml("/websites/" + encodeURIComponent(tag) + "/");
        const scan = awardParseListingEx(html);
        // Drift (collectable markup we can no longer read) aborts the cycle
        // with a named reason; a legitimately empty/filtered page is just 0
        // sites and the plan moves on.
        if (scan.diagnostics.verdict === "drift-empty") {
          throw awardErr("UPSTREAM_ERROR", "awwwards collector drift on /websites/" + tag + "/: no readable cards (parser v" + AWARD_PARSER_VERSION + ", blobs=" + scan.diagnostics.blobs + ", malformed=" + scan.diagnostics.malformed + ") — page not indexed, checkpoint kept");
        }
        const sites = scan.sites;
        if (sites.length) upsertSitesImpl(sites.map((s) => ({ ...s, tags: [...new Set([...(s.tags || []), tag])] })));
        sitesIndexed += sites.length;
        pagesFetched++;
        plan.done.push(tag);
        plan.sitesIndexed = (plan.sitesIndexed || 0) + sites.length;
        meta = readJson("meta.json", emptyMeta());
        meta.crawl = plan;
        meta.progress = [...plan.done];
        meta.updatedAt = iso();
        writeAtomic("meta.json", meta);
        log("[" + plan.done.length + "/" + plan.tags.length + "] " + tag + ": " + sites.length + " sites" + (sites.length ? "" : " (legit empty page)"));
      }
      const complete = plan.done.length >= plan.tags.length;
      if (complete) plan.finishedAt = iso();
      meta = readJson("meta.json", emptyMeta());
      meta.crawl = plan;
      meta.progress = complete ? [] : [...plan.done];
      if (complete) meta.indexStatus = { startedAt: plan.startedAt, finishedAt: plan.finishedAt, pagesDone: plan.done.length, pagesTotal: plan.tags.length, sitesIndexed: plan.sitesIndexed || 0 };
      meta.updatedAt = iso();
      writeAtomic("meta.json", meta);
      const out = { pagesDone: pagesFetched, pagesTotal: plan.tags.length, sitesIndexed, skipped: skippedAtStart, completedPages: plan.done.length, complete, continued, crawl: crawlView(plan) };
      if (complete) out.note = "crawl cycle complete (" + plan.done.length + "/" + plan.tags.length + " pages); refresh starts a new cycle";
      else if (pagesFetched >= budget) out.note = "page budget reached (" + pagesFetched + " this call, " + plan.done.length + "/" + plan.tags.length + " total); action:resume continues the same plan";
      else out.note = "no pending pages fetched";   // completes mid-call only when the plan finished exactly at the budget boundary
      if (tagsIgnored) out.note = "tags argument ignored: resume continues the stored plan | " + out.note;
      return out;
    } catch (e) {
      try {
        const meta = readJson("meta.json", emptyMeta());
        meta.indexStatus = { ...(meta.indexStatus || {}), lastError: String((e && e.message) || e).slice(0, 300) };
        writeAtomic("meta.json", meta);
      } catch { /* never mask */ }
      throw e;
    }
  };

  return {
    root,
    files: AWARD_FILES,
    getStatus() {
      const meta = readJson("meta.json", emptyMeta());
      const sites = readJson("sites.json", emptySites());
      const elements = readJson("elements.json", emptyElements());
      const motion = readJson("motion.json", emptyMotion());
      const tax = readJson("taxonomy.json", emptyTax());
      let lock = null;
      try {
        const lockFile = path.join(root, "lock.json");
        if (fs.existsSync(lockFile)) lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      } catch { lock = { unreadable: true }; }
      const finishedAt = meta.indexStatus && meta.indexStatus.finishedAt;
      const freshness = finishedAt ? new Date(finishedAt).toISOString() : null;
      const crawl = meta.crawl ? {
        planId: meta.crawl.planId || null,
        cycle: meta.crawl.cycle || 1,
        pagesTotal: (meta.crawl.tags || []).length,
        pagesDone: (meta.crawl.done || []).length,
        complete: !!meta.crawl.finishedAt,
        startedAt: meta.crawl.startedAt || null,
        finishedAt: meta.crawl.finishedAt || null,
      } : null;
      const recovered = [];
      if (sites.corrupt) recovered.push("sites.json: " + sites.corrupt);
      if (elements.corrupt) recovered.push("elements.json: " + elements.corrupt);
      if (motion.corrupt) recovered.push("motion.json: " + motion.corrupt);
      if (tax.corrupt) recovered.push("taxonomy.json: " + tax.corrupt);
      if (meta.corrupt) recovered.push("meta.json: " + meta.corrupt);
      return {
        dir: root, version: AWARD_INDEX_VERSION,
        counts: { sites: (sites.items || []).length, elements: (elements.items || []).length, motion: (motion.items || []).length, taxonomyFilters: (tax.filters || []).length, taxonomyColors: (tax.colors || []).length, watches: (meta.watches || []).length },
        freshness, stale: !finishedAt || (now() - finishedAt >= AWARD_INDEX_STALE_MS),
        progress: meta.indexStatus || null,
        pendingPages: meta.progress || [],
        completedPages: crawl ? crawl.pagesDone : (meta.progress || []).length,
        crawl,
        lock: lock ? { held: true, since: lock.startedAt ? new Date(lock.startedAt).toISOString() : null } : { held: false },
        ...(sites.corrupt ? { sitesCorrupt: sites.corrupt } : {}),
        ...(meta.corrupt ? { metaCorrupt: meta.corrupt } : {}),
        ...(recovered.length ? { recovered } : {}),
      };
    },
    listSites(limit = 50) {
      const { map } = siteMap();
      return [...map.values()].slice(0, Math.max(1, Math.min(limit, 200)));
    },
    getSite(slug) {
      const n = awardNormalizeSlug(slug);
      const { map } = siteMap();
      return map.get(n) || null;
    },
    upsertSites(sites) { return upsertSitesImpl(sites); },
    getTaxonomy() { return readJson("taxonomy.json", emptyTax()); },
    setTaxonomy(tax) {
      const colors = Array.isArray(tax.colors) ? [...new Set(tax.colors.map(String))].slice(0, 100) : [];
      const filters = Array.isArray(tax.filters) ? [...new Set(tax.filters.map(String))].slice(0, 400) : [];
      writeAtomic("taxonomy.json", { version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), colors, filters });
      return { colors: colors.length, filters: filters.length };
    },
    upsertElements(items) {
      const doc = readJson("elements.json", emptyElements());
      const map = new Map((doc.items || []).map((e) => [String(e.slug), e]));
      let added = 0;
      for (const e of (items || [])) {
        if (!e || !e.slug) continue;
        if (!map.has(String(e.slug))) added++;
        map.set(String(e.slug), e);
      }
      let list = [...map.values()];
      if (list.length > AWARD_MAX_ELEMENTS) list = list.slice(list.length - AWARD_MAX_ELEMENTS);
      writeAtomic("elements.json", { version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), items: list });
      return { added, total: list.length };
    },
    listElements(limit = 50) {
      const doc = readJson("elements.json", emptyElements());
      return (doc.items || []).slice(0, Math.max(1, Math.min(limit, 200)));
    },
    getElement(slug) {
      const doc = readJson("elements.json", emptyElements());
      return (doc.items || []).find((e) => String(e.slug) === String(slug)) || null;
    },
    recordMotion(study) {
      if (!study || !study.url) throw awardIdxBad("motion study needs a url");
      const doc = readJson("motion.json", emptyMotion());
      const items = (doc.items || []).filter((m) => m.url !== study.url);
      items.unshift({ ...study, storedAt: new Date(now()).toISOString() });
      writeAtomic("motion.json", { version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), items: items.slice(0, AWARD_MAX_MOTION) });
      return study;
    },
    searchMotion({ library, easing, scrollModel, limit = 10 } = {}) {
      const doc = readJson("motion.json", emptyMotion());
      let items = (doc.items || []);
      if (library) items = items.filter((m) => JSON.stringify(m).toLowerCase().includes(String(library).toLowerCase()));
      if (easing) items = items.filter((m) => JSON.stringify(m.easingVocab || m.easings || []).toLowerCase().includes(String(easing).toLowerCase()));
      if (scrollModel) items = items.filter((m) => String((m.stack && m.stack.scrollModel) || m.scrollModel || "").toLowerCase() === String(scrollModel).toLowerCase());
      return { total: items.length, items: items.slice(0, Math.max(1, Math.min(limit || 10, 25))), empty: (doc.items || []).length === 0 };
    },
    // Index lifecycle: crawl tag pages via client, resumable, bounded.
    // A "cycle" is one plan (full tag list) plus a done-checkpoint set.
    // rebuild continues an unfinished cycle, or starts a new one when the
    // previous cycle completed; resume only continues pending work and
    // reports an explicit no-op when the cycle is complete; refresh resets
    // and starts a new cycle after the lock is held (no pre-lock mutation).
    // maxPages caps fetches per call, so a plan advances across calls
    // instead of restarting the same prefix every resume.
    async rebuild(args = {}) { return withLock(() => runCycle({ ...args, action: "rebuild" })); },
    async resume(args = {}) { return withLock(() => runCycle({ ...args, action: "resume" })); },
    async refresh(args = {}) { return withLock(() => runCycle({ ...args, action: "refresh", fresh: true })); },
    // Winners: baseline seed then delta. Drift or an empty listing never
    // wipes the baseline — otherwise every known winner would be re-reported
    // as new on the next healthy fetch.
    async newWinners({ client, award = "sotd" } = {}) {
      if (!client || typeof client.getAwardHtml !== "function") throw awardIdxBad("newWinners needs an award client");
      if (!AWARD_FILTERS[award]) throw awardIdxBad("award must be sotd|developer|honorable");
      const { html } = await client.getAwardHtml("/" + AWARD_FILTERS[award] + "/");
      const scan = awardParseListingEx(html);
      const parsed = scan.sites;
      const diag = scan.diagnostics;
      const parserStamp = { parserVersion: AWARD_PARSER_VERSION, verdict: diag.verdict, blobs: diag.blobs, malformed: diag.malformed };
      const meta = readJson("meta.json", emptyMeta());
      const key = "baseline_" + award;
      const prev = meta.baselines && meta.baselines[key];
      const day = new Date(now()).toISOString().slice(0, 10);
      if (diag.verdict === "drift-empty") {
        return { day, seeded: false, newWinners: [], totalInListing: 0, degraded: true, parser: parserStamp, note: "listing returned no readable cards (collector drift?); baseline preserved — retry later" };
      }
      if (!parsed.length) {
        const prevSlugs = (prev && prev.slugs) || [];
        if (prevSlugs.length) return { day, seeded: false, newWinners: [], totalInListing: 0, degraded: true, parser: parserStamp, note: "listing had 0 readable cards; kept the previous baseline of " + prevSlugs.length + " slugs so nothing is re-reported as new" };
        if (!prev) {
          meta.baselines = { ...(meta.baselines || {}), [key]: { slugs: [], at: new Date(now()).toISOString() } };
          writeAtomic("meta.json", meta);
          return { day, seeded: true, newWinners: [], totalInListing: 0, parser: parserStamp, note: "baseline seeded empty; this listing had no readable cards (not drift)" };
        }
        return { day, seeded: false, newWinners: [], totalInListing: 0, parser: parserStamp };
      }
      const slugs = parsed.map((s) => s.slug);
      if (!prev) {
        meta.baselines = { ...(meta.baselines || {}), [key]: { slugs, at: new Date(now()).toISOString() } };
        writeAtomic("meta.json", meta);
        this.upsertSites(parsed);
        return { day, seeded: true, newWinners: [], totalInListing: parsed.length, parser: parserStamp, note: "baseline seeded; no historical delta available yet" };
      }
      const seen = new Set(prev.slugs || []);
      const fresh = parsed.filter((s) => !seen.has(s.slug));
      meta.baselines[key] = { slugs, at: new Date(now()).toISOString() };
      writeAtomic("meta.json", meta);
      this.upsertSites(parsed);
      return { day, seeded: false, newWinners: fresh, totalInListing: parsed.length, parser: parserStamp };
    },
    watchAdd({ kind, pattern, award } = {}) {
      if (!["studio", "tag", "url"].includes(kind)) throw awardIdxBad("watch kind must be studio|tag|url");
      if (typeof pattern !== "string" || !pattern.trim() || pattern.length > 120) throw awardIdxBad("watch pattern must be 1-120 chars");
      const clean = pattern.trim().toLowerCase();
      // url watches normalize to the site slug (a URL and its slug are the
      // same target; storing the raw URL never matched an indexed slug).
      const stored = kind === "url" ? awardWatchTargetSlug(pattern) : clean;
      if (kind === "tag" && !/^[a-z0-9-]{2,60}$/.test(clean)) throw awardIdxBad("tag watch must be a slug like 'webgl'");
      if (award !== undefined && !["sotd", "developer", "honorable"].includes(award)) throw awardIdxBad("watch award must be sotd|developer|honorable");
      const meta = readJson("meta.json", emptyMeta());
      const watches = meta.watches || [];
      const duplicate = watches.some((w) => w.kind === kind && (w.pattern === stored || (kind === "url" && awardUrlWatchTarget(w.pattern) === stored)));
      if (duplicate) throw awardIdxBad("duplicate watch: " + kind + ":" + stored);
      if (watches.length >= 50) throw awardIdxBad("too many watches (max 50)");
      const rec = { kind, pattern: stored, ...(stored !== clean ? { input: pattern.trim() } : {}), award: award || null, createdAt: new Date(now()).toISOString(), lastCheckedAt: null, lastSlugs: null };
      meta.watches = [...watches, rec];
      writeAtomic("meta.json", meta);
      return rec;
    },
    watchList() {
      const meta = readJson("meta.json", emptyMeta());
      return meta.watches || [];
    },
    watchRemove({ kind, pattern } = {}) {
      const meta = readJson("meta.json", emptyMeta());
      const clean = String(pattern || "").trim().toLowerCase();
      const target = kind === "url" ? awardUrlWatchTarget(clean) : clean;
      const before = (meta.watches || []).length;
      meta.watches = (meta.watches || []).filter((w) => !(w.kind === kind && (w.pattern === clean || (kind === "url" && awardUrlWatchTarget(w.pattern) === target))));
      writeAtomic("meta.json", meta);
      return { removed: (meta.watches.length < before) };
    },
    // First evaluation of a watch seeds its baseline silently (deltas stay
    // empty). Detailed form discloses the seeds so callers can show what a
    // watch is now tracking; checkWatches keeps the pinned deltas-only shape.
    checkWatchesDetailed() {
      const meta = readJson("meta.json", emptyMeta());
      const { map } = siteMap();
      const rows = [...map.values()];
      const deltas = [];
      const seeded = [];
      const watches = (meta.watches || []).map((w) => ({ ...w }));
      for (const w of watches) {
        const hits = rows.filter((s) => {
          if (w.kind === "url") return String(s.slug) === awardUrlWatchTarget(w.pattern);
          if (w.kind === "studio") return String(s.studio || "").toLowerCase().includes(w.pattern);
          return (s.tags || []).some((t) => String(t).toLowerCase().replace(/\W+/g, "-") === w.pattern);
        });
        const slugs = hits.map((s) => s.slug).sort();
        if (w.lastSlugs === null || w.lastSlugs === undefined) {
          w.lastCheckedAt = new Date(now()).toISOString();
          w.lastSlugs = slugs;
          if (hits.length) seeded.push({ watch: { kind: w.kind, pattern: w.pattern }, baselineMatches: hits.map((s) => ({ slug: s.slug, title: s.title, sourceUrl: s.sourceUrl })) });
          continue;
        }
        const prev = new Set(w.lastSlugs || []);
        const fresh = hits.filter((s) => !prev.has(s.slug));
        w.lastCheckedAt = new Date(now()).toISOString();
        w.lastSlugs = slugs;
        if (fresh.length) deltas.push({ watch: { kind: w.kind, pattern: w.pattern }, matches: fresh.map((s) => ({ slug: s.slug, title: s.title, sourceUrl: s.sourceUrl })) });
      }
      meta.watches = watches;
      writeAtomic("meta.json", meta);
      return { deltas, seeded };
    },
    checkWatches() { return this.checkWatchesDetailed().deltas; },
  };
}

// ---- browser-cdp.mjs ----
// Module: browser-cdp — optional native Chrome DevTools Protocol adapter.
// Zero npm deps: finds system Chrome/Chromium, launches an isolated profile,
// drives it over global WebSocket CDP (navigate, viewport, evaluate,
// screenshot), cleans up. Missing browser => BROWSER_UNAVAILABLE, never fake.

const CDP_VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
const CDP_CAPTURE_TIMEOUT_MS = 45000;
const CDP_NAV_TIMEOUT_MS = 30000;
const CDP_MAX_SETTLE_MS = 8000;
const CDP_MAX_FRAMES = 16;
const CDP_MAX_RECORD_MS = 30000;

function cdpBuiltins() {
  const g = globalThis.process && globalThis.process.getBuiltinModule ? globalThis.process.getBuiltinModule : null;
  if (typeof g !== "function") throw awardErr("UNSUPPORTED_OPERATION", "browser capture needs Node 22+");
  return {
    fs: g.call(globalThis.process, "node:fs"),
    path: g.call(globalThis.process, "node:path"),
    os: g.call(globalThis.process, "node:os"),
    cp: g.call(globalThis.process, "node:child_process"),
    crypto: g.call(globalThis.process, "node:crypto"),
  };
}
function cdpBad(m) { return awardErr("BAD_ARGS", m); }
function cdpUnavailable(detail) {
  const e = awardErr("BROWSER_UNAVAILABLE", "no Chrome/Chromium found. Install Chrome or set AURA_CHROME_PATH to its executable. " + (detail || ""));
  return e;
}
// Normalize ANY CDP setup failure (socket refused, attach hang, first-frame
// timeout) to BROWSER_UNAVAILABLE with operation-specific fallback guidance.
// A hung Target.* handshake must never surface as a raw upstream timeout.
function cdpSetupFailed(op, err) {
  const why = String((err && err.message) || err).slice(0, 180);
  const fallback = op === "structure"
    ? " Fallback: aura_visual_audit {mode:structure} retries automatically over static HTML (source:static-html, no measured offsets)."
    : op === "motion"
      ? " Fallback motion plan (generic, NOT observed — verify against the live site when a browser is available): entrances <500ms ease-out, one idea per viewport; scroll reveals via IntersectionObserver or GSAP ScrollTrigger (scrub only for pinned storytelling); hover lifts 1.03 + shadow; keep easing vocabulary to ease-out/cubic-bezier(.22,1,.36,1); honor prefers-reduced-motion (disable parallax/scrub, keep content readable); record a study later with aura_motion_study {mode:record}."
      : " Fallback: aura_visual_audit {mode:structure} can still estimate sections from static HTML; screenshots need a working browser.";
  const e = awardErr("BROWSER_UNAVAILABLE", "browser control failed during " + op + " (" + why + "). Check that Chrome is installed and no firewall blocks 127.0.0.1 remote debugging." + fallback);
  return e;
}
function cdpResolveViewport(name) {
  if (name === undefined || name === null) return CDP_VIEWPORTS.desktop;
  if (!CDP_VIEWPORTS[name]) throw cdpBad("viewport must be desktop|mobile");
  return CDP_VIEWPORTS[name];
}
// Self-contained page snippets (no closures; run via Runtime.evaluate).
const CDP_SCAN_JS = `(() => { const doc = document; const out = { title: doc.title, totalHeight: Math.round(doc.documentElement.scrollHeight), candidates: [] }; const bodyW = (doc.body.getBoundingClientRect().width || 1); const push = (tag, label, bg, top, height, textStart) => out.candidates.push({ tag, label, bg, top: Math.round(top), height: Math.round(height), textStart }); push("body", "body", getComputedStyle(doc.body).backgroundColor, 0, out.totalHeight, ""); const seen = new Set(); const visit = (el, depth) => { if (depth > 6 || out.candidates.length >= 300 || seen.has(el)) return; seen.add(el); try { const r = el.getBoundingClientRect(); if (el !== doc.body && r.width >= 0.6 * bodyW && r.height >= 120) { const bg = getComputedStyle(el).backgroundColor || ""; const m = /rgba?\\(([^)]+)\\)/.exec(bg); let a = 0; if (m) { const parts = m[1].replace(/\\//g, " ").trim().split(/[\\s,]+/).filter(Boolean); const raw = parts.length >= 4 ? parts[3] : "1"; a = raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw); if (Number.isNaN(a)) a = 0; } else if (/^(oklch|oklab|lab|lch|hwb|color)\\(/.test(bg.trim())) a = 1; if (a > 0) push(el.tagName.toLowerCase(), (el.id ? "#" + el.id : "") + (el.classList.length ? "." + el.classList[0] : ""), bg, r.top + window.scrollY, r.height, (el.textContent || "").trim().slice(0, 60)); } } catch {} for (const ch of el.children) visit(ch, depth + 1); }; visit(doc.body, 0); return out; })()`;
const CDP_MOTION_JS = `(() => { const g = window; const libs = []; const add = (s) => { if (!libs.includes(s)) libs.push(s); }; try { if (g.gsap || g.TweenMax) add("gsap"); if (g.ScrollTrigger && g.ScrollTrigger.getAll) add("scrolltrigger"); if (g.Lenis || (document.documentElement.classList && document.documentElement.classList.contains("lenis"))) add("lenis"); if (document.querySelector("[data-scroll-container]")) add("locomotive"); if (document.querySelector("[data-aos]")) add("aos"); if (g.Swiper || document.querySelector(".swiper")) add("swiper"); } catch {} const render = []; try { const cs = [...document.querySelectorAll("canvas")]; if (g.THREE) render.push("three"); if (g.PIXI) render.push("pixi"); if (cs.length && !render.length) render.push("webgl"); } catch {} let st = { count: 0, scrub: 0, pin: 0, sample: [] }; try { if (g.ScrollTrigger && g.ScrollTrigger.getAll) { const all = g.ScrollTrigger.getAll(); st.count = all.length; for (const s of all.slice(0, 20)) { const v = (s.vars || {}); if (v.scrub) st.scrub++; if (v.pin) st.pin++; st.sample.push({ start: v.start != null ? String(v.start) : null, end: v.end != null ? String(v.end) : null, scrub: !!v.scrub, pin: !!v.pin, duration: null, ease: null }); } } } catch {} const tweens = { durations: [], eases: [] }; try { const kids = (g.gsap && g.gsap.globalTimeline && g.gsap.globalTimeline.getChildren(true, true, true)) || []; for (const k of kids.slice(0, 100)) { try { const d = typeof k.duration === "function" ? k.duration() : k.vars && k.vars.duration; if (typeof d === "number") tweens.durations.push(d); if (k.vars && k.vars.ease) tweens.eases.push(String(k.vars.ease)); } catch {} } } catch {} let css = []; try { const anims = (document.getAnimations && document.getAnimations()) || []; for (const a of anims.slice(0, 200)) { try { const t = a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming(); if (t && t.easing && String(t.easing).includes("bezier")) css.push(String(t.easing)); if (t && typeof t.duration === "number") tweens.durations.push(t.duration / 1000); } catch {} } } catch {} return { libs, render, scrollTrigger: st, tweens, cssBeziers: css }; })()`;

// Pure band reducer (mirrors upstream sweep; tested with fixture DOM).
function cdpCollapseBands(cands, totalHeight, maxBands = 40) {
  const usable = (cands || []).map((c) => ({ ...c, top: Math.round(c.top || 0), height: Math.round(c.height || 0) })).filter((c) => c.height > 0);
  const STEP = 8;
  const bgAt = (y) => {
    let best = null;
    for (const c of usable) if (c.top <= y && y < c.top + c.height && (!best || c.height < best.height)) best = c;
    return best;
  };
  const runs = [];
  let y = 0, cur = null;
  while (y < totalHeight) {
    const c = bgAt(y);
    if (cur && c && c.bg === cur.cand.bg) { /* continue */ }
    else {
      if (cur) runs.push({ cand: cur.cand, top: cur.top, height: y - cur.top });
      cur = c ? { cand: c, top: y } : null;
    }
    y += STEP;
  }
  if (cur) runs.push({ cand: cur.cand, top: cur.top, height: totalHeight - cur.top });
  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.sealed && prev.cand.bg === r.cand.bg) prev.height = r.top + r.height - prev.top;
    else if (r.height < 40 && prev) { prev.height = r.top + r.height - prev.top; prev.sealed = true; }
    else merged.push({ ...r });
  }
  while (merged.length > maxBands && merged.length > 1) {
    let idx = 1;
    for (let i = 1; i < merged.length; i++) if (merged[i].height < merged[idx].height) idx = i;
    merged[idx - 1].height += merged[idx].height;
    merged.splice(idx, 1);
  }
  return merged.map((r, i) => ({ index: i, tag: r.cand.tag, label: r.cand.label, background: r.cand.bg, offsetTop: Math.round(r.top), height: Math.round(r.height), textStart: r.cand.textStart || "" }));
}
// Static-HTML fallback bands (no layout): honest estimated source label.
function cdpBandsFromHtml(html, url) {
  const src = String(html || "");
  const bands = [];
  const re = /<(section|header|footer|nav|main|div|article)[^>]*>/gi;
  let m, i = 0;
  while ((m = re.exec(src)) && bands.length < 40) {
    const tag = m[1].toLowerCase();
    const chunk = src.slice(m.index, m.index + 2000);
    const h = (chunk.match(/<h[1-3][^>]*>([^<]{1,80})/i) || [])[1];
    const bg = (m[0].match(/background(?:-color)?:\s*([^;"']{1,30})/i) || [])[1] || null;
    const hasImg = /<img|<video/i.test(chunk);
    bands.push({ index: i++, tag, label: tag, background: bg, offsetTop: null, height: null, textStart: h ? String(h).trim().slice(0, 60) : "", media: hasImg });
  }
  return { url, title: (src.match(/<title>([^<]{1,120})<\/title>/i) || [])[1] || url, totalHeight: null, bands, source: "static-html", note: "offsets/heights unavailable without layout; use capture/structure via browser for measured bands" };
}

  // Bounded artifact retention: only ever prunes tool-created files/dirs in
  // tool-owned locations (tmp default dirs), never caller-passed saveDirs.
function cdpPruneOldFiles(dir, { prefix, keepNewest = 20 } = {}) {
  try {
    const { fs, path } = cdpBuiltins();
    const entries = fs.readdirSync(dir).filter((n) => n.startsWith(prefix)).map((n) => {
      const full = path.join(dir, n);
      let t = 0;
      try { t = fs.statSync(full).mtimeMs || 0; } catch { /* skipped below by mtime 0 */ }
      return { full, t };
    }).filter((e) => e.t > 0).sort((a, b) => b.t - a.t);
    let removed = 0;
    for (const e of entries.slice(Math.max(1, keepNewest))) { try { fs.rmSync(e.full, { force: true }); removed++; } catch { /* ignore */ } }
    return removed;
  } catch { return 0; }
}
function cdpPruneOldDirs(parentDir, { prefix, maxAgeMs = 24 * 60 * 60 * 1000, skip = null } = {}) {
  try {
    const { fs, path } = cdpBuiltins();
    const nowMs = Date.now();
    let removed = 0;
    const skipResolved = skip ? path.resolve(skip) : null;
    for (const n of fs.readdirSync(parentDir)) {
      if (!n.startsWith(prefix)) continue;
      const full = path.join(parentDir, n);
      if (skipResolved && path.resolve(full) === skipResolved) continue;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (nowMs - (st.mtimeMs || 0) < maxAgeMs) continue;
      try { fs.rmSync(full, { recursive: true, force: true }); removed++; } catch { /* ignore */ }
    }
    return removed;
  } catch { return 0; }
}

// CDP connection: id-keyed commands over a WebSocket-like transport.
// Messages without an id are domain events (Page.loadEventFired, ...)
// dispatched to onEvent subscribers.
function createCdpConn(socket) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  const route = (raw) => {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : raw.data); } catch { return; }
    if (msg && msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(awardErr("UPSTREAM_ERROR", "CDP " + (msg.error.message || "error")));
      else resolve(msg.result);
    } else if (msg && typeof msg.method === "string" && listeners.has(msg.method)) {
      for (const cb of listeners.get(msg.method)) { try { cb(msg.params || {}); } catch { /* listener never breaks routing */ } }
    }
  };
  // Always install (never guard on a read: setter-only transports report
  // onmessage as undefined on read, which previously left responses unrouted
  // so EVERY command timed out even against a healthy browser).
  try { socket.onmessage = (evt) => route(typeof evt === "string" ? evt : evt.data); } catch { /* send-only test doubles */ }
  return {
    pendingCount: () => pending.size,
    onEvent: (method, cb) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(cb);
      return () => { try { listeners.get(method).delete(cb); } catch { /* ignore */ } };
    },
    command(method, params = {}, timeoutMs = 10000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(awardErr("CAPTURE_TIMEOUT", "CDP " + method + " timed out")); }, timeoutMs);
        pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
      });
    },
    // Test seam: deliver an inbound message (out-of-order safe).
    deliver(msg) {
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(awardErr("UPSTREAM_ERROR", "CDP error"));
        else resolve(msg.result);
      } else if (msg && typeof msg.method === "string" && listeners.has(msg.method)) {
        for (const cb of listeners.get(msg.method)) { try { cb(msg.params || {}); } catch { /* ignore */ } }
      }
    },
  };
}

function findChromeExecutable({ envPath, exists = null, platform = null } = {}) {
  const { fs } = cdpBuiltins();
  const has = exists || ((p) => { try { return fs.existsSync(p); } catch { return false; } });
  const env = globalThis.process && globalThis.process.env ? globalThis.process.env : {};
  const plat = platform || (globalThis.process ? globalThis.process.platform : "linux");
  const candidates = [];
  const configured = envPath || env.AURA_CHROME_PATH;
  if (configured) candidates.push(configured);
  if (plat === "win32") {
    candidates.push("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Chromium\\Application\\chrome.exe");
    const pf = env["PROGRAMFILES"] || "C:\\Program Files";
    candidates.push(pf + "\\Google\\Chrome\\Application\\chrome.exe");
  } else if (plat === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium");
  }
  for (const c of candidates) if (c && has(c)) return c;
  // PATH lookup (which/where) as last resort.
  try {
    const { cp } = cdpBuiltins();
    const cmd = plat === "win32" ? "where chrome" : "which google-chrome chromium chromium-browser chrome";
    const out = cp.spawnSync(plat === "win32" ? "where" : "which", plat === "win32" ? ["chrome"] : ["google-chrome", "chromium", "chromium-browser", "chrome"], { encoding: "utf8", timeout: 5000 });
    const first = String((out && out.stdout) || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && has(first)) return first;
  } catch { /* ignore */ }
  return null;
}
function findFfmpeg({ envPath } = {}) {
  const env = globalThis.process && globalThis.process.env ? globalThis.process.env : {};
  const configured = envPath || env.AURA_FFMPEG_PATH;
  if (configured) return configured;
  try {
    const { cp } = cdpBuiltins();
    const out = cp.spawnSync(globalThis.process && globalThis.process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8", timeout: 5000 });
    const first = String((out && out.stdout) || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first || null;
  } catch { return null; }
}

function createBrowserAdapter({ chromePath = null, fetchImpl = null, socketImpl = null, spawnImpl = null, now = () => Date.now() } = {}) {
  const { fs, path, os, cp } = cdpBuiltins();
  const fetchFn = fetchImpl || globalThis.fetch;
  const WS = socketImpl || globalThis.WebSocket;
  const spawn = (spawnImpl && spawnImpl.spawn) || cp.spawn;

  function executable() {
    const { fs: fss } = cdpBuiltins();
    if (chromePath) {
      try { if (fss.existsSync(chromePath)) return chromePath; } catch { /* fall through */ }
      throw cdpUnavailable("configured chrome not found: " + chromePath);
    }
    return findChromeExecutable({});
  }
  async function launchIsolated(port) {
    const exe = executable();
    if (!exe) throw cdpUnavailable("");
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aura-cdp-"));
    const args = ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--disable-setuid-sandbox", "--user-data-dir=" + profile, "--remote-debugging-port=" + port, "--remote-allow-origins=*", "about:blank"];
    const child = (() => {
      try { return spawn(exe, args, { stdio: "ignore", windowsHide: true, detached: false }); }
      catch (e) { throw cdpUnavailable("launch failed: " + String((e && e.message) || e).slice(0, 160)); }
    })();
    // A bad executable surfaces as an async ENOENT 'error' event, not a
    // throw: record it so the port poll below fails fast with an honest code.
    let spawnErr = null;
    try { child.once("error", (e) => { spawnErr = e; }); } catch { /* ignore */ }
    const cleanup = () => { try { child.kill(); } catch { /* ignore */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } };
    // Wait for /json/version (up to 15s).
    const deadline = Date.now() + 15000;
    let err = null;
    while (Date.now() < deadline) {
      if (spawnErr) { cleanup(); throw cdpUnavailable("launch failed: " + String((spawnErr && spawnErr.message) || spawnErr).slice(0, 160)); }
      try {
        const res = await fetchFn("http://127.0.0.1:" + port + "/json/version", { signal: AbortSignal.timeout(2000) });
        if (res && res.ok) {
          const j = await res.json();
          return { child, profile, cleanup, wsUrl: j.webSocketDebuggerUrl };
        }
      } catch (e) { err = e; }
      await new Promise((r) => setTimeout(r, 300));
      if (child.exitCode !== null && child.exitCode !== undefined) break;
    }
    cleanup();
    throw awardErr("BROWSER_UNAVAILABLE", "Chrome did not open a debug port (" + String((err && err.message) || "launch failed").slice(0, 160) + ")");
  }
  // Attach to a real page target via /json/list (stable across Chrome
  // builds). Target.createTarget over the browser endpoint hangs on several
  // headless=new builds, so it is only a last-resort fallback here.
  async function pageWsUrl(port) {
    const listUrl = "http://127.0.0.1:" + port + "/json/list";
    const read = async () => {
      const res = await fetchFn(listUrl, { signal: AbortSignal.timeout(3000) });
      if (!res || !res.ok) throw new Error("target list HTTP " + (res && res.status));
      return res.json();
    };
    let targets = await read();
    let page = (targets || []).find((t) => t && t.type === "page" && t.webSocketDebuggerUrl);
    if (!page) {
      try { await fetchFn("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT", signal: AbortSignal.timeout(5000) }); } catch { /* fall through to error below */ }
      targets = await read();
      page = (targets || []).find((t) => t && t.type === "page" && t.webSocketDebuggerUrl);
    }
    if (!page) throw new Error("no page target in " + listUrl);
    return page.webSocketDebuggerUrl;
  }
  // Bounded load wait: resolves on Page.loadEventFired, on network-idle
  // (no Page.lifecycleEvent for 2s after load when asked), or on timeout —
  // never hangs the tool call.
  function waitForSettled(conn, send, waitStrategy) {
    return new Promise((resolve) => {
      const cap = setTimeout(resolve, waitStrategy === "networkidle" ? 12000 : 15000);
      let lastActivity = Date.now();
      const idleTimer = waitStrategy === "networkidle" ? setInterval(() => {
        if (Date.now() - lastActivity > 2000) { clearInterval(idleTimer); clearTimeout(cap); resolve(); }
      }, 500) : null;
      const off = conn.onEvent("Page.loadEventFired", () => {
        lastActivity = Date.now();
        if (waitStrategy !== "networkidle") { if (idleTimer) clearInterval(idleTimer); clearTimeout(cap); off(); resolve(); }
      });
      conn.onEvent("Page.lifecycleEvent", () => { lastActivity = Date.now(); });
    });
  }
  async function withPage({ viewport, fn, timeoutMs = CDP_CAPTURE_TIMEOUT_MS, op = "capture" }) {
    const vp = cdpResolveViewport(viewport);
    const port = 19222 + Math.floor(Math.random() * 2000);
    const { child, cleanup } = await launchIsolated(port);
    const stopTimer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeoutMs + 15000);
    try {
      if (!WS) throw cdpUnavailable("WebSocket unavailable in this Node build.");
      let wsUrl;
      try { wsUrl = await pageWsUrl(port); }
      catch (e) { throw cdpSetupFailed(op, e); }
      const ws = new WS(wsUrl, []);
      try {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("CDP socket connect timed out")), 10000);
          ws.onopen = () => { clearTimeout(t); resolve(); };
          ws.onerror = () => { clearTimeout(t); reject(new Error("CDP socket error")); };
        });
      } catch (e) { try { ws.close(); } catch { /* ignore */ } throw cdpSetupFailed(op, e); }
      const conn = createCdpConn({ send: (s) => ws.send(s), set onmessage(v) { ws.onmessage = (e) => v(e.data); } });
      const send = (method, params, t) => conn.command(method, params, t);
      try {
        await send("Page.enable", {}, 8000);
        await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor || 1, mobile: !!vp.isMobile }, 8000);
      } catch (e) { try { ws.close(); } catch { /* ignore */ } throw cdpSetupFailed(op, e); }
      const out = await fn({ send, conn });
      try { ws.close(); } catch { /* ignore */ }
      return out;
    } finally { clearTimeout(stopTimer); cleanup(); }
  }
  // Post-navigation URL guard: the pre-flight only validates the REQUESTED
  // url, but Chrome follows server-side redirects on its own — a public URL
  // that lands on a blocked host (private IP, metadata endpoint, localhost)
  // must not be read any further. Reads the committed URL via CDP; a
  // non-string value (test doubles, detached contexts) is skipped rather
  // than failed, so honest timeouts stay honest.
  async function cdpNavGuard(send, allowLocal) {
    let href = null;
    try {
      const res = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true }, 5000);
      href = res && res.result && typeof res.result.value === "string" ? res.result.value : null;
    } catch { return; }
    if (!href || !/^https?:\/\//i.test(href)) return;
    try { awardValidateHttpUrl(href, { allowLocal }); }
    catch (e) {
      const err = awardErr("UNSUPPORTED_OPERATION", "navigation ended on a blocked URL: " + href + " (" + String((e && e.message) || e).slice(0, 160) + ")");
      err.blockedUrl = href;
      throw err;
    }
  }
  return {
    status() {
      let exe = null;
      try { exe = executable(); } catch { exe = null; }
      return { available: !!exe, executable: exe, ffmpeg: findFfmpeg({}), viewports: Object.keys(CDP_VIEWPORTS) };
    },
    async capture(url, { viewport = "desktop", waitStrategy = "load", settleMs = 1500, allowLocal = false, saveDir = null } = {}) {
      const target = awardValidateHttpUrl(url, { allowLocal });
      if (!["load", "networkidle"].includes(waitStrategy)) throw cdpBad("waitStrategy must be load|networkidle");
      const settle = Math.max(0, Math.min(settleMs ?? 1500, CDP_MAX_SETTLE_MS));
      const exe = executable();
      if (!exe) throw cdpUnavailable("");
      const startedAt = new Date(now()).toISOString();
      const shot = await withPage({
        viewport, op: "capture",
        async fn({ send, conn }) {
          const settled = waitForSettled(conn, send, waitStrategy);
          await send("Page.navigate", { url: target }, CDP_NAV_TIMEOUT_MS);
          await settled;
          await cdpNavGuard(send, allowLocal);
          await new Promise((r) => setTimeout(r, settle));
          // Pre-scroll for lazy sections (bounded).
          try { await send("Runtime.evaluate", { expression: "(async()=>{for(let y=0;y<Math.min(document.documentElement.scrollHeight,10800);y+=450){scrollTo(0,y);await new Promise(r=>setTimeout(r,40));}scrollTo(0,0);await new Promise(r=>setTimeout(r,150));})()", awaitPromise: true }, 8000); } catch { /* best-effort */ }
          const meta = await send("Runtime.evaluate", { expression: "({title:document.title,w:innerWidth,h:innerHeight,total:Math.round(document.documentElement.scrollHeight)})", returnByValue: true }, 8000).catch(() => ({ result: { value: {} } }));
          const snap = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, 15000);
          return { meta: (meta && meta.result && meta.result.value) || {}, png: snap.data };
        },
      });
      const dir = saveDir || path.join(os.tmpdir(), "aura-captures");
      const png = Buffer.from(shot.png, "base64");
      let artifactPath = null;
      let artifactNote = null;
      try {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, "capture-" + String(now()) + ".png");
        fs.writeFileSync(file, png);
        artifactPath = file;
      } catch (e) {
        artifactNote = "screenshot kept in memory only — could not write to " + dir + " (" + String((e && e.message) || e).slice(0, 120) + ")";
      }
      // Retention: only for tool-owned tmp dirs (never a caller saveDir) —
      // keep the newest 20 captures so long agent sessions cannot fill tmp.
      let retentionNote = null;
      if (!saveDir) {
        try {
          const removed = cdpPruneOldFiles(dir, { prefix: "capture-", keepNewest: 20 });
          if (removed > 0) retentionNote = "pruned " + removed + " older capture file(s) (newest 20 kept in " + dir + "; pass saveDir to manage your own directory)";
        } catch { /* best-effort */ }
      }
      return { url: target, viewport, viewportPx: cdpResolveViewport(viewport), capturedAt: startedAt, ...(artifactPath ? { artifactPath } : {}), ...(artifactNote ? { artifactNote } : {}), ...(retentionNote ? { retentionNote } : {}), bytes: png.length, page: shot.meta, limitations: ["lazy-loaded sections below the fold may still be placeholders", "blocked third-party resources are not retried"], source: "live-browser" };
    },
    async structure(url, { viewport = "desktop", allowLocal = false } = {}) {
      const target = awardValidateHttpUrl(url, { allowLocal });
      const exe = executable();
      if (!exe) throw cdpUnavailable("");
      const bands = await withPage({
        viewport, op: "structure",
        async fn({ send, conn }) {
          const settled = waitForSettled(conn, send, "load");
          await send("Page.navigate", { url: target }, CDP_NAV_TIMEOUT_MS);
          await settled;
          await cdpNavGuard(send, allowLocal);
          const res = await send("Runtime.evaluate", { expression: CDP_SCAN_JS, returnByValue: true }, 10000);
          return (res && res.result && res.result.value) || { title: target, totalHeight: 0, candidates: [] };
        },
      });
      const collapsed = cdpCollapseBands(bands.candidates || [], bands.totalHeight || 0);
      return { url: target, title: bands.title || target, totalHeight: bands.totalHeight || 0, bands: collapsed, viewport, viewportPx: cdpResolveViewport(viewport), source: "live-dom" };
    },
    async motionInspect(url, { viewport = "desktop", allowLocal = false } = {}) {
      const target = awardValidateHttpUrl(url, { allowLocal });
      const exe = executable();
      if (!exe) throw cdpUnavailable("");
      const scan = await withPage({
        viewport, op: "motion",
        async fn({ send, conn }) {
          const settled = waitForSettled(conn, send, "load");
          await send("Page.navigate", { url: target }, CDP_NAV_TIMEOUT_MS);
          await settled;
          await cdpNavGuard(send, allowLocal);
          await new Promise((r) => setTimeout(r, 1500));
          const res = await send("Runtime.evaluate", { expression: CDP_MOTION_JS, returnByValue: true }, 10000);
          return (res && res.result && res.result.value) || { libs: [], render: [], scrollTrigger: { count: 0 }, tweens: { durations: [], eases: [] }, cssBeziers: [] };
        },
      });
      return reduceCdpScan(target, scan, now(), viewport);
    },
    // Bounded motion record: one session, N screenshots across a scroll tour.
    // Returns frame files + inspect evidence; webm only when ffmpeg exists.
    async recordFrames(url, { frames = 8, viewport = "desktop", allowLocal = false, saveDir = null, durationMs = 12000 } = {}) {
      const target = awardValidateHttpUrl(url, { allowLocal });
      const n = Math.max(2, Math.min(frames || 8, CDP_MAX_FRAMES));
      const budget = Math.max(4000, Math.min(durationMs || 12000, CDP_MAX_RECORD_MS));
      const exe = executable();
      if (!exe) throw cdpUnavailable("");
      const dir = saveDir || fs.mkdtempSync(path.join(os.tmpdir(), "aura-motion-"));
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      const startedAt = new Date(now()).toISOString();
      const stepMs = Math.floor(budget / (n + 2));
      const out = await withPage({
        viewport, timeoutMs: budget + 30000, op: "motion",
        async fn({ send, conn }) {
          const settled = waitForSettled(conn, send, "load");
          await send("Page.navigate", { url: target }, CDP_NAV_TIMEOUT_MS);
          await settled;
          await cdpNavGuard(send, allowLocal);
          await new Promise((r) => setTimeout(r, Math.min(4000, stepMs)));
          const files = [];
          for (let i = 0; i < n; i++) {
            try {
              await send("Runtime.evaluate", { expression: "scrollTo(0, Math.round(document.documentElement.scrollHeight * " + (i / Math.max(1, n - 1)) + "))", returnByValue: true }, 5000);
            } catch { /* ignore */ }
            await new Promise((r) => setTimeout(r, Math.min(stepMs, 3000)));
            try {
              const snap = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 }, 10000);
              const file = path.join(dir, "frame-" + String(i).padStart(2, "0") + ".jpg");
              fs.writeFileSync(file, Buffer.from(snap.data, "base64"));
              files.push(file);
            } catch { /* partial capture: keep what we have */ }
          }
          let inspect = null;
          try {
            const res = await send("Runtime.evaluate", { expression: CDP_MOTION_JS, returnByValue: true }, 10000);
            inspect = (res && res.result && res.result.value) || null;
          } catch { inspect = null; }
          return { files, inspect };
        },
      });
      const study = out.inspect ? reduceCdpScan(target, out.inspect, now(), viewport) : null;
      // Retention: only prunes tool-created sibling dirs in tmp (never a
      // caller saveDir), and never the current run's directory.
      let retentionNote = null;
      if (!saveDir) {
        try {
          const removed = cdpPruneOldDirs(os.tmpdir(), { prefix: "aura-motion-", maxAgeMs: 24 * 60 * 60 * 1000, skip: dir });
          if (removed > 0) retentionNote = "pruned " + removed + " prior motion-study dir(s) older than 24h (this run's frames kept at " + dir + ")";
        } catch { /* best-effort */ }
      }
      return { url: target, viewport, startedAt, frames: out.files, frameCount: out.files.length, study, dir, ...(retentionNote ? { retentionNote } : {}) };
    },
    async encodeWebm(frameFiles, { ffmpegPath = null } = {}) {
      if (!Array.isArray(frameFiles) || !frameFiles.length) throw cdpBad("no frames to encode");
      const bin = ffmpegPath || findFfmpeg({});
      if (!bin) return { video: null, available: false, hint: "ffmpeg not found; install ffmpeg or set AURA_FFMPEG_PATH for .webm output" };
      // Only encode frames that actually exist on disk, bounded to the
      // recording cap; verify they share one directory before shelling out.
      const requested = frameFiles.slice(0, CDP_MAX_FRAMES).filter((f) => typeof f === "string" && f);
      const existing = requested.filter((f) => { try { return fs.existsSync(f); } catch { return false; } });
      if (!existing.length) return { video: null, available: false, hint: "frame files are gone (nothing on disk to encode); re-run mode:record to capture frames" };
      const dir = path.dirname(existing[0]);
      if (!existing.every((f) => path.dirname(f) === dir)) return { video: null, available: false, hint: "frame files span multiple directories; cannot encode as one sequence" };
      const first = /-(\d+)\.jpg$/i.exec(path.basename(existing[0]));
      const startNumber = first ? String(parseInt(first[1], 10)) : "0";
      const video = path.join(dir, "motion.webm");
      const args = ["-y", "-framerate", "2", "-start_number", startNumber, "-i", path.join(dir, "frame-%02d.jpg"), "-c:v", "libvpx", "-pix_fmt", "yuv420p", video];
      const res = cp.spawnSync(bin, args, { timeout: 60000, windowsHide: true });
      if (res && res.status === 0 && fs.existsSync(video)) return { video, available: true, bytes: fs.statSync(video).size, framesUsed: existing.length };
      return { video: null, available: false, hint: "ffmpeg encode failed (" + String(res && res.status) + "); frame JPEGs retained" };
    },
  };
}
function reduceCdpScan(url, scan, t, viewport) {
  const libs = Array.isArray(scan.libs) ? scan.libs : [];
  const render = Array.isArray(scan.render) ? scan.render : [];
  const st = scan.scrollTrigger || { count: 0, scrub: 0, pin: 0, sample: [] };
  const durations = ((scan.tweens && scan.tweens.durations) || []).filter((d) => typeof d === "number");
  const eases = ((scan.tweens && scan.tweens.eases) || []).concat(scan.cssBeziers || []).filter(Boolean);
  const agg = new Map();
  for (const raw of eases) {
    if (raw === "none" || raw === "linear") continue;
    const e = agg.get(raw) || { token: raw, uses: 0 };
    e.uses++;
    agg.set(raw, e);
  }
  const ms = durations.map((d) => d * 1000).sort((a, b) => a - b);
  const q = (p) => { if (!ms.length) return null; const i = p * (ms.length - 1); const lo = Math.floor(i), hi = Math.ceil(i); return Math.round(ms[lo] + (ms[hi] - ms[lo]) * (i - lo)); };
  return {
    url, viewport: viewport || "desktop",
    stack: { libs, render, scrollModel: libs.includes("lenis") ? "lenis" : libs.includes("locomotive") ? "locomotive" : libs.length ? "native" : "unknown" },
    scroll: { triggerCount: st.count || 0, scrubCount: st.scrub || 0, pinCount: st.pin || 0, scrubRatio: st.count ? (st.scrub || 0) / st.count : 0, sample: (st.sample || []).slice(0, 20) },
    easingVocab: [...agg.values()].sort((a, b) => b.uses - a.uses).slice(0, 15),
    durationVocab: ms.length ? { p25: q(0.25), median: q(0.5), p75: q(0.75) } : null,
    capturedAt: t, toolVersion: "aura/1.7.3", source: "live-browser",
  };
}

// ---- design-research.mjs ----
// Module: design-research — compact, deterministic design contracts and
// source-linked evidence cards. No network access or external corpus ingestion.
const drFields = [
  "audience", "product_purpose", "content_hierarchy", "visual_direction",
  "layout_composition", "typography", "colour_tokens", "components",
  "interaction", "motion_intent", "responsive_strategy", "accessibility",
  "anti_patterns",
];

const drProfiles = [
  {
    type: "developer portfolio", match: /\b(developer|engineer|personal site)\b/i,
    purpose: "Make the owner's work and engineering strengths easy to evaluate.",
    hierarchy: ["identity and role", "selected work with outcomes", "capabilities", "contact"],
    layout: "Use a restrained editorial grid: a concise identity block first, then a small number of project case studies with consistent metadata and generous separation.",
    visual: "Let project artifacts and their outcomes provide the visual character; keep interface chrome quiet and use one deliberate accent only if the owner supplies a brand direction.",
    components: ["identity header", "case-study cards", "project detail links", "contact action"],
    avoid: ["generic skill-meter grids", "invented client logos or project metrics"],
  },
  {
    type: "SaaS", match: /\b(saas|software|platform|product)\b/i,
    purpose: "Explain the product's intended job and help a suitable visitor take the next step.",
    hierarchy: ["problem and product purpose", "proof or product view", "key capabilities", "next step"],
    layout: "Build a clear top-to-bottom argument; give the product view enough space to explain one real workflow instead of stacking interchangeable feature cards.",
    visual: "Use a consistent product-led system and a single focal product view; defer brand-specific palette and type choices until supplied.",
    components: ["navigation", "product explanation", "workflow or product view", "evidence block", "primary action"],
    avoid: ["unsupported performance or customer claims", "feature grids without a user outcome"],
  },
  {
    type: "editorial", match: /\b(editorial|article|essay|publication|story|journal)\b/i,
    purpose: "Support focused reading and make the article's structure and source context legible.",
    hierarchy: ["title and byline", "summary or standfirst", "article sections", "sources and related reading"],
    layout: "Keep a readable central text measure, strong heading landmarks, and a separate narrow rail only when it aids navigation rather than competing with the article.",
    visual: "Treat typography, line length, and whitespace as the primary identity; use imagery only where it adds context.",
    components: ["article header", "table of contents when long", "body typography", "citation links"],
    avoid: ["interruptive overlays", "dense sidebars competing with the reading column"],
  },
  {
    type: "dashboard", match: /\b(dashboard|admin|analytics|reporting)\b/i,
    purpose: "Help a user understand current state and identify a useful next action.",
    hierarchy: ["scope and time context", "most decision-relevant measure", "supporting breakdown", "available actions"],
    layout: "Group data by the decisions it supports; show labels, units, and time context close to each value and preserve a stable navigation/content frame.",
    visual: "Prioritize scan order and legible data distinctions; use color as a redundant signal, not the only encoding.",
    components: ["navigation", "filter controls", "metric summaries", "data table or chart", "empty and loading states"],
    avoid: ["decorative charts without a question", "color-only status encoding", "fabricated metrics"],
  },
  {
    type: "ecommerce storefront", match: /\b(e-?commerce|storefront|shop|products|checkout)\b/i,
    purpose: "Help shoppers understand product fit and proceed through a transparent purchase path.",
    hierarchy: ["product or category context", "product details and price", "selection options", "purchase action", "delivery/returns details"],
    layout: "Keep product imagery and purchase information adjacent; expose selection, availability, and total-cost context before commitment.",
    visual: "Let real product photography and supplied brand assets lead; keep purchase controls visually distinct and consistent.",
    components: ["product listing", "product detail", "variant selection", "cart or purchase action", "delivery/returns details"],
    avoid: ["invented prices, reviews, stock, or policies", "hidden costs revealed only after commitment"],
  },
  {
    type: "creative studio", match: /\b(creative studio|design studio|agency|studio)\b/i,
    purpose: "Show the studio's work and point visitors toward a relevant conversation.",
    hierarchy: ["studio identity", "selected work", "services or approach when supplied", "contact"],
    layout: "Use a portfolio-led composition with varied project scale; keep captions and project context attached to the work.",
    visual: "Allow verified work samples to establish the character; do not assume a particular art direction, client roster, or medium.",
    components: ["studio identity", "project gallery", "project context", "contact action"],
    avoid: ["invented client names or awards", "uniform tiles that flatten different projects"],
  },
  {
    type: "accessible content-heavy page", match: /\b(accessible|content-heavy|guide|documentation)\b/i,
    purpose: "Make dense information navigable, understandable, and operable across input methods and viewport sizes.",
    hierarchy: ["page purpose and scope", "section navigation", "chunked content with descriptive headings", "related actions or references"],
    layout: "Use a readable main column with a clearly separated contents navigation; collapse the navigation into an in-page control on small screens without hiding the content.",
    visual: "Use typography, spacing, and heading structure to expose the information hierarchy; keep decoration subordinate to reading and navigation.",
    components: ["skip link", "landmark structure", "table of contents", "descriptive section headings", "back-to-top link when useful"],
    avoid: ["keyboard traps", "motion or colour as the only way to convey meaning", "collapsing required content behind unclear controls"],
  },
];

const drClean = (value, max = 8) => (Array.isArray(value)
  ? value.filter((v) => typeof v === "string" && v.trim()).slice(0, max).map((v) => v.trim().slice(0, 240))
  : undefined);
const drText = (value) => typeof value === "string" ? value.trim().slice(0, 600) : undefined;

function planDesign(input) {
  const brief = drText(input.brief);
  const profile = drProfiles.find((p) => p.match.test(brief))
    || drProfiles.find((p) => p.match.test(String(input.project_type || "")));
  const known = {
    brief,
    project_type: drText(input.project_type),
    audience: drText(input.audience),
    goals: drClean(input.goals, 5),
    brand_notes: drText(input.brand_notes),
    content_outline: drClean(input.content_outline, 8),
    references: drClean(input.references, 5),
    constraints: drClean(input.constraints, 8),
    preferred_stack: drText(input.preferred_stack),
  };
  for (const key of Object.keys(known)) if (known[key] === undefined || known[key] === "") delete known[key];
  if (!known.goals?.length) delete known.goals;
  if (!known.content_outline?.length) delete known.content_outline;
  const questions = [];
  if (!known.audience) questions.push({ field: "audience", question: "Who is the primary audience, and what do they already know?" });
  if (!known.brand_notes) questions.push({ field: "visual_identity", question: "Are there existing brand colours, typefaces, logos, or identity rules to preserve?" });
  if (!known.content_outline) questions.push({ field: "content_hierarchy", question: "Which content, proof, or actions are required for the first release?" });
  if (!known.constraints) questions.push({ field: "constraints", question: "Are there technical, legal, or operational constraints beyond those stated in the brief?" });

  const rec = {
    product_purpose: known.goals?.join("; ") || profile?.purpose || "Clarify the stated request's primary user task before choosing a page structure.",
    content_hierarchy: known.content_outline || profile?.hierarchy || null,
    visual_direction: known.brand_notes || profile?.visual || null,
    layout_composition: profile?.layout || null,
    typography: known.brand_notes ? "Use supplied type guidance; otherwise select and validate a readable type system during implementation." : null,
    colour_tokens: known.brand_notes ? "Derive tokens from supplied brand notes; preserve unknown values until confirmed." : null,
    components: profile?.components || [],
    interaction: ["Provide visible feedback for actions and explicit loading, empty, success, and error states where applicable."],
    motion_intent: "No signature motion is specified. Add motion only when it clarifies a state change or spatial relationship; provide a reduced-motion alternative.",
    responsive_strategy: "Recompose by content priority at narrow widths; keep all actions and information reachable without horizontal page scrolling.",
    accessibility: ["Semantic landmarks and heading order", "Keyboard-operable controls with visible focus", "Text alternatives for meaningful imagery", "Do not rely on colour alone", "Respect prefers-reduced-motion"],
    anti_patterns: profile?.avoid || ["generic template sections without a content purpose", "invented brand, audience, product, or performance claims"],
  };
  const basisFor = (field) => {
    if (field === "product_purpose" && known.goals) return "derived from user-stated goals; confirm prioritization";
    if (field === "content_hierarchy" && known.content_outline) return "ordered from the user-stated content outline; confirm priority";
    if (field === "visual_direction" && known.brand_notes) return "based on user-stated brand notes; confirm implementation";
    if ((field === "typography" || field === "colour_tokens") && known.brand_notes) return "implementation recommendation based on user-stated brand notes";
    return profile ? "page-type heuristic; confirm against user goals and actual content" : "general implementation heuristic; confirm before treating as a requirement";
  };
  const statusFor = (field, value) => {
    if ((field === "product_purpose" && known.goals)
      || (field === "content_hierarchy" && known.content_outline)
      || (field === "visual_direction" && known.brand_notes)) return "user_stated";
    return value === null || value === undefined || (Array.isArray(value) && !value.length) ? "unknown" : "recommended";
  };
  const contract = {
    contract_version: "1",
    user_stated: known,
    recommendations: Object.fromEntries(drFields.map((field) => [field, {
      status: statusFor(field, rec[field]),
      value: rec[field] ?? null,
      basis: basisFor(field),
    }])),
    open_questions: questions,
    retrieval_hints: {
      component_queries: (profile?.components || []).slice(0, 4),
      system_query: profile?.type || known.project_type || null,
      note: "Use hints to search first-party catalogue metadata; select a few candidates and inspect only chosen details.",
    },
  };
  return contract;
}

const drSources = [
  {
    id: "arxiv-2403.03163",
    title: "Design2Code: Benchmarking Multimodal Code Generation for Automated Front-End Engineering",
    authors: ["Chenglei Si", "Yanzhe Zhang", "Ryan Li", "Zhengyuan Yang", "Ruibo Liu", "Diyi Yang"],
    publication: "NAACL 2025; arXiv preprint",
    year: 2024, date: "2024-03-05", url: "https://arxiv.org/abs/2403.03163", doi: null,
    source_type: "preprint_and_conference_paper", metadata_provider: "arXiv",
    license_access: "abstract and paper openly accessible on arXiv; reuse license not asserted here; link to source, do not reproduce paper",
    freshness: "arXiv version 3 updated 2025-02-09 (metadata checked 2026-11-23)",
  },
  {
    id: "wcag22-reflow",
    title: "Understanding Success Criterion 1.4.10: Reflow",
    authors: ["World Wide Web Consortium (W3C)"],
    publication: "WCAG 2.2 Understanding document",
    year: 2023, date: "2023-10-05", url: "https://www.w3.org/WAI/WCAG22/Understanding/reflow.html", doi: null,
    source_type: "standard_guidance", metadata_provider: "W3C",
    license_access: "public access; reuse license not asserted here; link to source; no source text reproduced",
    freshness: "W3C page updated 2026-10-04; checked 2026-11-23",
  },
  {
    id: "wcag22-animation",
    title: "Understanding Success Criterion 2.3.3: Animation from Interactions",
    authors: ["World Wide Web Consortium (W3C)"],
    publication: "WCAG 2.2 Understanding document",
    year: 2023, date: "2023-10-05", url: "https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html", doi: null,
    source_type: "standard_guidance", metadata_provider: "W3C",
    license_access: "public access; reuse license not asserted here; link to source; no source text reproduced",
    freshness: "W3C page updated 2025-09-16; checked 2026-11-23",
  },
  {
    id: "doi-10.1016-j.ijhcs.2024.103257",
    title: "User perception of animation fluency: The effect of time duration in different phases of animated transitions during application usage",
    authors: ["Yan Ge", "Hongyu Chen", "Yuchen Wang", "Weina Qu", "Yubo Zhang", "Yanfang Liu"],
    publication: "International Journal of Human-Computer Studies, volume 186, article 103257",
    year: 2024, date: "2024-06", url: "https://doi.org/10.1016/j.ijhcs.2024.103257", doi: "10.1016/j.ijhcs.2024.103257",
    source_type: "journal_article", metadata_provider: "OpenAlex and Crossref",
    license_access: "closed access per OpenAlex metadata; metadata only; link to publisher; no abstract or full text copied",
    freshness: "OpenAlex and Crossref metadata checked 2026-11-23",
  },
];

const drClaims = [
  {
    id: "design2code-layout-errors",
    source_id: "arxiv-2403.03163",
    evidence_type: "empirical_benchmark_abstract",
    method: "Benchmark evaluation of screenshot-conditioned multimodal code generation, with automatic metrics and human evaluation as described in the abstract.",
    population_sample: "484 manually curated real-world webpages; benchmark tasks and evaluated models are specific to the paper.",
    date: "2024-03-05",
    section: "Abstract",
    finding: "The authors report that evaluated models often omit visual elements and produce incorrect layouts in this benchmark.",
    limitations: ["Abstract-level summary only; benchmark performance is not a measure of general design quality.", "Task, dataset, models, and evaluation setup bound the result."],
    confidence_basis: "Medium: claim is explicit in the arXiv abstract; full paper has not been reviewed for this corpus card.",
    practical_implications: ["Compare implementation against the actual brief and reference at the element and layout level; do not assume generated code preserves all visual content."],
  },
  {
    id: "wcag-reflow-guidance",
    source_id: "wcag22-reflow",
    evidence_type: "standard_guidance",
    method: "Normative WCAG success criterion with explanatory Understanding guidance.",
    population_sample: null, date: "2023-10-05", section: "Success Criterion 1.4.10",
    finding: "Content should reflow at the criterion's specified equivalent narrow viewport conditions without requiring scrolling in two dimensions for ordinary content.",
    limitations: ["Apply the complete criterion and its exceptions from the linked WCAG source; this short card is not a conformance assessment."],
    confidence_basis: "High for what the W3C guidance states; not an empirical usability claim.",
    practical_implications: ["Test narrow layouts for readable reflow and reachable content; assess wide data tables and other exceptions against the full criterion."],
  },
  {
    id: "wcag-animation-guidance",
    source_id: "wcag22-animation",
    evidence_type: "standard_guidance",
    method: "WCAG success criterion with explanatory Understanding guidance.",
    population_sample: null, date: "2023-10-05", section: "Success Criterion 2.3.3",
    finding: "Non-essential animation triggered by interaction can be disabled, subject to the criterion's scope and exceptions.",
    limitations: ["This is Level AAA guidance; consult the linked criterion and exceptions. It is not a universal claim that all animation must be removed."],
    confidence_basis: "High for the standard's stated requirement and level; not an empirical claim.",
    practical_implications: ["Offer an appropriate reduced-motion experience for non-essential interaction-triggered movement and verify it with the platform preference."],
  },
];

function researchSources() { return drSources.map((source) => ({ ...source, authors: [...source.authors] })); }
function researchClaims() { return drClaims.map((claim) => ({ ...claim, limitations: [...claim.limitations], practical_implications: [...claim.practical_implications] })); }

function searchResearch(query, limit = 3, corpus = { sources: drSources, claims: drClaims }) {
  const terms = String(query || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  if (!terms.length) return { query: String(query || ""), total: 0, items: [], note: "Provide a topic or question to search the curated evidence cards." };
  const sources = new Map((corpus.sources || []).map((source) => [source.id, source]));
  const ranked = (corpus.claims || []).map((claim) => {
    const source = sources.get(claim.source_id);
    if (!source) return null;
    const haystack = [claim.finding, claim.evidence_type, claim.method, claim.section, ...claim.practical_implications, source.title, source.publication].join(" ").toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return { claim, source, score };
  }).filter((row) => row && row.score > 0).sort((a, b) => b.score - a.score || a.claim.id.localeCompare(b.claim.id));
  return {
    query: String(query || "").slice(0, 300), total: ranked.length,
    items: ranked.slice(0, limit).map(({ claim, source }) => ({
      id: claim.id, evidence_type: claim.evidence_type, finding: claim.finding,
      implication: claim.practical_implications[0], limitations: claim.limitations,
      source: { id: source.id, title: source.title, url: source.url, doi: source.doi, year: source.year },
      detail_ref: { tool: "aura_research_read", id: claim.id },
    })),
    corpus: { source_count: sources.size, claim_count: (corpus.claims || []).length, updated: "2026-11-23" },
    ...(corpus.claims?.length ? {} : { empty_corpus: true, note: "No reviewed evidence cards are available; use the Design Contract and do not infer research findings." }),
  };
}

function readResearch(id) {
  const claim = drClaims.find((entry) => entry.id === id);
  if (!claim) return null;
  const source = drSources.find((entry) => entry.id === claim.source_id);
  if (!source) return null;
  return { ...claim, source: { ...source, authors: [...source.authors] }, interpretation: { kind: "research_implication", text: claim.practical_implications[0] } };
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
function skillFrontmatter(content) {
  const text = String(content || "");
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { valid: null, missing: [], frontmatter: "unknown" };
  const frontmatter = match ? match[1] : "";
  const lines = frontmatter.split(/\r?\n/);
  const has = (key) => {
    const index = lines.findIndex((line) => new RegExp("^" + key + "\\s*:").test(line));
    if (index < 0) return false;
    let value = lines[index].slice(lines[index].indexOf(":") + 1).trim();
    if (!value || value.startsWith("#")) return false;
    if (/^[|>][+-]?$/.test(value)) {
      return lines.slice(index + 1).some((line) => /^\s+\S/.test(line) && !/^\s+#/.test(line));
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).trim();
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    return value.length > 0;
  };
  const missing = ["name", "description"].filter((key) => !has(key));
  return { valid: missing.length === 0, missing, frontmatter: "present" };
}
function diffFacts(item) {
  const facets = item.facets || {};
  const code = typeof item.code === "string" ? item.code : "";
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const structureTags = tags.filter((t) => /hero|nav|header|footer|pricing|feature|testimonial|form|card/i.test(String(t)));
  const dependencies = [];
  if (facets.needsTailwind === true) dependencies.push("tailwindcss");
  if (facets.needsIcons === true) dependencies.push("iconify-icon");
  const sourceComplete = typeof item.code === "string" && item.code_info?.truncated === false;
  const markupStructure = sourceComplete ? [...code.matchAll(/<(header|nav|main|section|footer|form)\b/gi)].map((m) => m[1].toLowerCase()).filter((v, i, a) => a.indexOf(v) === i) : [];
  const structure = structureTags.length ? structureTags : (markupStructure.length ? markupStructure : "unknown");
  return {
    id: item.id ?? null, slug: item.slug ?? null, title: item.title ?? null, category: item.category ?? tags[0] ?? "unknown",
    theme: facets.theme ?? "unknown", dependencies: typeof facets.needsTailwind === "boolean" || typeof facets.needsIcons === "boolean" ? dependencies : "unknown", fonts: Array.isArray(facets.fonts) && facets.fonts.length ? facets.fonts : "unknown",
    structure: structure.length ? structure : "unknown",
    structure_source: structureTags.length ? "catalogue_tags" : (markupStructure.length ? "complete_component_markup" : "unknown"),
    source_quality: item.code_chars ? { source: "Aura catalogue", code_chars: item.code_chars } : "unknown",
    compatibility: "unknown", page_url: item.page_url ?? null,
  };
}
const TOOL_DEFS = [
  { name: 'aura_plan_design', description: 'Turn a brief into a compact Design Contract. Separates supplied facts, recommendations, and open questions; no catalogue rows or code. Then search a few indicated first-party candidates.', inputSchema: { type: 'object', properties: { brief: { type: 'string', minLength: 1, maxLength: 600 }, project_type: { type: 'string', maxLength: 120 }, audience: { type: 'string', maxLength: 300 }, goals: { type: 'array', items: { type: 'string', maxLength: 240 }, maxItems: 5 }, brand_notes: { type: 'string', maxLength: 600 }, content_outline: { type: 'array', items: { type: 'string', maxLength: 240 }, maxItems: 8 }, references: { type: 'array', items: { type: 'string', maxLength: 240 }, maxItems: 5 }, constraints: { type: 'array', items: { type: 'string', maxLength: 240 }, maxItems: 8 }, preferred_stack: { type: 'string', maxLength: 120 } }, required: ['brief'], additionalProperties: false } },
  { name: 'aura_research_search', description: 'Search curated, compact research evidence cards. Returns at most five findings with source links, limitations, and a detail reference; never returns papers or PDFs.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 300 }, limit: { type: 'number', minimum: 1, maximum: 5 } }, required: ['query'], additionalProperties: false } },
  { name: 'aura_research_read', description: 'Read one selected research evidence card and its source metadata. Returns a compact claim, provenance, limitations, and implication; not source full text.', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_status', description: 'Catalogue health plus counts (components_free/pro, assets (all) + assets_free/pro, skills, design systems) with a counts_note. Free only, no login. Start here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_search_components', description: 'Find free components by brief, category and theme. Results are metadata-first; even slim:false caps source at 1,200 chars/item. Continue with offset; fetch source via aura_get_component.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: TOOL_CATS }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_component', description: 'Inspect a free component. Metadata is default; pass chunk for one bounded source chunk or full:true for the first chunk. Numeric id or slug.', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' }, chunk: { type: 'number' }, full: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_skills', description: 'Search free Aura agent skills (192). Metadata only, slim by default; use aura_get_skill for the full SKILL.md content. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_skill', description: 'Inspect a free skill; metadata and frontmatter validation by default. Pass chunk for one body chunk or full:true for the first chunk.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, chunk: { type: 'number' }, full: { type: 'boolean' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_search_assets', description: 'Search free Aura assets (images and video). Keywords, media_type image or video. Slim rows by default. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, mediaType: { type: 'string', enum: ['image', 'video'] }, commercial_ok: { type: 'boolean' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_design_systems', description: 'Search free Aura DESIGN.md systems (725). Metadata + snippets, slim by default; use aura_get_design_system for content. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: TOOL_SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_design_system', description: 'Inspect a free design system; metadata and token hints by default. Pass chunk for bounded content/preview or full:true for the first bounded chunks.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' }, chunk: { type: 'number' }, full: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_all', description: 'One call across components, skills, assets, and design systems in parallel. Free only. Slim rows by default (excerpts, no blobs). Each surface runs its own fallback pipeline, so mixed outcomes are normal (skills may fall back while components go honestly empty) — read isFallback/no_match per surface, not once globally.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' }, slim: { type: 'boolean' }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_recommend', description: 'Starter kit for a goal: top 3 free hits per surface with page URLs and rationale. Slim rows + commercial-use note. Empty components auto-retry once via suggested_queries, then editorial picks.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, slim: { type: 'boolean' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_install_component', description: 'Paste-ready setup for a free component: dependency list, setup steps, file map, fonts. Goes beyond the official Aura MCP, which only reads project source.', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_install_skill', description: 'Save-and-load plan for a free skill: where to put SKILL.md per client plus upstream source.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_use_design_system', description: 'Apply a free DESIGN.md system: token starter CSS plus copy order (tokens first, then markup).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_bundle', description: 'Fetch 2–8 component records in one call. Returns metadata by default; full:true includes bounded first source chunks. Per-item errors are isolated.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: {} }, slugs: { type: 'array', items: { type: 'string' } }, full: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_scaffold_page', description: 'Plan a page from a brief and optional component refs. Returns tokens, dependencies, order and detail pointers; full:true includes bounded first chunks and reports truncated token source.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, system: { type: 'string' }, components: { type: 'array', items: {} }, full: { type: 'boolean' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_related', description: 'More-like-this: 3 related items for a component/skill/design-system by tag + text overlap. Discovery never dead-ends.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'skills', 'design_systems'] }, id: {} }, required: ['kind', 'id'], additionalProperties: false } },
  { name: 'aura_bulk_fetch', description: 'Bulk-fetch 2-8 details in one call for components, design_systems, or assets. Alias-friendly name for aura_bundle. Per-item errors never fail the batch.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'design_systems', 'assets'] }, ids: { type: 'array', items: {} } }, required: ['kind', 'ids'], additionalProperties: false } },
  { name: 'aura_install_asset', description: 'Legal drop-in plan for an asset: direct download URL, preview URL, license (all-rights-reserved per Aura Terms §4 — check page before commercial use), suggested file path.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_categories', description: 'The 13 component categories with live free counts. Pick one, then search within it.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_prompt', description: 'Compatibility wrapper for a two-pass design brief. Ask the user to choose theme, sections, system, assets and mood; the second pass suggests Aura tools only. Answers stay customisable.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, surfaces: { type: 'array', items: { type: 'string' } }, system: { type: 'string' }, answers: { type: 'object' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_diff', description: 'Compare 2–4 free components by known metadata: theme, dependencies, fonts, structure and source length. Unknown facts stay unknown; no visual/performance claims.', inputSchema: { type: 'object', properties: { components: { type: 'array', minItems: 2, maxItems: 4, items: {} }, goal: { type: 'string' } }, required: ['components'], additionalProperties: false } },
  { name: 'aura_docs_plan', description: 'Plan a fresh-docs lookup (pure, no fetch). library + need -> Context7 resolve/query plan (trusted: tailwind, gsap, lenis, iconify) + apply steps for Aura files + docs stamp slot. The agent calls Context7, Aura shapes the rest.', inputSchema: { type: 'object', properties: { library: { type: 'string' }, need: { type: 'string' } }, required: ['library', 'need'], additionalProperties: false } },
  { name: 'aura_docs_check', description: 'Check pasted code against fresh docs (pure). library + code_excerpt (under 20000 chars, excerpts not full pages) + optional docs_note -> verdict current|needs-update, look-preserving fixes, version-pin needs_check. Fresh API wins, look stays identical.', inputSchema: { type: 'object', properties: { library: { type: 'string' }, code_excerpt: { type: 'string' }, docs_note: { type: 'string' } }, required: ['library', 'code_excerpt'], additionalProperties: false } },
  { name: 'aura_icon', description: 'Fetch one free icon as ready-to-paste SVG (live). name in kebab-case (bolt, arrow-down). source auto|fontawesome|pixel, style auto|solid|regular|brands. Auto-fallback across styles then libraries; every hit carries license + credit (CC BY 4.0, credit always) plus a font/CSS alternative. 24h icon cache.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, source: { type: 'string', enum: ['auto', 'fontawesome', 'pixel'] }, style: { type: 'string', enum: ['solid', 'regular', 'brands', 'auto'] } }, required: ['name'], additionalProperties: false } },
  { name: 'aura_version', description: 'Running vs npm-published version (live, hourly cache). Returns update_available + notice telling the agent to prefer latest (npm i -g aura-components-mcp@latest) when behind. Never fails — offline registries return latest:null. aura_status already carries this verdict on every call.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_award_search', description: 'Search award-winning website references (Awwwards). Modes: sites (ranked refs with preview links), categories (real taxonomy from the index/source), elements (hero/nav/pricing/footer examples), motion (previously recorded motion studies). Local index first, one polite live refresh when empty.', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['sites', 'categories', 'elements', 'motion'] }, query: { type: 'string' }, slug: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, category: { type: 'string' }, color: { type: 'string' }, technology: { type: 'string' }, award: { type: 'string', enum: ['sotd', 'developer', 'honorable'] }, studio: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' }, full: { type: 'boolean' }, library: { type: 'string' }, easing: { type: 'string' }, scrollModel: { type: 'string' } }, required: ['mode'], additionalProperties: false } },
  { name: 'aura_award_inspect', description: 'Inspect award refs: site_details (palette/tech/awards/evidence), site_elements (section visuals with media URLs), element (one gallery record), compare_sites (2-3 refs: shared vs gaps, missing marked unknown).', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['site_details', 'site_elements', 'element', 'compare_sites'] }, slug: { type: 'string' }, elementSlug: { type: 'string' }, slugs: { type: 'array', items: { type: 'string' } } }, required: ['mode'], additionalProperties: false } },
  { name: 'aura_design_blueprint', description: 'Evidence-backed build plan from 2-5 award refs + goal: Markdown brief + versioned JSON, mapped to real free Aura components/systems (free-only enforced, failures marked unavailable). Never copies third-party source.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, references: { type: 'array', items: { type: 'string' } }, technology: { type: 'string' }, visualDirection: { type: 'string' }, responsive: { type: 'string' }, constraints: { type: 'array', items: { type: 'string' } }, includeStructure: { type: 'boolean' } }, required: ['goal', 'references'], additionalProperties: false } },
  { name: 'aura_visual_audit', description: 'Capture/analyze a reference or your build. Modes: capture (real browser screenshot), structure (section band map: live-dom or static-html), compare (reference vs build mismatches). Needs Chrome for live capture; honest BROWSER_UNAVAILABLE otherwise. Loopback only with allowLocal:true.', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['capture', 'structure', 'compare'] }, url: { type: 'string' }, referenceUrl: { type: 'string' }, buildUrl: { type: 'string' }, viewport: { type: 'string', enum: ['desktop', 'mobile'] }, waitStrategy: { type: 'string', enum: ['load', 'networkidle'] }, settleMs: { type: 'number' }, allowLocal: { type: 'boolean' } }, required: ['mode'], additionalProperties: false } },
  { name: 'aura_motion_study', description: 'Evidence-backed motion guidance. Modes: inspect (live runtime scan: libs/easing/scroll), record (bounded frame study; .webm only when ffmpeg present), search (stored studies by library/easing/scroll). Never claims unobserved library state.', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['inspect', 'record', 'search'] }, url: { type: 'string' }, library: { type: 'string' }, easing: { type: 'string' }, scrollModel: { type: 'string' }, frames: { type: 'number' }, durationMs: { type: 'number' }, viewport: { type: 'string', enum: ['desktop', 'mobile'] }, allowLocal: { type: 'boolean' } }, required: ['mode'], additionalProperties: false } },
  { name: 'aura_award_index', description: 'Local award corpus: status (counts/freshness/lock), rebuild/resume/refresh (bounded polite crawl), new_winners (baseline then delta), watch_add/list/remove (studio/tag/url watches). Never auto-crawls on startup.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'rebuild', 'resume', 'refresh', 'new_winners', 'watch_add', 'watch_list', 'watch_remove'] }, award: { type: 'string', enum: ['sotd', 'developer', 'honorable'] }, maxPages: { type: 'number' }, kind: { type: 'string', enum: ['studio', 'tag', 'url'] }, pattern: { type: 'string' } }, required: ['action'], additionalProperties: false } },
];
function createHandlers(catalog, icons, version, awardDeps) {
  // Automatic update notice: every aura_status carries the cached version
  // verdict (hourly npm re-check), so agents learn about updates unprompted.
  const versionNote = async () => {
    try {
      if (version && typeof version.getVersion === "function") return await version.getVersion();
    } catch { /* status must never fail on version check */ }
    return null;
  };
  // Award subsystem deps (optional for old callers): client (live fetch),
  // index (persistent JSON store), browser (native CDP). Missing pieces stay
  // honest: local-empty results + unavailable notes, never invented data.
  const awardClient = (awardDeps && awardDeps.awardClient) || null;
  const awardBrowser = (awardDeps && awardDeps.browser) || null;
  const awardIndex = (awardDeps && awardDeps.awardIndex) || awardFallbackIndex();
  function awardFallbackIndex() {
    const sites = new Map(); const elements = new Map(); const motions = [];
    let tax = { colors: [], filters: [] }; let watches = [];
    return {
      root: "(memory)", files: [],
      getStatus: () => ({ dir: "(memory)", version: 1, counts: { sites: sites.size, elements: elements.size, motion: motions.length, taxonomyFilters: tax.filters.length, taxonomyColors: tax.colors.length, watches: watches.length }, freshness: null, stale: true, progress: null, pendingPages: [], lock: { held: false } }),
      listSites: (n) => [...sites.values()].slice(0, n || 50),
      getSite: (slug) => { try { return sites.get(String(slug).toLowerCase()) || null; } catch { return null; } },
      upsertSites: (rows) => { let added = 0; for (const s of (rows || [])) { if (s && s.slug && !sites.has(String(s.slug).toLowerCase())) added++; if (s && s.slug) sites.set(String(s.slug).toLowerCase(), s); } return { added, updated: 0, total: sites.size }; },
      getTaxonomy: () => ({ version: 1, colors: tax.colors, filters: tax.filters }),
      setTaxonomy: (t) => { tax = { colors: (t.colors || []).slice(0, 100), filters: (t.filters || []).slice(0, 400) }; return { colors: tax.colors.length, filters: tax.filters.length }; },
      upsertElements: (rows) => { let added = 0; for (const e of (rows || [])) { if (e && e.slug && !elements.has(String(e.slug))) added++; if (e && e.slug) elements.set(String(e.slug), e); } return { added, total: elements.size }; },
      listElements: (n) => [...elements.values()].slice(0, n || 50),
      getElement: (slug) => elements.get(String(slug)) || null,
      recordMotion: (s) => { const i = motions.findIndex((m) => m.url === s.url); if (i >= 0) motions.splice(i, 1); motions.unshift(s); return s; },
      searchMotion: (f) => {
        let items = [...motions];
        if (f.library) items = items.filter((m) => JSON.stringify(m).toLowerCase().includes(String(f.library).toLowerCase()));
        if (f.easing) items = items.filter((m) => JSON.stringify(m.easingVocab || []).toLowerCase().includes(String(f.easing).toLowerCase()));
        if (f.scrollModel) items = items.filter((m) => String((m.stack && m.stack.scrollModel) || "").toLowerCase() === String(f.scrollModel).toLowerCase());
        return { total: items.length, items: items.slice(0, 10), empty: motions.length === 0 };
      },
      newWinners: async () => { throw awardErr("UNSUPPORTED_OPERATION", "new_winners needs a persistent index + award client; wire the server default"); },
      rebuild: async () => { throw awardErr("UNSUPPORTED_OPERATION", "rebuild needs a persistent index + award client"); },
      resume: async () => { throw awardErr("UNSUPPORTED_OPERATION", "resume needs a persistent index + award client"); },
      refresh: async () => { throw awardErr("UNSUPPORTED_OPERATION", "refresh needs a persistent index + award client"); },
      watchAdd: (w) => { if (watches.some((x) => x.kind === w.kind && x.pattern === w.pattern)) throw awardErr("BAD_ARGS", "duplicate watch"); if (watches.length >= 50) throw awardErr("BAD_ARGS", "too many watches"); const r = { ...w, createdAt: new Date().toISOString(), lastCheckedAt: null, lastSlugs: null }; watches.push(r); return r; },
      watchList: () => watches,
      watchRemove: ({ kind, pattern }) => { const b = watches.length; watches = watches.filter((w) => !(w.kind === kind && w.pattern === String(pattern).toLowerCase())); return { removed: watches.length < b }; },
      checkWatches: () => [],
    };
  }
  function awardMode(v, allowed, name) { if (v === undefined) toolFn_bad(name + ' is required'); if (!allowed.includes(v)) toolFn_bad(name + ' must be one of ' + allowed.join('|')); return v; }
  function awardLimit(v, def, max) { if (v === undefined) return def; if (typeof v !== 'number' || !Number.isFinite(v)) toolFn_bad('limit must be a number'); return Math.max(1, Math.min(Math.floor(v), max)); }
  function awardStrArr(v, name, max) { if (v === undefined) return undefined; if (!Array.isArray(v)) toolFn_bad(name + ' must be an array of strings'); if (v.length > max) toolFn_bad(name + ' holds max ' + max + ' entries'); for (const e of v) if (typeof e !== 'string' || !e.trim()) toolFn_bad(name + ' must hold non-empty strings'); return v.map((e) => e.trim()); }
  async function awardDetailFor(slug, { withStatic = false } = {}) {
    const norm = awardNormalizeSlug(slug);
    const cached = awardIndex.getSite(norm);
    if (!awardClient) return { slug: norm, summary: cached, detail: null, detailStatus: cached ? 'cached' : 'unavailable', liveError: 'award client not wired' };
    try {
      const { html } = await awardClient.getAwardHtml('/sites/' + norm);
      const detail = awardParseDetail(html, norm);
      const cachedTags = (cached && cached.tags) || [];
      // Tags vs Technologies consistency (#5): listing tags (WebGL, 3D, …)
      // exist even when the page has no Technologies section. Backfill from
      // tags and LABEL it inferred — never present it as parsed section data.
      if ((!detail.technologies || !detail.technologies.length) && cachedTags.length) {
        detail.technologies = [...new Set(cachedTags.map((t) => String(t)))].slice(0, 12);
        detail.technologiesInferred = true;
        detail.technologyEvidence = "inferred from listing tags; page has no Technologies section";
      }
      const summary = { slug: norm, title: detail.title || (cached && cached.title) || norm, createdAt: (cached && cached.createdAt) || 0, tags: (cached && cached.tags) || [], thumbnailPath: (cached && cached.thumbnailPath) || "", liveUrl: detail.liveUrl || (cached && cached.liveUrl) || null, detailPath: "/sites/" + norm, awards: (detail.awards || []).map((a) => a.title), studio: (cached && cached.studio) || null, source: "awwwards", sourceUrl: detail.sourceUrl };
      try { awardIndex.upsertSites([summary]); } catch { /* memory fallback never fails */ }
      try {
        const media = awardParseElementsSection(html);
        if (media && media.length) awardIndex.upsertElements(media.map((m) => ({ slug: 'site-' + norm + '-' + String(m.title || 'element').toLowerCase().replace(/\W+/g, '-').slice(0, 60), title: m.title || 'Element', author: summary.studio || summary.title, builtWith: [], related: [], mediaPath: m.mediaPath, mediaType: String(m.mediaPath).endsWith('.mp4') ? 'video' : 'image', mediaUrl: awardElementUrl(m.mediaPath), category: 'uncategorized', siteSlug: norm, source: 'site', sourceUrl: summary.sourceUrl })));
      } catch { /* backfill best-effort */ }
      // Static motion cues (opt-in per caller: one extra bounded fetch).
      // Recorded studies stay authoritative; static markup is supplementary.
      let motionStatic = null;
      if (withStatic && summary.liveUrl) {
        try { motionStatic = await awardStaticMotion(summary.liveUrl); } catch { motionStatic = { status: "unavailable", url: summary.liveUrl, reason: "static scan failed" }; }
      }
      return { slug: norm, summary, detail, detailStatus: 'fetched', liveError: null, ...(motionStatic ? { motion_static: motionStatic } : {}) };
    } catch (e) {
      if (e && e.code === 'NOT_FOUND') throw e;
      return { slug: norm, summary: cached, detail: null, detailStatus: cached ? 'cached' : 'unavailable', liveError: String((e && e.message) || e).slice(0, 220) };
    }
  }
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
      if (full !== undefined) toolFn_bool(full, 'full');
      const got = await catalog.getItem('components', id, full === true ? { full: true } : { chunk: a.chunk === undefined ? 0 : toolFn_num(a.chunk, 'chunk') });
      const item = { ...got.item };
      if (full !== true && a.chunk === undefined) delete item.code;
      return textResult({ summary: "Component detail", ...got, item, metadata_only: full !== true && a.chunk === undefined, retrieval: full ? "source returned up to the configured code chunk cap; use chunk to continue if code_info.truncated" : "use chunk for source or full:true for the first bounded source chunk" }); },
    aura_search_skills: async (a) => { a = a || {}; const r = await catalog.searchCatalog('skills', {
      query: toolFn_str(a.query, 'query'), sort: toolFn_sort(a.sort), limit: toolFn_num(a.limit, 'limit'), offset: toolFn_num(a.offset, 'offset'),
      slim: a.slim === undefined ? undefined : toolFn_bool(a.slim, 'slim'),
      exact_match: a.exact_match === undefined ? undefined : toolFn_bool(a.exact_match, 'exact_match'),
    });
      r.items = (r.items || []).map((it) => {
        const validation = skillFrontmatter(it.content_snippet || it.content_excerpt || "");
        return { ...it, loadable: validation.valid, skill_validation: validation };
      });
      return textResult(r); },
    aura_get_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) toolFn_bad('id (string) is required');
      if (a.full !== undefined) toolFn_bool(a.full, 'full');
      const got = await catalog.getItem('skills', a.id, a.full === true ? { full: true } : { chunk: a.chunk === undefined ? 0 : toolFn_num(a.chunk, 'chunk') });
      const item = { ...got.item, skill_validation: skillFrontmatter(got.item.content || "") };
      if (a.full !== true && a.chunk === undefined) { item.content_excerpt = String(item.content || "").slice(0, 300); delete item.content; }
      return textResult({ summary: "Skill detail", ...got, item, metadata_only: a.full !== true && a.chunk === undefined, retrieval: a.full ? "content returned up to the configured content chunk cap; use chunk to continue if content_info.truncated" : "use chunk for content or full:true for the first bounded content chunk" }); },
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
      if (a.full !== undefined) toolFn_bool(a.full, 'full');
      const got = await catalog.getItem('design_systems', id, a.full === true ? { full: true } : { chunk: a.chunk === undefined ? 0 : toolFn_num(a.chunk, 'chunk') });
      const item = { ...got.item };
      if (a.full !== true && a.chunk === undefined) { delete item.content; delete item.preview_html; }
      return textResult({ summary: "Design system detail", ...got, item, metadata_only: a.full !== true && a.chunk === undefined, retrieval: a.full ? "bodies returned up to configured per-field chunk caps; use chunk to continue where *_info.truncated" : "use chunk for content/preview or full:true for the first bounded chunks" }); },
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
    aura_plan_design: async (a) => { a = a || {};
      const brief = toolFn_str(a.brief, 'brief');
      if (!brief || !brief.trim() || brief.length > 600) toolFn_bad('brief must contain 1-600 characters');
      for (const key of ['project_type', 'audience', 'brand_notes', 'preferred_stack']) {
        if (a[key] !== undefined && (typeof a[key] !== 'string' || a[key].length > (key === 'brand_notes' ? 600 : key === 'audience' ? 300 : key === 'project_type' || key === 'preferred_stack' ? 120 : 600))) toolFn_bad(key + ' must be a bounded string');
      }
      for (const [key, cap] of [['goals', 5], ['content_outline', 8], ['references', 5], ['constraints', 8]]) {
        if (a[key] !== undefined && (!Array.isArray(a[key]) || a[key].length > cap || a[key].some((v) => typeof v !== 'string' || v.length > 240))) toolFn_bad(key + ' must be an array of at most ' + cap + ' strings (240 characters each)');
      }
      return textResult(planDesign(a)); },
    aura_research_search: async (a) => { a = a || {};
      const query = toolFn_str(a.query, 'query');
      if (!query || !query.trim() || query.length > 300) toolFn_bad('query must contain 1-300 characters');
      const limit = a.limit === undefined ? 3 : toolFn_num(a.limit, 'limit');
      if (!Number.isInteger(limit) || limit < 1 || limit > 5) toolFn_bad('limit must be an integer from 1 to 5');
      return textResult(searchResearch(query, limit)); },
    aura_research_read: async (a) => { a = a || {};
      const id = toolFn_str(a.id, 'id');
      if (!id || id.length > 100) toolFn_bad('id must contain 1-100 characters');
      const card = readResearch(id);
      if (!card) { const e = new Error('research claim not found: ' + id); e.code = 'NOT_FOUND'; throw e; }
      return textResult(card); },
    aura_diff: async (a) => { a = a || {};
      const refs = normRefs(a.components, 'components');
      if (!refs || refs.length < 2 || refs.length > 4) toolFn_bad('components must contain 2-4 id/slug references');
      const results = await catalog.bundleItems('components', refs, 4);
      return textResult({ summary: "Known-fact comparison of " + results.filter((r) => r.ok).length + " free components", goal: toolFn_str(a.goal, 'goal') || null, items: results.map((r) => r.ok ? { ok: true, ...diffFacts(r.item) } : r), limitations: { bundle_size: "unknown", runtime_performance: "unknown", visual_quality: "unknown", compatibility: "unknown unless present in source metadata" } }); },
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
      const full = a.full === undefined ? false : toolFn_bool(a.full, 'full');
      const results = await catalog.bundleItems('components', ids, 8, { full });
      const sourceTruncated = full && results.some((r) => r.ok && r.item?.code_info?.truncated === true);
      return textResult({ summary: results.length + " component record(s)", kind: 'components', results, truncated: sourceTruncated, next_cursor: null, retrieval: full ? "source included up to per-component chunk caps; when truncated is true, inspect code_info and call aura_get_component with chunk to continue" : "metadata only; call aura_get_component with chunk or full:true for source" }); },
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
      const full = a.full === undefined ? false : toolFn_bool(a.full, 'full');
      const fullOpt = { full };
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
      const compactSystem = sysItem ? { ...sysItem } : null;
      const compactComponents = freeComps.map((c) => ({ ...c }));
      if (!full) {
        if (compactSystem) { delete compactSystem.content; delete compactSystem.preview_html; }
        for (const c of compactComponents) delete c.code;
      }
      return textResult({ summary: "Page build plan for " + freeComps.length + " free component(s)", goal: a.goal, order: ['1 tokens.css', '2 system preview_html', '3 component markup in listed order'], tokens_css: toks.css || '', tokens_source_truncated: !!(full && sysItem?.content_info?.truncated), system: compactSystem, ...(sysItem ? {} : { system_note: 'no design system matched this goal — tokens.css is empty; fetch one via aura_search_design_systems or proceed with component defaults' }), components: compactComponents, guides, combined_deps: deps, files, docs_stamp: docsStampFor(deps), metadata_only: !full, retrieval: full ? "source included up to per-item chunk caps; check *_info.truncated and use detail chunk retrieval to continue" : "fetch referenced item with aura_get_component/aura_get_design_system for source", ...(bundle.dropped ? { dropped_refs: bundle.dropped, dropped_note: 'Some requested refs resolved to missing or Pro (paid) components and were omitted — see per-id errors via aura_bundle.' } : {}), ...(proFiltered ? { pro_filtered_out: proFiltered, pro_note: 'Pro (paid) components were refused — free-only scaffold ships free rows.' } : {}), license_note: 'Markup and any pulled assets are all-rights-reserved per Aura Terms §4 — fine to prototype, check each page_url before commercial ship.' }); },
    aura_award_search: async (a) => { a = a || {}; const mode = awardMode(a.mode, ['sites', 'categories', 'elements', 'motion'], 'mode');
      const limit = awardLimit(a.limit, 5, 25); const offset = Math.max(0, a.offset ?? 0); const full = a.full === undefined ? false : toolFn_bool(a.full, 'full');
      if (mode === 'categories') {
        let tax = awardIndex.getTaxonomy();
        let source = 'local-index';
        if ((!tax.filters.length && !tax.colors.length) && awardClient) {
          try { const { html } = await awardClient.getAwardHtml('/websites/'); const parsed = awardParseCategories(html); awardIndex.setTaxonomy(parsed); tax = awardIndex.getTaxonomy(); source = 'live'; }
          catch (e) { return textResult({ mode, colors: [], filters: [], source: 'unavailable', liveError: String((e && e.message) || e).slice(0, 220), note: 'taxonomy unavailable; rebuild the index or retry later' }); }
        }
        // Paginated: colors are few (return all); filters page with limit/offset.
        const allFilters = tax.filters || [];
        return textResult({ mode, colors: tax.colors || [], filters: allFilters.slice(offset, offset + limit), filtersTotal: allFilters.length, limit, offset, source, updatedAt: tax.updatedAt || null, note: allFilters.length > limit ? 'filters paged — raise offset for more' : undefined });
      }
      if (mode === 'motion') {
        const r = awardIndex.searchMotion({ library: toolFn_str(a.library, 'library'), easing: toolFn_str(a.easing, 'easing'), scrollModel: a.scrollModel === undefined ? undefined : String(a.scrollModel), limit });
        if (r.empty) return textResult({ mode, total: 0, items: [], emptyCorpus: true, note: 'no motion studies recorded yet — run aura_motion_study {mode:inspect|record} first' });
        return textResult({ mode, total: r.total, items: r.items, emptyCorpus: false });
      }
      if (mode === 'elements') {
        const q = toolFn_str(a.query, 'query') || ''; const cat = toolFn_str(a.category, 'category');
        let pool = awardIndex.listElements(500);
        if (!pool.length && awardClient && q) {
          // Honest empty: element gallery needs per-item fetches; point at winners backfill instead of scraping blindly.
          return textResult({ mode, total: 0, items: [], note: 'element corpus is empty; fetch site elements via aura_award_inspect {mode:site_elements} or record new_winners to backfill' });
        }
        let items = pool;
        if (cat) items = items.filter((e) => String(e.category || '').toLowerCase() === cat.toLowerCase() || String(e.title || '').toLowerCase().includes(cat.toLowerCase()));
        if (q) {
          const toks = awardTokens(q);
          items = items.map((e) => { const hay = (String(e.title || '') + ' ' + String(e.author || '') + ' ' + String(e.category || '')).toLowerCase(); let s = 0; for (const t of toks) if (hay.includes(t)) s++; return { e, s }; }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || String(x.e.title).localeCompare(String(y.e.title))).map((x) => x.e);
        } else items = [...items].sort((x, y) => String(x.title).localeCompare(String(y.title)));
        const page = items.slice(offset, offset + limit).map((e) => ({ slug: e.slug, title: e.title, author: e.author || null, category: e.category || null, mediaUrl: e.mediaUrl || (e.mediaPath ? awardElementUrl(e.mediaPath) : null), mediaType: e.mediaType || null, siteSlug: e.siteSlug || null, sourceUrl: e.sourceUrl || null, evidence: { source: 'awwwards' } }));
        return textResult({ mode, query: q || null, total: items.length, limit, offset, items: page, ...(page.length ? {} : { suggestions: awardSuggestQueries(q || 'hero', awardIndex.getTaxonomy()) }) });
      }
      // sites
      const query = toolFn_str(a.query, 'query') || ''; const slugQ = a.slug === undefined ? undefined : awardNormalizeSlug(a.slug);
      const tech = toolFn_str(a.technology, 'technology'); const color = toolFn_str(a.color, 'color'); const awardF = a.award; const studio = toolFn_str(a.studio, 'studio');
      if (awardF !== undefined && !['sotd', 'developer', 'honorable'].includes(awardF)) toolFn_bad('award must be sotd|developer|honorable');
      if (color !== undefined && !/^#?[0-9a-fA-F]{6}$/.test(color.trim())) toolFn_bad('color must be a hex like #FF5733');
      let pool = awardIndex.listSites(2000);
      let liveError = null, liveRefreshed = false;
      if (!pool.length && awardClient) {
        try {
          const { html } = await awardClient.getAwardHtml(awardFilterUrl({ color: color ? '#' + String(color).replace('#', '') : undefined, tags: a.tags, technology: tech, award: awardF }));
          const parsed = awardParseListing(html);
          if (parsed.length) { awardIndex.upsertSites(parsed); pool = awardIndex.listSites(2000); liveRefreshed = true; }
        } catch (e) { liveError = String((e && e.message) || e).slice(0, 220); }
      }
      let filtered = pool;
      if (slugQ) filtered = filtered.filter((s) => s.slug === slugQ);
      if (tech) filtered = filtered.filter((s) => (s.tags || []).map((t) => String(t).toLowerCase()).includes(tech.toLowerCase()) || JSON.stringify(s).toLowerCase().includes(tech.toLowerCase()));
      if (studio) filtered = filtered.filter((s) => String(s.studio || '').toLowerCase().includes(studio.toLowerCase()));
      if (Array.isArray(a.tags) && a.tags.length) {
        const want = a.tags.map((t) => String(t).toLowerCase());
        filtered = filtered.filter((s) => want.some((w) => (s.tags || []).map((t) => String(t).toLowerCase()).includes(w)));
      }
      const { tokens, scored } = awardScoreSites(filtered, query || slugQ || '', { technology: tech, color });
      const ranked = query ? scored.filter((x) => x.score > 0).map((x) => ({ s: x.site, score: x.score, reasons: x.reasons })) : scored.map((x) => ({ s: x.site, score: x.score, reasons: x.reasons }));
      const total = ranked.length;
      const page = ranked.slice(offset, offset + limit);
      // Full-detail enrichment runs concurrently (the award client spaces
      // requests 1/s) but is capped: enriching 25 rows would take ~25s.
      const FULL_CAP = 5;
      const enrich = full ? page.slice(0, FULL_CAP) : [];
      const enriched = await Promise.all(enrich.map(async (r) => {
        try { const d = await awardDetailFor(r.s.slug); return awardFullSite(d.summary || r.s, d.detail, { score: r.score, reasons: r.reasons }); }
        catch { return awardCompactSite(r.s, { score: r.score, reasons: r.reasons }); }
      }));
      const items = page.map((r, i) => (full && i < enriched.length ? enriched[i] : awardCompactSite(r.s, { score: r.score, reasons: r.reasons })));
      const out = { mode, query: query || null, tokens, total, limit, offset, items, source: liveRefreshed ? 'live' : 'local-index', ...(liveError ? { liveError } : {}),
        ...(full && page.length > FULL_CAP ? { full_enrichment_capped: FULL_CAP, full_note: 'only the first ' + FULL_CAP + ' hits carry full detail (polite-fetch bound); the rest are compact' } : {}),
        corpusNote: liveRefreshed ? 'local index was empty; seeded from one polite live listing fetch (rebuild the index for depth)' : 'ranked from the local index; rebuild/refresh the index when stale' };
      if (!items.length && !liveError) { out.suggestions = awardSuggestQueries(query || 'portfolio', awardIndex.getTaxonomy()); out.note = 'zero-match (not a failure): try a suggestion'; }
      if (!items.length && liveError) out.note = 'upstream fetch failed; local index also empty — retry later, do not treat as zero-match';
      return textResult(out); },
    aura_award_inspect: async (a) => { a = a || {}; const mode = awardMode(a.mode, ['site_details', 'site_elements', 'element', 'compare_sites'], 'mode');
      if (mode === 'element') {
        const slug = awardNormalizeSlug(a.elementSlug || toolFn_bad('elementSlug (string) is required'));
        let rec = awardIndex.getElement(slug);
        if (!rec && awardClient) {
          try { const { html } = await awardClient.getAwardHtml('/inspiration/' + slug); const parsed = awardParseElementPage(html); if (parsed) { awardIndex.upsertElements([{ ...parsed }]); rec = awardIndex.getElement(slug) || parsed; } } catch (e) { if (e && e.code === 'NOT_FOUND') throw e; }
        }
        if (!rec) { const e = new Error('element not found: ' + slug); e.code = 'NOT_FOUND'; throw e; }
        return textResult({ mode, element: rec });
      }
      if (mode === 'compare_sites') {
        const slugs = awardStrArr(a.slugs, 'slugs', 3) || toolFn_bad('slugs (array of 2-3) is required');
        if (slugs.length < 2) toolFn_bad('compare_sites needs 2-3 slugs');
        const normed = slugs.map((s) => awardNormalizeSlug(s));
        // Concurrent detail fetch (polite 1/s via the client); NOT_FOUND on
        // any ref still throws, other failures stay per-ref unavailable.
        const settled = await Promise.all(normed.map(async (s) => {
          try { return { ok: true, d: await awardDetailFor(s) }; }
          catch (e) { return { ok: false, slug: s, err: e }; }
        }));
        for (const r of settled) if (!r.ok && r.err && r.err.code === 'NOT_FOUND') throw r.err;
        const entries = settled.map((r) => {
          const s = r.ok ? r.d.slug : r.slug;
          let motion = null;
          try { const mr = awardIndex.searchMotion({ limit: 25 }); motion = (mr.items || []).find((m) => String(m.url || '').toLowerCase().includes(s)) || null; } catch { motion = null; }
          return { slug: s, detail: r.ok ? r.d.detail : null, motion };
        });
        const cmp = awardCompareSites(entries);
        return textResult({ mode, compared: cmp.per, shared: { technology: cmp.sharedTech, technologyFamilies: cmp.sharedTechFamilies, elements: cmp.sharedElements, elementKeywords: cmp.sharedElementKeywords, palette: cmp.sharedPalette, luminanceBands: cmp.sharedBands }, directionHints: cmp.directionHints, gaps: cmp.per.flatMap((p) => p.gaps.map((g) => p.slug + ': ' + g)), note: 'missing fields are unknown evidence, not negative proof' });
      }
      const slug = awardNormalizeSlug(a.slug || toolFn_bad('slug (string) is required'));
      const d = await awardDetailFor(slug, { withStatic: true });
      if (!d.summary && !d.detail) { const e = new Error('site not found: ' + slug); e.code = 'NOT_FOUND'; throw e; }
      if (mode === 'site_details') {
        let motion = null;
        try { const mr = awardIndex.searchMotion({ limit: 25 }); motion = (mr.items || []).find((m) => String(m.url || '').toLowerCase().includes(slug)) || null; } catch { motion = null; }
        return textResult({ mode, slug, summary: d.summary ? awardCompactSite(d.summary, null) : null, detail: d.detail, ideas: awardSiteIdeas(d.detail), ideas_contract: '0-6 ideas by held evidence (1 on thin evidence is valid); every idea is status:suggested with an observed basis, never stated fact', motion: motion || null, motion_static: d.motion_static || null, evidence: { detail: d.detail ? d.detailStatus : 'unavailable', motion: motion ? 'cached' : 'unavailable', motion_static: d.motion_static ? d.motion_static.status : 'unavailable', ...(d.liveError ? { liveError: d.liveError } : {}) } });
      }
      // site_elements
      let elements = [];
      if (d.detail && d.detail.elements) {
        const media = awardParseElementsSection((await (async () => { try { const r = await awardClient.getAwardHtml('/sites/' + slug); return r.html; } catch { return ''; } })())) || [];
        elements = (media.length ? media : d.detail.elements.map((t) => ({ title: t, mediaPath: null }))).map((m) => ({ title: m.title, mediaUrl: m.mediaPath ? awardElementUrl(m.mediaPath) : null, mediaType: m.mediaPath ? (String(m.mediaPath).endsWith('.mp4') ? 'video' : 'image') : null, siteSlug: slug, sourceUrl: awardSiteUrl(slug), evidence: { source: 'awwwards' } }));
      } else {
        const pool = awardIndex.listElements(500).filter((e) => e.siteSlug === slug);
        elements = pool.map((e) => ({ title: e.title, mediaUrl: e.mediaUrl || (e.mediaPath ? awardElementUrl(e.mediaPath) : null), mediaType: e.mediaType, siteSlug: slug, sourceUrl: e.sourceUrl || awardSiteUrl(slug), evidence: { source: 'awwwards' } }));
      }
      return textResult({ mode, slug, sourceUrl: awardSiteUrl(slug), elements, ...(elements.length ? {} : { note: 'no Elements section on this page (legitimate empty) or detail unavailable' }) }); },
    aura_design_blueprint: async (a) => { a = a || {}; const goal = typeof a.goal === 'string' ? a.goal.trim() : toolFn_bad('goal (string) is required');
      if (!goal) toolFn_bad('goal (string) is required');
      const refs = awardStrArr(a.references, 'references', 5) || toolFn_bad('references (array of 2-5 slugs) is required');
      if (refs.length < 2 || refs.length > 5) toolFn_bad('references must hold 2-5 slugs — got ' + refs.length);
      const normed = refs.map((s) => awardNormalizeSlug(s));
      const technology = toolFn_str(a.technology, 'technology'); const visualDirection = toolFn_str(a.visualDirection, 'visualDirection'); const responsive = toolFn_str(a.responsive, 'responsive');
      const constraints = Array.isArray(a.constraints) ? a.constraints.filter((c) => typeof c === 'string').map((c) => c.slice(0, 200)).slice(0, 8) : [];
      const includeStructure = a.includeStructure === undefined ? false : toolFn_bool(a.includeStructure, 'includeStructure');
      const details = (await Promise.all(normed.map(async (s) => {
        try { return await awardDetailFor(s, { withStatic: true }); }
        catch (e) {
          if (e && e.code === 'NOT_FOUND') throw e;
          return { slug: s, summary: awardIndex.getSite(s), detail: null, detailStatus: 'unavailable', liveError: String((e && e.message) || e).slice(0, 160) };
        }
      })));
      // Aura catalogue matches (real rows only; failures stay unavailable).
      // One query PER proposed section so every section gets a candidate —
      // theme words from the goal ride along (dark/light re-rank server-side).
      const auraMatches = []; let auraUnavailable = null; let sysSlugForScaffold = null;
      const SECTIONS = AWARD_SECTIONS;
      try {
        if (!catalog || typeof catalog.searchCatalog !== 'function') throw new Error('catalogue not wired');
        // Test the combined text, then extract from the same combined text.
        // (Testing goal+visualDirection but matching goal alone null-dereferenced
        // whenever the theme word appeared only in visualDirection.)
        const themeMatch = (goal + ' ' + (visualDirection || '')).match(/\b(dark|light)\b/i);
        const themeWord = themeMatch ? themeMatch[1].toLowerCase() : undefined;
        const seen = new Set();
        const queries = [];
        for (const sec of SECTIONS) {
          const refWords = [];
          for (const d of details) {
            const toks = awardTokens(((d.detail && d.detail.title) || '') + ' ' + ((d.detail && (d.detail.elements || []).join(' ')) || '')).slice(0, 2);
            if (toks.length) refWords.push(toks[0]);
          }
          const q = [...new Set([sec, ...refWords.slice(0, 1), themeWord].filter(Boolean))].join(' ');
          queries.push({ section: sec, q });
        }
        // Section queries run concurrently (catalogue coalesces + caches);
        // results re-assemble in section order with duplicate ids collapsed.
        const sectionResults = await Promise.all(queries.map(async ({ section, q }) => {
          try {
            const r = await catalog.searchCatalog('components', { query: q, freeOnly: true, limit: 2, ...(themeWord ? { theme: themeWord } : {}) });
            return { section, q, items: (r.items || []).slice(0, 1), fallback: r && r.isFallback ? (r.fallback || 'fallback') : null };
          } catch { return { section, q, items: [], fallback: null }; }
        }));
        const fbBySection = {};
        for (const { section, fallback } of sectionResults) if (fallback && !(section in fbBySection)) fbBySection[section] = fallback;
        for (const { section, q, items } of sectionResults) {
          if (auraMatches.length >= 12) break;
          for (const it of items) {
            if (!it || it.premium !== false) continue;
            const key = String(it.id || it.slug);
            if (seen.has(key)) continue;
            seen.add(key);
            auraMatches.push({ section, componentId: it.id ?? it.slug, componentTitle: it.title, pageUrl: it.page_url, why: 'catalogue match for "' + q + '"', matchEvidence: { fallback: fbBySection[section] || null } });
            break;
          }
        }
        try {
          const sys = await catalog.searchCatalog('design_systems', { query: goal, limit: 1 });
          if (sys.items && sys.items[0]) { auraMatches.unshift({ section: 'tokens', componentId: sys.items[0].slug || sys.items[0].id, componentTitle: sys.items[0].title, pageUrl: sys.items[0].page_url, why: 'design-system tokens first' }); sysSlugForScaffold = sys.items[0].slug || sys.items[0].id; }
        } catch { /* optional */ }
        const covered = new Set(auraMatches.map((m) => m.section));
        const uncovered = SECTIONS.filter((s) => !covered.has(s));
        if (uncovered.length) auraUnavailable = (auraUnavailable ? auraUnavailable + '; ' : '') + 'no free catalogue match for sections: ' + uncovered.join(', ') + ' — build these from tokens + closest matched section';
        // Weak-consensus fallback: fewer than 3 component matches is not an
        // actionable brief. Fill from human-grade editorial picks, LABELED as
        // such (editorial:true) — never silently presented as query matches.
        const compCount = auraMatches.filter((m) => m.section !== 'tokens').length;
        if (compCount < 3 && catalog && typeof catalog.editorialPicks === 'function') {
          try {
            const picks = await catalog.editorialPicks(3);
            for (const p of (picks || [])) {
              if (auraMatches.length >= 12) break;
              if (!p || p.premium !== false) continue;
              const key = String(p.id || p.slug);
              if (seen.has(key)) continue;
              seen.add(key);
              auraMatches.push({ section: 'general', componentId: p.id ?? p.slug, componentTitle: p.title, pageUrl: p.page_url, why: 'editorial fallback: goal matched nothing directly — human-grade free pick', editorial: true });
            }
            if ((picks || []).length) auraUnavailable = (auraUnavailable ? auraUnavailable + '; ' : '') + 'section queries matched thinly — editorial free picks fill the kit (marked editorial:true)';
          } catch { /* brief stays thin but honest */ }
        }
      } catch (e) { auraUnavailable = String((e && e.message) || e).slice(0, 200); }
      let structureNotes = null;
      if (includeStructure) {
        if (!awardBrowser) structureNotes = 'structure not captured: browser unavailable (install Chrome or set AURA_CHROME_PATH)';
        else {
          const parts = await Promise.all(normed.slice(0, 3).map(async (s) => {
            const d = details.find((x) => x.slug === s);
            const live = d && d.detail && d.detail.liveUrl;
            if (!live) return s + ': no live URL in evidence';
            try { const st = await awardBrowser.structure(live, { viewport: 'desktop' }); return s + ': ' + st.bands.length + ' bands over ' + st.totalHeight + 'px (live-dom)'; }
            catch (e) { return s + ': structure unavailable (' + String((e && e.message) || e).slice(0, 120) + ')'; }
          }));
          structureNotes = parts.join('; ');
        }
      }
      let motionNotes = null;
      const gaps = [];
      for (const d of details) {
        if (!d.detail) gaps.push(d.slug + ': reference detail unavailable' + (d.liveError ? ' (' + d.liveError + ')' : ''));
      }
      const staticCues = [];
      for (const d of details) {
        const line = awardStaticSummary(d.slug, d.motion_static);
        if (line) staticCues.push(line);
      }
      let motionRecorded = false;
      try {
        const mr = awardIndex.searchMotion({ limit: 25 });
        const hits = (mr.items || []).filter((m) => normed.some((s) => String(m.url || '').toLowerCase().includes(s)));
        if (hits.length) { motionRecorded = true; motionNotes = 'Recorded motion for ' + hits.map((h) => h.url).join(', ') + ': prefer ' + hits.map((h) => (h.stack && h.stack.libs || []).join('+') || 'css').join('; '); }
        else {
          if (staticCues.length) motionNotes = 'Static markup cues (NOT runtime observation — record a study for trigger counts/easing): ' + staticCues.join(' | ');
          gaps.push('motion: no recorded studies for these refs — run aura_motion_study {mode:inspect} on their live URLs, or follow the hand-written <500ms + prefers-reduced-motion guidance');
        }
      } catch { /* ignore */ }
      if (!includeStructure) gaps.push('structure: not requested (pass includeStructure:true for measured band evidence)');
      if (auraUnavailable) gaps.push('catalogue: ' + auraUnavailable);
      // Requested palette synthesis: hexes named in the goal/direction become
      // PROPOSED tokens (never presented as observed ref evidence), mapped
      // against the refs' observed luminance bands.
      const requestedPalette = [...new Set([...String(goal + ' ' + (visualDirection || '')).matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((m) => { const h = m[1]; return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h).toUpperCase(); }))].slice(0, 6);
      const built = awardBuildBlueprint({ goal, refs: normed, details, auraMatches, structureNotes, motionNotes, motionRecorded, constraints, technology, visualDirection, responsive, requestedPalette, gaps });
      // next_calls: immediately executable follow-ups built ONLY from real
      // ids/urls gathered above — the agent acts without another search round.
      const compMatches = auraMatches.filter((m) => m.section !== 'tokens' && !m.editorial).slice(0, 3);
      const nextCalls = compMatches.map((m) => ({ tool: 'aura_get_component', arguments: { id: m.componentId }, why: 'read full markup for the ' + m.section + ' pick before pasting' }));
      const scaffoldComps = auraMatches.filter((m) => m.section !== 'tokens').slice(0, 8).map((m) => String(m.componentId));
      if (scaffoldComps.length) nextCalls.push({ tool: 'aura_scaffold_page', arguments: { goal, ...(sysSlugForScaffold ? { system: sysSlugForScaffold } : {}), components: scaffoldComps }, why: 'one-turn page build from the matched kit (tokens first, then markup)' });
      for (const d of details) {
        if (d.detail && d.detail.liveUrl) nextCalls.push({ tool: 'aura_motion_study', arguments: { mode: 'inspect', url: d.detail.liveUrl }, why: 'record real motion evidence for ' + d.slug + ' before animating' });
        if (nextCalls.length >= 6) break;
      }
      return textResult({ goal, references: normed, markdown: built.markdown, spec: built.spec, auraEvidence: auraMatches.length ? { matched: auraMatches.length, sectionsCovered: [...new Set(auraMatches.map((m) => m.section))] } : { matched: 0, unavailable: auraUnavailable || 'catalogue lookup failed or matched nothing' }, next_calls: nextCalls, license_note: 'Reference design belongs to its creators (see sourceUrl per ref); Aura matches are all-rights-reserved per Aura Terms §4 — adapt patterns, never copy source.' }); },
    aura_visual_audit: async (a) => { a = a || {}; const mode = awardMode(a.mode, ['capture', 'structure', 'compare'], 'mode');
      const viewport = a.viewport === undefined ? 'desktop' : awardMode(a.viewport, ['desktop', 'mobile'], 'viewport');
      const waitStrategy = a.waitStrategy === undefined ? 'load' : awardMode(a.waitStrategy, ['load', 'networkidle'], 'waitStrategy');
      const settleMs = a.settleMs === undefined ? 1500 : toolFn_num(a.settleMs, 'settleMs');
      if (typeof settleMs !== 'number' || settleMs < 0 || settleMs > 8000) toolFn_bad('settleMs must be 0-8000');
      const allowLocal = a.allowLocal === undefined ? false : toolFn_bool(a.allowLocal, 'allowLocal');
      // Local-file audit (P0-2): a file:// build path or plain local path is
      // readable WITHOUT a browser when allowLocal:true — parsed as labeled
      // static-html estimates (source:local-file). Screenshots still need http.
      const readLocalSource = async (raw, label) => {
        if (!allowLocal) { const e = new Error(label + ' is a local path: pass allowLocal:true to audit local builds (structure mode reads the file directly; capture needs a served http URL)'); e.code = 'UNSUPPORTED_OPERATION'; throw e; }
        let fs, path;
        try {
          const g = globalThis.process && globalThis.process.getBuiltinModule ? globalThis.process.getBuiltinModule : null;
          if (typeof g !== "function") throw new Error("needs Node 22+");
          fs = g.call(globalThis.process, "node:fs"); path = g.call(globalThis.process, "node:path");
        } catch { const e = new Error('local file audit needs Node 22+'); e.code = 'UNSUPPORTED_OPERATION'; throw e; }
        let file = String(raw);
        if (/^file:\/\//i.test(file)) { try { file = new URL(file).pathname; } catch { toolFn_bad(label + ' is not a readable file URL'); } if (/^\/[A-Za-z]:\//.test(file)) file = file.slice(1); }
        if (/[\0]/.test(file) || file.length > 1000) toolFn_bad(label + ' is not a readable local file');
        let html;
        try { html = fs.readFileSync(file, "utf8"); }
        catch { const e = new Error(label + ' not found or unreadable: ' + String(file).slice(0, 160)); e.code = 'NOT_FOUND'; throw e; }
        if (html.length > 1500000) html = html.slice(0, 1500000);
        const bands = cdpBandsFromHtml(html, raw);
        return { ...bands, source: 'local-file', note: 'local file estimate — tags/landmarks only, no measured layout; serve over http + allowLocal:true for live-dom bands' };
      };
      const isLocalInput = (raw) => typeof raw === 'string' && (/^file:\/\//i.test(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/') || /^[^/:?#]+\.html?([?#]|$)/i.test(raw));
      const fetchStatic = async (target) => {
        // Shared guarded fetch: manual redirects with per-hop URL
        // classification + DNS guard, streaming bounded read. The old
        // redirect:'follow' fetch could land on a blocked host after a
        // server-side redirect; this one re-validates every hop.
        const got = await awardFetchGuardedHtml(target, { fetchImpl: globalThis.fetch, allowLocal, label: 'audited page' });
        if (!got.ok) {
          if (got.status === 404) { const e = new Error('page not found: ' + target); e.code = 'NOT_FOUND'; throw e; }
          throw awardErr('UPSTREAM_ERROR', 'static fetch failed for ' + target + ': ' + String(got.reason).slice(0, 200));
        }
        return got.html;
      };
      const structureOf = async (rawTarget, label) => {
        if (isLocalInput(rawTarget)) return readLocalSource(rawTarget, label || 'url');
        const target = rawTarget;
        if (awardBrowser) {
          try { return await awardBrowser.structure(target, { viewport, allowLocal }); }
          catch (e) {
            // Any live-dom failure degrades to labeled static estimates —
            // the audit stays usable, and the downgrade is disclosed.
            if (e && (e.code === 'BROWSER_UNAVAILABLE' || e.code === 'CAPTURE_TIMEOUT' || e.code === 'UPSTREAM_ERROR')) {
              try {
                const html = await fetchStatic(target);
                return { ...cdpBandsFromHtml(html, target), fallbackFrom: 'live-dom', fallbackWhy: String((e && e.message) || e).slice(0, 200) };
              } catch (fe) {
                const both = awardErr('UPSTREAM_ERROR', 'live-dom failed (' + String((e && e.message) || e).slice(0, 160) + ') AND static fetch failed (' + String((fe && fe.message) || fe).slice(0, 160) + ') — is the dev server running? For http://127.0.0.1 targets serve the build first (e.g. npx serve) with allowLocal:true; for files pass the path directly with allowLocal:true.');
                throw both;
              }
            }
            throw e;
          }
        }
        const html = await fetchStatic(target);
        return cdpBandsFromHtml(html, target);
      };
      if (mode === 'capture') {
        if (typeof a.url === 'string' && isLocalInput(a.url) && !/^https?:\/\//i.test(a.url)) toolFn_bad('capture needs an http(s) URL — screenshots require a browser navigating a served page. Serve the build (e.g. npx serve) and pass its http://127.0.0.1:PORT URL with allowLocal:true.');
        const target = awardValidateHttpUrl(a.url || toolFn_bad('url (string) is required'), { allowLocal });
        if (!awardBrowser) throw awardErr('BROWSER_UNAVAILABLE', 'capture needs Chrome: install it or set AURA_CHROME_PATH. Fallback: aura_visual_audit {mode:structure} estimates sections from static HTML without a browser.');
        try { return textResult(await awardBrowser.capture(target, { viewport, waitStrategy, settleMs, allowLocal })); }
        catch (e) {
          if (e && (e.code === 'BROWSER_UNAVAILABLE' || e.code === 'UNSUPPORTED_OPERATION')) throw e;
          throw awardErr('UPSTREAM_ERROR', 'capture failed: ' + String((e && e.message) || e).slice(0, 220) + ' — retry, or use mode:structure for a static estimate');
        }
      }
      if (mode === 'structure') {
        const raw = a.url || toolFn_bad('url (string) is required');
        const target = isLocalInput(raw) ? raw : awardValidateHttpUrl(raw, { allowLocal });
        return textResult({ mode, ...(await structureOf(target, 'url')) });
      }
      const rawRef = a.referenceUrl || toolFn_bad('referenceUrl (string) is required');
      const rawBuild = a.buildUrl || toolFn_bad('buildUrl (string) is required');
      const normRef = isLocalInput(rawRef) ? rawRef : awardValidateHttpUrl(rawRef, { allowLocal });
      const normBuild = isLocalInput(rawBuild) ? rawBuild : awardValidateHttpUrl(rawBuild, { allowLocal });
      const [rs, bs] = await Promise.all([structureOf(normRef, 'referenceUrl'), structureOf(normBuild, 'buildUrl')]);
      const mismatches = [];
      if (rs.bands.length !== bs.bands.length) mismatches.push({ kind: 'section-count', detail: 'reference has ' + rs.bands.length + ' bands, build has ' + bs.bands.length });
      const seq = (x) => x.bands.map((b) => b.tag + ':' + (b.label || '')).join(' > ');
      if (seq(rs) !== seq(bs)) mismatches.push({ kind: 'section-order', detail: 'band tag sequence differs', reference: seq(rs).slice(0, 300), build: seq(bs).slice(0, 300) });
      if (rs.totalHeight && bs.totalHeight) {
        const ratio = bs.totalHeight / Math.max(1, rs.totalHeight);
        if (ratio < 0.7 || ratio > 1.4) mismatches.push({ kind: 'page-height', detail: 'build height ' + bs.totalHeight + 'px vs reference ' + rs.totalHeight + 'px (ratio ' + ratio.toFixed(2) + ')' });
      }
      const pal = (x) => new Set(x.bands.map((b) => String(b.background || '').toLowerCase()).filter(Boolean));
      const rp = pal(rs), bp = pal(bs);
      const onlyRef = [...rp].filter((c) => ![...bp].some((d) => d === c));
      if (onlyRef.length >= 2) mismatches.push({ kind: 'palette', detail: onlyRef.length + ' reference backgrounds absent in build: ' + onlyRef.slice(0, 4).join(', ') });
      return textResult({ mode, reference: rs, build: bs, mismatches, manualJudgment: ['imagery tone and spacing rhythm need human eyes', 'motion/interaction parity is not covered here — see aura_motion_study'], metrics: { refBands: rs.bands.length, buildBands: bs.bands.length }, sources: [rs.source, bs.source], ...((rs.source !== 'live-dom' || bs.source !== 'live-dom') ? { estimateNote: 'one or both sides are layout estimates (no measured offsets) — counts/order still comparable, heights are not' } : {}) }); },
    aura_motion_study: async (a) => { a = a || {}; const mode = awardMode(a.mode, ['inspect', 'record', 'search'], 'mode');
      if (mode === 'search') {
        const r = awardIndex.searchMotion({ library: toolFn_str(a.library, 'library'), easing: toolFn_str(a.easing, 'easing'), scrollModel: a.scrollModel === undefined ? undefined : String(a.scrollModel), limit: awardLimit(a.frames, 10, 25) });
        if (r.empty) return textResult({ mode, total: 0, items: [], emptyCorpus: true, note: 'no motion studies stored yet' });
        return textResult({ mode, total: r.total, items: r.items, emptyCorpus: false });
      }
      const allowLocal = a.allowLocal === undefined ? false : toolFn_bool(a.allowLocal, 'allowLocal');
      const viewport = a.viewport === undefined ? 'desktop' : awardMode(a.viewport, ['desktop', 'mobile'], 'viewport');
      const target = awardValidateHttpUrl(a.url || toolFn_bad('url (string) is required'), { allowLocal });
      if (!awardBrowser) throw awardErr('BROWSER_UNAVAILABLE', 'motion ' + mode + ' needs Chrome: install it or set AURA_CHROME_PATH. Fallback motion plan (generic, NOT observed): entrances <500ms ease-out; scroll reveals via IntersectionObserver; hover 1.03 + shadow; easing ease-out/cubic-bezier(.22,1,.36,1); prefers-reduced-motion disables parallax/scrub. aura_motion_study {mode:search} still queries stored studies.');
      if (mode === 'inspect') {
        const study = await awardBrowser.motionInspect(target, { viewport, allowLocal });
        try { awardIndex.recordMotion(study); } catch { /* memory fallback never fails */ }
        return textResult({ mode, study });
      }
      const frames = a.frames === undefined ? 8 : toolFn_num(a.frames, 'frames');
      if (typeof frames !== 'number' || frames < 2 || frames > 16) toolFn_bad('frames must be 2-16');
      const durationMs = a.durationMs === undefined ? 12000 : toolFn_num(a.durationMs, 'durationMs');
      if (typeof durationMs !== 'number' || durationMs < 4000 || durationMs > 30000) toolFn_bad('durationMs must be 4000-30000');
      const rec = await awardBrowser.recordFrames(target, { frames: Math.floor(frames), viewport, allowLocal, durationMs: Math.floor(durationMs) });
      if (rec.study) { try { awardIndex.recordMotion(rec.study); } catch { /* ignore */ } }
      let video = null, videoAvailable = false, videoHint = null;
      try {
        const enc = await awardBrowser.encodeWebm(rec.frames, {});
        video = enc.video; videoAvailable = !!enc.available; videoHint = enc.hint || null;
      } catch (e) { videoHint = String((e && e.message) || e).slice(0, 160); }
      if (!videoAvailable && !videoHint) videoHint = 'ffmpeg not found; install ffmpeg or set AURA_FFMPEG_PATH for .webm output — frame JPEGs retained';
      return textResult({ mode, url: target, study: rec.study, frames: rec.frames, frameCount: rec.frameCount, video, video_available: videoAvailable, ...(videoHint ? { videoHint } : {}), ...(rec.retentionNote ? { retentionNote: rec.retentionNote } : {}) }); },
    aura_award_index: async (a) => { a = a || {}; const action = awardMode(a.action, ['status', 'rebuild', 'resume', 'refresh', 'new_winners', 'watch_add', 'watch_list', 'watch_remove'], 'action');
      if (action === 'status') return textResult({ action, ...awardIndex.getStatus() });
      if (action === 'watch_list') return textResult({ action, watches: awardIndex.watchList() });
      if (action === 'watch_add') {
        const kind = awardMode(a.kind, ['studio', 'tag', 'url'], 'kind');
        if (typeof a.pattern !== 'string' || !a.pattern.trim()) toolFn_bad('pattern (string) is required');
        return textResult({ action, watch: awardIndex.watchAdd({ kind, pattern: a.pattern, award: a.award }) });
      }
      if (action === 'watch_remove') {
        const kind = awardMode(a.kind, ['studio', 'tag', 'url'], 'kind');
        if (typeof a.pattern !== 'string' || !a.pattern.trim()) toolFn_bad('pattern (string) is required');
        return textResult({ action, ...awardIndex.watchRemove({ kind, pattern: a.pattern }) });
      }
      if (action === 'new_winners') {
        if (!awardClient) throw awardErr('UNSUPPORTED_OPERATION', 'new_winners needs an award client (server wiring)');
        const r = await awardIndex.newWinners({ client: awardClient, award: a.award || 'sotd' });
        let deltas = []; let seeded = [];
        try {
          if (awardIndex.checkWatchesDetailed) { const w = awardIndex.checkWatchesDetailed(); deltas = w.deltas || []; seeded = w.seeded || []; }
          else deltas = awardIndex.checkWatches ? awardIndex.checkWatches() : [];
        } catch { deltas = []; seeded = []; }
        return textResult({ action, ...r, watchDeltas: deltas, ...(seeded.length ? { watchBaselineSeeded: seeded, watchBaselineNote: 'first check for these watches seeded their baseline silently — future deltas report newly indexed matches only' } : {}) });
      }
      if (!awardClient) throw awardErr('UNSUPPORTED_OPERATION', action + ' needs an award client (server wiring)');
      const maxPages = a.maxPages === undefined ? 5 : toolFn_num(a.maxPages, 'maxPages');
      if (typeof maxPages !== 'number' || maxPages < 1 || maxPages > 20) toolFn_bad('maxPages must be 1-20 (bounded crawl per call; resume for more)');
      // Bounded crawl: the index layer owns the plan; maxPages caps fetches
      // THIS call so a plan advances across calls instead of re-crawling the
      // same prefix. No tag slicing here — the stored plan defines the pages.
      const args = { client: awardClient, maxPages: Math.floor(maxPages) };
      const r = action === 'refresh' ? await awardIndex.refresh(args) : action === 'resume' ? await awardIndex.resume(args) : await awardIndex.rebuild(args);
      return textResult({ action, ...r, note: r.note || 'page budget reached; call resume to continue the same plan' }); },
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
// Award subsystem: persistent file index, polite live client, optional CDP
// browser. No auto-crawl here — indexing runs only via aura_award_index.
const awardClient = createAwardClient({ fetchImpl: globalThis.fetch });
let awardIndex = null;
try { awardIndex = createAwardIndex({}); } catch { awardIndex = null; }
let awardBrowser = null;
try { awardBrowser = createBrowserAdapter({}); } catch { awardBrowser = null; }
const handlers = createHandlers(catalog, icons, version, { awardClient, awardIndex, browser: awardBrowser });

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
