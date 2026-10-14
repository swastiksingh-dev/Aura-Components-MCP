// Module: awards-index — persistent local award-reference store.
// File-based JSON (no sqlite dep): atomic writes, versioned schema,
// corrupt recovery, stale-lock single-writer, resume checkpoints, bounded
// growth, winner baselines, watches, motion records. No auto-crawl on boot.
import { awardErr, awardNormalizeSlug, awardParseCategories, awardParseListing, AWARD_SCHEMA_VERSION, AWARD_FILTERS } from './awards.mjs';

export const AWARD_INDEX_VERSION = 1;
export const AWARD_INDEX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
export const AWARD_LOCK_STALE_MS = 30 * 60 * 1000;
export const AWARD_MAX_SITES = 5000;
export const AWARD_MAX_ELEMENTS = 5000;
export const AWARD_MAX_MOTION = 200;
const AWARD_FILES = ["sites.json", "elements.json", "taxonomy.json", "motion.json", "meta.json"];

function awardIdxBuiltins() {
  const g = globalThis.process && globalThis.process.getBuiltinModule ? globalThis.process.getBuiltinModule : null;
  if (typeof g !== "function") throw awardErr("UNSUPPORTED_OPERATION", "file persistence needs Node 22+ (process.getBuiltinModule)");
  const fs = g.call(globalThis.process, "node:fs");
  const path = g.call(globalThis.process, "node:path");
  const os = g.call(globalThis.process, "node:os");
  return { fs, path, os };
}
export function awardResolveDir(override) {
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

export function createAwardIndex({ dir, now = () => Date.now() } = {}) {
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
  const emptyMeta = () => ({ version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), indexStatus: null, progress: [], baselines: {}, watches: [] });

  function siteMap() {
    const doc = readJson("sites.json", emptySites());
    const map = new Map();
    for (const s of (doc.items || [])) if (s && s.slug) map.set(String(s.slug).toLowerCase(), s);
    return { doc, map };
  }
  function acquireLock() {
    const lockFile = path.join(root, "lock.json");
    try {
      if (fs.existsSync(lockFile)) {
        const prev = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        if (prev && (now() - (prev.startedAt || 0)) < AWARD_LOCK_STALE_MS) {
          const e = awardErr("INDEX_BUSY", "another index run is in progress (lock held since " + new Date(prev.startedAt).toISOString() + ")");
          throw e;
        }
      }
    } catch (e) { if (e && e.code === "INDEX_BUSY") throw e; /* corrupt lock treated as stale */ }
    fs.writeFileSync(lockFile, JSON.stringify({ startedAt: now(), pid: (globalThis.process && globalThis.process.pid) || 0 }), "utf8");
  }
  function releaseLock() { try { fs.rmSync(path.join(root, "lock.json"), { force: true }); } catch { /* never mask */ } }

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
      return {
        dir: root, version: AWARD_INDEX_VERSION,
        counts: { sites: (sites.items || []).length, elements: (elements.items || []).length, motion: (motion.items || []).length, taxonomyFilters: (tax.filters || []).length, taxonomyColors: (tax.colors || []).length, watches: (meta.watches || []).length },
        freshness, stale: !finishedAt || (now() - finishedAt >= AWARD_INDEX_STALE_MS),
        progress: meta.indexStatus || null, pendingPages: meta.progress || [],
        lock: lock ? { held: true, since: lock.startedAt ? new Date(lock.startedAt).toISOString() : null } : { held: false },
        ...(sites.corrupt ? { sitesCorrupt: sites.corrupt } : {}),
        ...(meta.corrupt ? { metaCorrupt: meta.corrupt } : {}),
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
    upsertSites(sites) {
      const { doc, map } = siteMap();
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
    },
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
    async rebuild({ client, tags, log = () => {} } = {}) {
      if (!client || typeof client.getAwardHtml !== "function") throw awardIdxBad("rebuild needs an award client");
      acquireLock();
      const startedAt = now();
      try {
        let meta = readJson("meta.json", emptyMeta());
        let tax = readJson("taxonomy.json", emptyTax());
        if ((!tax.filters || !tax.filters.length)) {
          const { html } = await client.getAwardHtml("/websites/");
          tax = { version: AWARD_INDEX_VERSION, updatedAt: new Date(now()).toISOString(), ...awardParseCategories(html) };
          if (!(tax.filters || []).length) throw awardErr("UPSTREAM_ERROR", "awwwards layout may have changed: parsed 0 categories");
          writeAtomic("taxonomy.json", tax);
        }
        const wanted = Array.isArray(tags) && tags.length ? tags.map(String).slice(0, 200) : (tax.filters || []).slice(0, 200);
        if (!wanted.length) throw awardErr("UPSTREAM_ERROR", "no taxonomy to crawl; index has no filters");
        const done = new Set(meta.progress || []);
        // Completed checkpoint from a prior cycle is not resumable work.
        if (meta.indexStatus && meta.indexStatus.finishedAt && done.size >= (meta.indexStatus.pagesTotal || 0)) { meta.progress = []; done.clear(); }
        let pagesDone = 0, sitesIndexed = 0;
        const skipped = [...wanted].filter((t) => done.has(t)).length;
        for (const tag of wanted) {
          if (done.has(tag)) continue;
          const { html } = await client.getAwardHtml("/websites/" + encodeURIComponent(tag) + "/");
          const sites = awardParseListing(html);
          if (!sites.length) throw awardErr("UPSTREAM_ERROR", "awwwards layout may have changed: 0 cards on /websites/" + tag + "/");
          this.upsertSites(sites.map((s) => ({ ...s, tags: [...new Set([...(s.tags || []), tag])] })));
          sitesIndexed += sites.length;
          pagesDone++;
          done.add(tag);
          meta = readJson("meta.json", emptyMeta());
          meta.progress = [...done];
          meta.updatedAt = new Date(now()).toISOString();
          writeAtomic("meta.json", meta);
          log("[" + done.size + "/" + wanted.length + "] " + tag + ": " + sites.length + " sites");
        }
        meta = readJson("meta.json", emptyMeta());
        meta.indexStatus = { startedAt, finishedAt: now(), pagesDone: done.size, pagesTotal: wanted.length, sitesIndexed };
        meta.progress = [];
        meta.updatedAt = new Date(now()).toISOString();
        writeAtomic("meta.json", meta);
        return { pagesDone, pagesTotal: wanted.length, sitesIndexed, skipped };
      } catch (e) {
        try {
          const meta = readJson("meta.json", emptyMeta());
          meta.indexStatus = { ...(meta.indexStatus || {}), lastError: String((e && e.message) || e).slice(0, 300) };
          writeAtomic("meta.json", meta);
        } catch { /* never mask */ }
        throw e;
      } finally { releaseLock(); }
    },
    async resume(args) { return this.rebuild(args); },
    async refresh(args) {
      const meta = readJson("meta.json", emptyMeta());
      meta.progress = [];
      writeAtomic("meta.json", meta);
      return this.rebuild(args);
    },
    // Winners: baseline seed then delta (never fabricate dates).
    async newWinners({ client, award = "sotd" } = {}) {
      if (!client || typeof client.getAwardHtml !== "function") throw awardIdxBad("newWinners needs an award client");
      if (!AWARD_FILTERS[award]) throw awardIdxBad("award must be sotd|developer|honorable");
      const { html } = await client.getAwardHtml("/" + AWARD_FILTERS[award] + "/");
      const parsed = awardParseListing(html);
      const meta = readJson("meta.json", emptyMeta());
      const key = "baseline_" + award;
      const prev = meta.baselines && meta.baselines[key];
      const day = new Date(now()).toISOString().slice(0, 10);
      if (!prev) {
        meta.baselines = { ...(meta.baselines || {}), [key]: { slugs: parsed.map((s) => s.slug), at: new Date(now()).toISOString() } };
        writeAtomic("meta.json", meta);
        this.upsertSites(parsed);
        return { day, seeded: true, newWinners: [], totalInListing: parsed.length, note: "baseline seeded; no historical delta available yet" };
      }
      const seen = new Set(prev.slugs || []);
      const fresh = parsed.filter((s) => !seen.has(s.slug));
      meta.baselines[key] = { slugs: parsed.map((s) => s.slug), at: new Date(now()).toISOString() };
      writeAtomic("meta.json", meta);
      if (parsed.length) this.upsertSites(parsed);
      return { day, seeded: false, newWinners: fresh, totalInListing: parsed.length };
    },
    watchAdd({ kind, pattern, award } = {}) {
      if (!["studio", "tag", "url"].includes(kind)) throw awardIdxBad("watch kind must be studio|tag|url");
      if (typeof pattern !== "string" || !pattern.trim() || pattern.length > 120) throw awardIdxBad("watch pattern must be 1-120 chars");
      const clean = pattern.trim().toLowerCase();
      if (kind === "url") awardNormalizeSlug(clean);
      if (kind === "tag" && !/^[a-z0-9-]{2,60}$/.test(clean)) throw awardIdxBad("tag watch must be a slug like 'webgl'");
      if (award !== undefined && !["sotd", "developer", "honorable"].includes(award)) throw awardIdxBad("watch award must be sotd|developer|honorable");
      const meta = readJson("meta.json", emptyMeta());
      const watches = meta.watches || [];
      if (watches.some((w) => w.kind === kind && w.pattern === clean)) throw awardIdxBad("duplicate watch: " + kind + ":" + clean);
      if (watches.length >= 50) throw awardIdxBad("too many watches (max 50)");
      const rec = { kind, pattern: clean, award: award || null, createdAt: new Date(now()).toISOString(), lastCheckedAt: null, lastSlugs: null };
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
      const before = (meta.watches || []).length;
      meta.watches = (meta.watches || []).filter((w) => !(w.kind === kind && w.pattern === clean));
      writeAtomic("meta.json", meta);
      return { removed: (meta.watches.length < before) };
    },
    checkWatches() {
      const meta = readJson("meta.json", emptyMeta());
      const { map } = siteMap();
      const rows = [...map.values()];
      const out = [];
      const watches = (meta.watches || []).map((w) => ({ ...w }));
      for (const w of watches) {
        const hits = rows.filter((s) => {
          if (w.kind === "url") return String(s.slug) === w.pattern;
          if (w.kind === "studio") return String(s.studio || "").toLowerCase().includes(w.pattern);
          return (s.tags || []).some((t) => String(t).toLowerCase().replace(/\W+/g, "-") === w.pattern);
        });
        const slugs = hits.map((s) => s.slug).sort();
        if (w.lastSlugs === null || w.lastSlugs === undefined) {
          w.lastCheckedAt = new Date(now()).toISOString();
          w.lastSlugs = slugs;
          continue;
        }
        const prev = new Set(w.lastSlugs || []);
        const fresh = hits.filter((s) => !prev.has(s.slug));
        w.lastCheckedAt = new Date(now()).toISOString();
        w.lastSlugs = slugs;
        if (fresh.length) out.push({ watch: { kind: w.kind, pattern: w.pattern }, matches: fresh.map((s) => ({ slug: s.slug, title: s.title, sourceUrl: s.sourceUrl })) });
      }
      meta.watches = watches;
      writeAtomic("meta.json", meta);
      return out;
    },
  };
}
