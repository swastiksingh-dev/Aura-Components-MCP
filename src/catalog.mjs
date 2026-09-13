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
  components: "id,title,description,tags,premium,views,forks,slug,created_by,created_at,updated_at",
  skills: "id,title,description,source_url,views,forks,featured,created_by,created_at,updated_at",
  assets: "id,title,description,keywords,media_type,premium,views,forks,image_800w,video_url,created_by,created_at",
  design_systems: "id,slug,title,views,forks,featured,created_by,created_at,updated_at",
};

const DETAIL_COLS = {
  components: "id,title,description,tags,code,premium,views,forks,slug,image_url,background,credit_name,credit_url,created_by,created_at,updated_at",
  skills: "id,title,description,content,source_url,views,forks,featured,created_by,created_at,updated_at",
  assets: "id,title,description,keywords,resolution,colors,media_type,image_320w,image_800w,image_1600w,image_url,video_url,video_poster_url,premium,views,forks,slug,created_by,created_at,updated_at",
  design_systems: "id,slug,title,description,content,preview_html,thumbnail_url,source_name,views,forks,featured,created_by,created_at,updated_at",
};

const esc = (s) => String(s).replaceAll('"', '""');
const ilike = (v) => "*" + String(v).replaceAll("*", "").replaceAll(",", " ").trim() + "*";

function weekAgoIso() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

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
    else ors.push("title.ilike." + v);
  }
  if (q.sort === "trending") filters.push("created_at=gte." + weekAgoIso());
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
  if (kind === "assets") return SITE + "/assets?q=" + encodeURIComponent(row.title ?? "");
  return SITE + "/design-systems/" + (row.slug ?? row.id);
}

export function shapeRow(kind, row, cfg) {
  const base = { ...row };
  if (kind === "components" && typeof base.code === "string") base.code = trunc(base.code, cfg.codeChars);
  if (kind === "skills" && typeof base.content === "string") base.content = trunc(base.content, cfg.contentChars);
  if (kind === "design_systems") {
    if (typeof base.content === "string") base.content = trunc(base.content, cfg.contentChars);
    if (typeof base.preview_html === "string") base.preview_html = trunc(base.preview_html, cfg.codeChars);
  }
  base.page_url = pageUrl(kind, row);
  return base;
}

export function createCatalog({ fetcher, config, now = () => Date.now() }) {
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
      const { params, filters, ors } = buildSearchParams(kind, { ...q, limit, offset, sort, freeOnly });
      const url = buildUrl(base, kind, params, filters, ors);
      const { rows, total } = await fetcher.getJson(url, headers);
      const enriched = await enrichAuthors(rows);
      const out = { kind, total, limit, offset, items: enriched.map((r) => shapeRow(kind, r, config)), cached: false };
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
    const out = { kind, item: shapeRow(kind, enriched[0], config), cached: false };
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

  return { searchCatalog, getItem, getStatus, categoryCounts };
}
