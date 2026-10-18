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
export const AWARD_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 aura-components-mcp/1.7.3";
export const AWARD_ALLOWED_HOSTS = ["www.awwwards.com", "awwwards.com", "assets.awwwards.com"];
export const AWARD_TIMEOUT_MS = 10000;
export const AWARD_MAX_BYTES = 2 * 1024 * 1024;
export const AWARD_RATE_MS = 1000;
export const AWARD_FILTERS = { sotd: "websites/sites_of_the_day", developer: "websites/developer", honorable: "websites/honorable" };
export const AWARD_FILTER_NAMES = ["sotd", "developer", "honorable"];
export const AWARD_SECTIONS = ["hero", "proof", "features", "showcase", "pricing", "testimonials", "faq", "cta", "footer"];

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
// Watches of kind "url" target a site slug. Accept either a bare slug or a
// canonical Awwwards site URL and reduce both to the same slug, so a stored
// watch always compares equal to the indexed slug (legacy raw-URL records
// are normalized at match time too).
export function awardWatchTargetSlug(raw) {
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
export function awardParseIpv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s || ""));
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return awardIpv4Number(parts[0], parts[1], parts[2], parts[3]);
}
export function awardClassifyIpv4(n) {
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
export function awardParseIpv6(s) {
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
export function awardClassifyIpv6(bytes) {
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
export function awardClassifyHost(hostname) {
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
export function awardIsBlockedHost(hostname) {
  return awardClassifyHost(hostname).kind !== "public";
}
export function awardValidateHttpUrl(raw, { allowLocal = false } = {}) {
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
export async function awardCheckHostResolution(rawUrl, { lookup = null, allowLocal = false, timeoutMs = 1500 } = {}) {
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
// Bump when the listing parser's expectations about upstream markup change;
// diagnostics carry it so callers can tell "page is empty" from "parser can
// no longer read the page" without guessing.
export const AWARD_PARSER_VERSION = 1;
const AWARD_FIELD_BOUNDS = { slug: 120, title: 200, tag: 40, tags: 20, studio: 120, liveUrl: 500, thumb: 500 };
function awardBoundStr(v, max) { return String(v ?? "").slice(0, max); }
export function awardParseListingEx(html) {
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
export function awardParseListing(html) {
  return awardParseListingEx(html).sites;
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
// evidence — never presented as observed fact. Count contract: 0–6 ideas
// depending on how much evidence the detail holds (1 idea on thin evidence
// is valid, not a failure); null detail yields [].
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

// ---- Bounded body reader ----
// Reads at most maxBytes from a fetch Response without trusting
// content-length: a streaming read stops as soon as the threshold is
// crossed, so a missing or lying header cannot balloon memory. Falls back
// to res.text() (with a size post-check) when the response exposes no byte
// stream, which keeps plain test doubles working.
export async function awardReadBoundedBody(res, maxBytes, label = "response") {
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
export function awardStaticSummary(slug, st) {
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
export async function awardFetchGuardedHtml(rawUrl, { fetchImpl, lookup = null, timeoutMs = AWARD_TIMEOUT_MS, maxBytes = 1500000, allowLocal = false, label = "page" } = {}) {
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
export async function awardStaticMotion(rawUrl, { fetchImpl, lookup = null, timeoutMs = AWARD_TIMEOUT_MS, maxBytes = 1500000, allowLocal = false } = {}) {
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
export function awardBuildBlueprint({ goal, refs, details, auraMatches, structureNotes, motionNotes, motionRecorded = false, constraints = [], technology = null, visualDirection = null, responsive = null, requestedPalette = [], gaps: extraGaps = [] }) {
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
