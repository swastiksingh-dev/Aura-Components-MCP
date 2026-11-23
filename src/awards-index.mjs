// Module: awards-index — persistent local award-reference store.
// File-based JSON (no sqlite dep): atomic writes, versioned schema,
// corrupt recovery, stale-lock single-writer, resume checkpoints, bounded
// growth, winner baselines, watches, motion records. No auto-crawl on boot.
import { awardErr, awardNormalizeSlug, awardWatchTargetSlug, awardParseCategories, awardParseListingEx, AWARD_PARSER_VERSION, AWARD_SCHEMA_VERSION, AWARD_FILTERS } from './awards.mjs';

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
// url watches may be stored canonically (slug) or as legacy raw records
// (the old code stored the lowercased URL); both reduce to the same target
// at match time so legacy entries keep working.
function awardUrlWatchTarget(pattern) {
  try { return awardWatchTargetSlug(pattern); } catch { return String(pattern || "").trim().toLowerCase(); }
}

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
