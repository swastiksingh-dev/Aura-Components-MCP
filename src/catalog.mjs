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
const ilike = (v) => "*" + String(v).replaceAll("*", "").replaceAll(",", " ").trim() + "*";

// Split a goal sentence into significant tokens for OR fallback (stop-word filtered).
const STOP = new Set("a,an,the,for,with,and,or,of,to,in,on,my,new,free,dark,also,that,this,from,into,plus,vs,top,best,up".split(","));
export function queryTokens(q, max = 4) {
  return String(q ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 2 && !STOP.has(t)).slice(0, max);
}

function windowAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function weekAgoIso() { return windowAgoIso(7); }
export function trendingIso() { return windowAgoIso(90); } // 7d window is empty: newest DS row is ~12 weeks old; 90d keeps "trending" meaningful

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
    else ors.push("title.ilike." + v + ",description.ilike." + v);
  }
  if (q.sort === "trending") filters.push("created_at=gte." + trendingIso());
  return { params: p, filters, ors };
}

export function buildUrl(base, table, params, filters, ors) {
  let qs = params.toString();
  for (const f of filters) qs += "&" + f;
  if (ors.length) qs += "&or=(" + ors.join(",") + ")";
  return base + "/rest/v1/" + table + "?" + qs;
}

const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + "…[truncated]" : s);

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
  // Facets probe the first 600 chars of FULL code before truncation, so search facets
  // equal detail facets for icons/fonts/theme. Weight uses the true length (ISS1/2/3).
  if (kind === "components" && typeof base.code === "string") {
    base.code_chars = base.code.length;
    if (withFacets) { try { base.facets = withFacets(kind, { ...base, code: base.code.slice(0, 600) }, { fullLength: base.code.length }); } catch { /* never break rows */ } }
    base.code = trunc(base.code, cfg.codeChars);
  }
  if (kind === "skills" && typeof base.content === "string") base.content = trunc(base.content, cfg.contentChars);
  if (kind === "design_systems") {
    if (typeof base.content === "string") base.content = trunc(base.content, cfg.contentChars);
    if (typeof base.preview_html === "string") base.preview_html = trunc(base.preview_html, cfg.codeChars);
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
    const sort = SORTS[kind][q.sort] ? q.sort : "popular";
    const freeOnly = q.freeOnly ?? config.freeOnlyDefault;
    const key = ["search", kind, q.query ?? "", q.tag ?? "", q.mediaType ?? "", sort, limit, offset, freeOnly].join("|");
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
      // Single-token queries that miss also retry bare (drops tag/media filters) + suggest queries.
      const toks = (q.query && q.query.trim() && !q.tag) ? queryTokens(q.query) : [];
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
      const enriched = await enrichAuthors(rows);
      const out = { kind, total, limit, offset, items: enriched.map((r) => shapeRow(kind, r, config, facetsFn)), cached: false };
      if (deduped) out.deduped = deduped;
      // Post-filter: theme (dark|light) is derived, not a column — filter shaped rows.
      if (q.theme && (kind === "components")) {
        const want = String(q.theme).toLowerCase();
        out.items = out.items.filter((it) => (it.facets && it.facets.theme) === want);
      }
      // ISS15: transparent fallback — agents see what happened, not a magic string.
      if (fallback) { out.fallback = fallback; out.isFallback = true; out.fallback_score = "token-overlap:" + toks.length + "-terms"; }
      else if ((!rows || !rows.length) && toks.length) { out.isFallback = false; out.suggested_queries = suggest(toks).filter((s) => !/^[a-z0-9]{8,}$/i.test(s.replace(/\s/g, ""))); if (!out.suggested_queries.length) out.suggested_queries = ["hero", "pricing", "landing page"]; }
      cacheSet(key, out);
      return out;
    })();
    inflight.set(key, p);
    try { return await p; } finally { inflight.delete(key); }
  }

  async function getItem(kind, idOrSlug) {
    const key = ["get", kind, String(idOrSlug)].join("|");
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
    const out = { kind, item: shapeRow(kind, enriched[0], config, facetsFn), cached: false };
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

  return { searchCatalog, getItem, getStatus, categoryCounts, bundleItems, relatedItems };
}
