// Module: awards — award-website discovery, retrieval, parsing, ranking.
// Reimplements the useful Awwwards-mcp behaviors (site discovery, detail
// design-DNA, elements, taxonomy, winners) in Aura's native zero-dep style:
// pure parsers + polite fetch client + deterministic local ranking.
// Upstream inspiration: INSANE0777/Awwwards-mcp (MIT, (c) 2026 Afjal) —
// behavior reimplemented here, not copied; see THIRD_PARTY_NOTICES.md.
// No invented metadata: every record carries source/evidence fields.

export const AWARD_SCHEMA_VERSION = 1;
export const AWARD_BASE_URL = "https://www.awwwards.com";
export const AWARD_ASSETS_URL = "https://assets.awwwards.com";
export const AWARD_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 aura-components-mcp/1.7.1";
export const AWARD_ALLOWED_HOSTS = ["www.awwwards.com", "awwwards.com", "assets.awwwards.com"];
export const AWARD_TIMEOUT_MS = 10000;
export const AWARD_MAX_BYTES = 2 * 1024 * 1024;
export const AWARD_RATE_MS = 1000;
export const AWARD_FILTERS = { sotd: "websites/sites_of_the_day", developer: "websites/developer", honorable: "websites/honorable" };
export const AWARD_FILTER_NAMES = ["sotd", "developer", "honorable"];
export const AWARD_ELEMENT_CATS = ["hero", "navigation", "pricing", "footer", "features", "contact", "cta", "testimonial", "faq", "about", "gallery", "menu"];
export const AWARD_SCORE_VERSION = 1;

export function awardErr(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
function awardBad(message) { return awardErr("BAD_ARGS", message); }
function awardNotFound(message) { return awardErr("NOT_FOUND", message); }
function awardUpstream(message) { return awardErr("UPSTREAM_ERROR", message); }

const AWARD_ENTITIES = { "&quot;": '"', "&amp;": "&", "&#039;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
export function awardDecodeEntities(s) {
  return String(s ?? "").replace(/&(?:quot|amp|#0?39|lt|gt|nbsp);/g, (e) => AWARD_ENTITIES[e] ?? e);
}
export function awardStripTags(s) {
  return awardDecodeEntities(String(s ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
export function awardNormalizeSlug(s) {
  const v = String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!v || v.length > 120) throw awardBad("slug must be 1-120 chars of [a-z0-9-], got: " + String(s).slice(0, 80));
  return v;
}
export function awardNormalizeUrl(u) {
  if (typeof u !== "string" || !u) return null;
  try {
    const p = new URL(u);
    if (p.protocol !== "http:" && p.protocol !== "https:") return null;
    return p.toString();
  } catch { return null; }
}

// ---- URL safety (SSRF guard) ----
const AWARD_BLOCKED_HOST_RES = [/^localhost$/i, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^0\.0\.0\.0$/, /^\[?::1\]?$/, /\.local$/i, /^metadata\.google\.internal$/i];
export function awardIsBlockedHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  for (const re of AWARD_BLOCKED_HOST_RES) if (re.test(h)) return true;
  return false;
}
export function awardValidateHttpUrl(raw, { allowLocal = false } = {}) {
  if (typeof raw !== "string" || !raw.trim()) throw awardBad("url must be a non-empty http(s) string");
  if (raw.length > 2000) throw awardBad("url too long (max 2000 chars)");
  let u;
  try { u = new URL(raw.trim()); } catch { throw awardBad("url is not parseable: " + raw.slice(0, 120)); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw awardBad("only http/https urls are allowed, got: " + u.protocol);
  if (u.username || u.password) throw awardBad("urls with credentials are not allowed");
  if (awardIsBlockedHost(u.hostname) && !allowLocal) {
    const e = new Error("private/local target blocked (pass allowLocal:true for loopback dev builds): " + u.hostname);
    e.code = "UNSUPPORTED_OPERATION";
    throw e;
  }
  if (u.hostname === "169.254.169.254" || /metadata/i.test(u.hostname)) {
    const e = new Error("cloud metadata endpoints are never fetched");
    e.code = "UNSUPPORTED_OPERATION";
    throw e;
  }
  return u.toString();
}
export function awardValidateAwardPath(pathOrUrl) {
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
export function awardFilterUrl(filters = {}) {
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
export function awardSiteUrl(slug) { return AWARD_BASE_URL + "/sites/" + awardNormalizeSlug(slug); }
export function awardThumbnailUrl(thumbPath, size = 880) {
  const dim = size === 440 ? "440_330" : "880_660";
  return AWARD_ASSETS_URL + "/awards/media/cache/thumb_" + dim + "/" + String(thumbPath).replace(/^\/+/, "");
}
export function awardElementUrl(mediaPath) { return AWARD_ASSETS_URL + "/awards/" + String(mediaPath).replace(/^\/+/, ""); }

// ---- Parsers (scoped, fixture-driven, resilient to missing fields) ----
const AWARD_LABELS = { sotd: "Site of the Day", dev: "Developer Award", hm: "Honorable Mention", sotm: "Site of the Month", mobile: "Mobile Excellence", ecom: "E-Commerce Award" };
export function awardParseListing(html) {
  const src = String(html || "");
  if (!src) return [];
  const sites = [];
  const seen = new Set();
  const parts = src.split('data-collectable-model-value="');
  const blobParts = parts.slice(1);
  for (const part of blobParts) {
    const end = part.indexOf('">');
    if (end < 0 || end > 20000) continue;
    let meta;
    try { meta = JSON.parse(awardDecodeEntities(part.slice(0, end))); } catch { continue; }
    if (!meta || !meta.slug || !meta.title) continue;
    if (meta.type && meta.type !== "submission") continue;
    const slug = String(meta.slug).toLowerCase();
    if (seen.has(slug)) continue;
    const card = part.slice(end, end + 8000);
    const detailMatch = card.match(/href="(\/sites\/[^"#?]+)"/);
    if (!detailMatch) continue;
    const liveMatch = card.match(/class="figure-rollover__bt"[^>]*href="(https?:\/\/[^"]+)"/);
    const awards = [...new Set([...card.matchAll(/budget-tag--([a-z-]+)/g)].map((m) => AWARD_LABELS[m[1]] ?? m[1]))];
    const studioMatch = card.match(/avatar-name__title">([^<]+)</);
    seen.add(slug);
    sites.push({
      slug,
      title: awardDecodeEntities(meta.title).trim(),
      createdAt: Number(meta.createdAt) || 0,
      tags: Array.isArray(meta.tags) ? meta.tags.map((t) => awardDecodeEntities(t)).filter(Boolean) : [],
      thumbnailPath: (meta.images && meta.images.thumbnail) ? String(meta.images.thumbnail) : "",
      liveUrl: liveMatch ? awardDecodeEntities(liveMatch[1]) : null,
      detailPath: detailMatch[1],
      awards,
      studio: studioMatch ? awardDecodeEntities(studioMatch[1]).trim() : null,
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
  }
  return sites;
}
export function awardIsNomineePage(html) { return /<h2 class="text-default">\s*Nominee\b/.test(String(html || "")); }
export function awardParseScore(html) {
  const m = /c-heading-score__note[^>]*>[^<]*?([\d]+(?:\.\d{1,2})?)/.exec(String(html || ""));
  return m ? parseFloat(m[1]) : null;
}
export function awardParseDetail(html, slug) {
  const src = String(html || "");
  const norm = awardNormalizeSlug(slug);
  const palette = [...new Set([...src.matchAll(/<strong>HEX<\/strong>\s*#([0-9A-Fa-f]{6})/g)].map((m) => "#" + m[1].toUpperCase()))];
  const techIdx = src.indexOf("Technologies & Tools</h2>");
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
export function awardParseCategories(html) {
  const src = String(html || "");
  const colors = [...new Set([...src.matchAll(/href="\/websites\/%23([0-9A-Fa-f]{6})\/"/g)].map((m) => "#" + m[1].toUpperCase()))].sort();
  const filters = [...new Set([...src.matchAll(/href="\/websites\/([a-z0-9-]{2,60})\/"/g)].map((m) => m[1]))].filter((s) => s !== "sites_of_the_day").sort();
  return { colors, filters };
}
export function awardParseElementsSection(html) {
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
export function awardParseElementGallery(html) {
  const src = String(html || "");
  const slugs = [...new Set([...src.matchAll(/href="\/inspiration\/([\w-]{1,120})\/?"/g)].map((m) => m[1]))];
  return slugs;
}
export function awardParseElementPage(html) {
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
export function awardTokens(q, max = 6) {
  return String(q ?? "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).map((t) => t.trim()).filter((t) => t.length > 1 && !AWARD_STOP.has(t)).slice(0, max);
}
// Theme words are rank signals, not just match tokens: a "dark …" query
// boosts dark-tagged sites even when no title literally says "dark".
export function awardThemeHint(q) {
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
export function awardExpandToken(tok) {
  const t = String(tok).toLowerCase();
  return [t, ...(AWARD_ALIASES[t] || [])];
}
export function awardStemLite(tok) {
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
export function awardScoreSites(sites, query, { technology, color } = {}) {
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
export function awardSuggestQueries(query, taxonomy) {
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
export function awardCompactSite(s, scoreInfo) {
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
export function awardFullSite(s, detail, scoreInfo) {
  const base = awardCompactSite(s, scoreInfo);
  return { ...base, description: (detail && detail.description) || null, palette: (detail && detail.palette) || [], technologies: (detail && detail.technologies) || [], elements: (detail && detail.elements) || [], awardHistory: (detail && detail.awards) || [], score: (detail && detail.score) ?? null, nominee: !!(detail && detail.nominee), retrievedAt: (detail && detail.retrievedAt) || null };
}

// awardSiteIdeas: agent-usable design ideas derived ONLY from observed
// detail fields. Every idea carries status:"suggested" + basis naming the
// evidence — never presented as observed fact.
export function awardSiteIdeas(detail) {
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

// ---- Polite fetch client (1 req/s, bounded, distinct errors) ----
export function createAwardClient({ fetchImpl, timeoutMs = AWARD_TIMEOUT_MS, rateMs = AWARD_RATE_MS, userAgent = AWARD_USER_AGENT } = {}) {
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
  async function fetchOnce(url, label) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("timeout after " + timeoutMs + "ms fetching " + label)), timeoutMs);
    try {
      const res = await fetchFn(url, { headers: { "user-agent": userAgent, accept: "text/html,*/*" }, redirect: "manual", signal: ctrl.signal });
      return res;
    } finally { clearTimeout(timer); }
  }
  async function readBounded(res, label) {
    const len = res.headers && typeof res.headers.get === "function" ? Number(res.headers.get("content-length")) : NaN;
    if (Number.isFinite(len) && len > AWARD_MAX_BYTES) throw awardUpstream(label + " exceeds " + AWARD_MAX_BYTES + " bytes");
    const text = await res.text();
    if (text && text.length > AWARD_MAX_BYTES) throw awardUpstream(label + " exceeds " + AWARD_MAX_BYTES + " bytes");
    return text || "";
  }
  async function getAwardHtml(pathOrUrl) {
    const path = awardValidateAwardPath(pathOrUrl);
    const startUrl = AWARD_BASE_URL + path;
    let url = startUrl;
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      await acquire();
      let res;
      try { res = await fetchOnce(url, "awwwards page"); }
      catch (e) {
        if (e && e.name === "AbortError") throw awardUpstream("timeout fetching " + url);
        lastErr = e;
        if (attempt < 1) { await sleep(300); continue; }
        throw awardUpstream("network error fetching " + url + ": " + String((e && e.message) || e).slice(0, 200));
      }
      if (res.status === 301 || res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308) {
        const loc = res.headers && res.headers.get ? res.headers.get("location") : null;
        if (!loc || attempt === 1) throw awardUpstream("redirect without location for " + url);
        try {
          const next = new URL(loc, url).toString();
          const nu = new URL(next);
          if (!AWARD_ALLOWED_HOSTS.includes(nu.hostname.toLowerCase())) throw awardUpstream("redirect leaves award hosts: " + nu.hostname);
          url = next;
          continue;
        } catch (e) { if (e && e.code === "UPSTREAM_ERROR") throw e; throw awardUpstream("bad redirect for " + url); }
      }
      if (res.status === 404) throw awardNotFound("awwwards page not found: " + url);
      if (res.status === 403 || res.status === 429) {
        const e = awardUpstream("awwwards is blocking requests (HTTP " + res.status + " on " + url + "). Try again later; blocks are never retried.");
        e.blocked = true;
        e.status = res.status;
        throw e;
      }
      if (res.status >= 500 && res.status < 600) {
        lastErr = awardUpstream("transient awwwards status " + res.status + " on " + url);
        if (attempt < 1) { await sleep(400); continue; }
        throw lastErr;
      }
      if (!res.ok) throw awardUpstream("awwwards HTTP " + res.status + " on " + url);
      return { html: await readBounded(res, "awwwards page"), finalUrl: url };
    }
    throw lastErr instanceof Error ? lastErr : awardUpstream("fetch failed for " + startUrl);
  }
  return { getAwardHtml };
}

// ---- Design-brief builder (pure): observed facts vs patterns vs proposals ----
export const AWARD_BLUEPRINT_VERSION = 1;
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
export function awardTechFamily(tech) {
  const t = String(tech || "").toLowerCase().trim();
  for (const f of AWARD_TECH_FAMILIES) if (f.family === t || f.members.includes(t)) return f.family;
  return t;
}
export function awardCompareSites(entries) {
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
export function awardBuildBlueprint({ goal, refs, details, auraMatches, structureNotes, motionNotes, constraints = [], technology = null, visualDirection = null, responsive = null, requestedPalette = [], gaps: extraGaps = [] }) {
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
  const sections = ["hero", "proof", "features", "showcase", "pricing", "testimonials", "faq", "cta", "footer"];
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
  for (const m of matches.slice(0, 10)) lines.push("- [" + m.section + "] `" + m.componentTitle + "` (" + m.componentId + ") — " + m.pageUrl + " — " + m.why);
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
  const spec = {
    version: AWARD_BLUEPRINT_VERSION, goal,
    refs: (refs || []).map((slug) => ({ slug, sourceUrl: awardSiteUrl(slug) })),
    sharedPatterns: shared, outliers: outliers.slice(0, 12), palette,
    requestedPalette: requestedPalette.map((c) => ({ value: c, status: "proposed" })),
    tokens_css: requestedPalette.length ? (":root{--aw-ground:" + tokenGround + ";--aw-ink:" + tokenInk + ";" + tokenAccents.map((c, i) => "--aw-accent-" + (i + 1) + ":" + c).join(";") + ";}") : "",
    auraMatches: matches.slice(0, 10),
    sections, constraints,
    confidence: usable.length >= 3 ? "medium" : usable.length === 2 ? "low-medium" : "low",
    gaps,
  };
  return { markdown: lines.join("\n"), spec };
}
