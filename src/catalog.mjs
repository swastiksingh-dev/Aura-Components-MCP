// Module: catalog — the deep module. Small interface (searchCatalog,
// getItem, getStatus) over query building, caching, truncation, author
// enrichment, and page-URL derivation. Adapters: PostgREST via fetcher.

const SITE = "https://www.aura.build";

const SORTS = {
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
const STOP = new Set("a,an,the,for,with,and,or,of,to,in,on,my,new,free,also,that,this,from,into,plus,vs,top,best,up".split(","));
const THEME_WORDS = new Set(["dark", "light", "midnight", "noir", "black", "white", "bright", "airy", "minimal"]);
export function queryTokens(q, max = 4) {
  return String(q ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 2 && !STOP.has(t) && !THEME_WORDS.has(t)).slice(0, max);
}
// Theme hint from the raw query: explicit signal, separate from match tokens.
export function detectThemeHint(q) {
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
export function stemTok(t) {
  let s = String(t ?? "").toLowerCase();
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 4 && s.endsWith("es") && /(ses|xes|zes|ches|shes)$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 4 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  else if (s.length > 4 && s.endsWith("y")) s = s.slice(0, -1);
  return s;
}
// Rank rows: +2 per matched token in title, +1 in description/tags, theme match first.
// Returns { rows, scored } where scored explains the top pick for fallback_score.
export function scoreRows(kind, rows, toks, themeHint) {
  const scored = rows.map((r) => {
    const title = String(r.title || "").toLowerCase();
    const desc = String(r.description || "").toLowerCase();
    const tags = ((r.tags || []).map((x) => String(x).toLowerCase()).join(" "));
    let s = 0;
    for (const raw of toks) {
      const t = stemTok(raw);
      if (title.includes(raw) || (t !== raw && title.includes(t))) s += 2;
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
export function matchOverlap(kind, toks, item) {
  const list = Array.isArray(toks) ? toks : [];
  if (!list.length || !item) return 0;
  if (kind === "components" || kind === "assets") {
    const title = String(item.title || "").toLowerCase();
    let n = 0;
    for (const t of list) {
      const tok = String(t ?? "").toLowerCase();
      const stem = stemTok(tok);
      if (tok && (title.includes(tok) || (stem !== tok && title.includes(stem)))) n++;
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
    if (tok && (hay.includes(tok) || (stem !== tok && hay.includes(stem)))) n++;
  }
  return n;
}

function windowAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
export function trendingIso(days = 90) { return windowAgoIso(days); } // 7d seed is empty; callers pass window_days (default 30 for components now)

export function buildSearchParams(kind, q = {}) {
  const p = new URLSearchParams();
  p.set("select", LIST_COLS[kind]);
  const limit = q.limit;
  const offset = q.offset ?? 0;
  p.set("limit", String(limit));
  p.set("offset", String(offset));
  const sort = SORTS[kind][q.sort] ?? SORTS[kind].popular;
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

export function buildUrl(base, table, params, filters, ors) {
  let qs = params.toString();
  for (const f of filters) qs += "&" + f;
  if (ors.length) qs += "&or=(" + ors.join(",") + ")";
  return base + "/rest/v1/" + table + "?" + qs;
}

// Truncation with cursors: agents see full_length + chunk info instead of a silent
// marker, and can fetch the rest via getItem with { chunk } (see getItem below).
export function chunkText(s, n, chunk = 0) {
  const full = String(s || "");
  const total = Math.max(1, Math.ceil(full.length / n));
  const i = Math.max(0, Math.min(chunk, total - 1));
  return { text: full.slice(i * n, (i + 1) * n) + (i < total - 1 ? "…[truncated]" : ""), chunk: i, chunks: total, full_length: full.length, truncated: total > 1 };
}

// Slim lists: drop heavy blobs (full code/content/preview_html) from list rows,
// keep excerpts + chunk pointers + full_fetch so agents fetch detail on purpose.
// getItem/bundleItems stay full — detail is their job. Default on (q.slim ?? true).
export function slimRows(kind, items) {
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
export function isFreeRow(kind, row) {
  if (kind !== "components" && kind !== "assets") return true;
  return !!row && row.premium === false;
}

export function assertFreeRow(kind, row) {
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
export function isWellFormedRow(kind, row) {
  if (!row || typeof row !== "object") return false;
  if (typeof row.title !== "string" || !row.title) return false;
  const hasId = row.id !== undefined && row.id !== null;
  const hasSlug = typeof row.slug === "string" && !!row.slug;
  if (kind === "components" || kind === "design_systems") return hasId || hasSlug;
  return hasId;
}

export function pageUrl(kind, row) {
  if (kind === "components") return SITE + "/component/" + row.slug;
  if (kind === "skills") return SITE + "/skills/" + row.id;
  // ISS9: asset pages are query-routed (no /assets/ID route exists). Keep the q= form
  // but ALSO expose a stable key so agents can cite: id + slug + title together.
  if (kind === "assets") return SITE + "/assets?q=" + encodeURIComponent(row.title ?? "");
  return SITE + "/design-systems/" + (row.slug ?? row.id);
}

export function assetKey(row) {
  return { id: row.id, slug: row.slug ?? null, title: row.title ?? null };
}

export function shapeRow(kind, row, cfg, withFacets) {
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

export function createCatalog({ fetcher, config, now = () => Date.now(), facetsFn = null }) {
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
    const sort = SORTS[kind][q.sort] ? q.sort : "popular";
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
