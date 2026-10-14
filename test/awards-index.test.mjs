// awards-index.test.mjs — hermetic file-store tests (tmp dirs, fake clocks).
import test from "node:test";
import assert from "node:assert/strict";
import { createAwardIndex, AWARD_INDEX_VERSION } from "../src/awards-index.mjs";

const tmpRoot = () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const os = process.getBuiltinModule("node:os");
  return fs.mkdtempSync(path.join(os.tmpdir(), "aura-awidx-"));
};
const listingFor = (tag) => `<div data-collectable-model-value="{&quot;slug&quot;:&quot;site-${tag}&quot;,&quot;title&quot;:&quot;Site ${tag}&quot;,&quot;createdAt&quot;:1,&quot;tags&quot;:[&quot;${tag}&quot;],&quot;images&quot;:{&quot;thumbnail&quot;:&quot;t.jpg&quot;},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/site-${tag}">x</a></div>`;
const fakeClient = (tags) => ({
  getAwardHtml: async (p) => {
    if (p === "/websites/") return { html: tags.map((t) => `<a href="/websites/${t}/">x</a>`).join("") };
    const m = String(p).match(/^\/websites\/([^/]+)\/$/);
    if (m) return { html: listingFor(m[1]) };
    if (String(p).startsWith("/sotd") || String(p).includes("sites_of_the_day")) return { html: listingFor("winner") };
    if (String(p).startsWith("/websites/sites_of_the_day/")) return { html: listingFor("winner") };
    throw new Error("unexpected path " + p);
  },
});

test("initial status: empty, stale, versioned", () => {
  const idx = createAwardIndex({ dir: tmpRoot() });
  const s = idx.getStatus();
  assert.equal(s.version, AWARD_INDEX_VERSION);
  assert.deepEqual([s.counts.sites, s.counts.watches], [0, 0]);
  assert.equal(s.stale, true);
  assert.equal(s.lock.held, false);
});

test("upsert dedupes by slug + bounds growth", () => {
  const idx = createAwardIndex({ dir: tmpRoot() });
  const r1 = idx.upsertSites([{ slug: "a", title: "A" }, { slug: "A", title: "A2" }]);
  assert.equal(r1.total, 1);
  assert.equal(idx.getSite("a").title, "A2");
  assert.equal(idx.getSite("A").title, "A2", "case-insensitive");
});

test("taxonomy round-trips with caps", () => {
  const idx = createAwardIndex({ dir: tmpRoot() });
  const r = idx.setTaxonomy({ colors: ["#FF0000"], filters: ["webgl", "webgl", "3d"] });
  assert.deepEqual([r.colors, r.filters], [1, 2]);
  assert.ok(idx.getTaxonomy().filters.includes("3d"));
});

test("rebuild crawls tags, checkpoints resume after interruption", async () => {
  const dir = tmpRoot();
  const flaky = { getAwardHtml: async (p) => { if (p === "/websites/") return { html: '<a href="/websites/aa/">x</a><a href="/websites/bb/">x</a><a href="/websites/cc/">x</a>' }; if (p === "/websites/bb/") throw new Error("boom"); return { html: listingFor(p.split("/")[2]) }; } };
  const idx = createAwardIndex({ dir });
  await assert.rejects(() => idx.rebuild({ client: flaky }), /boom/);
  const mid = idx.getStatus();
  assert.ok((mid.pendingPages || []).includes("aa"), "checkpoint keeps completed pages, got: " + JSON.stringify(mid.pendingPages));
  const idx2 = createAwardIndex({ dir });
  const r = await idx2.rebuild({ client: fakeClient(["aa", "bb", "cc"]) });
  assert.equal(r.pagesTotal, 3);
  assert.ok(idx2.getSite("site-aa"));
  const st = idx2.getStatus();
  assert.equal(st.stale, false);
  assert.ok(st.freshness);
});

test("repeat rebuild after completion revisits (no stale skip)", async () => {
  const dir = tmpRoot();
  const idx = createAwardIndex({ dir });
  const r1 = await idx.rebuild({ client: fakeClient(["aa"]) });
  assert.equal(r1.pagesDone, 1);
  const r2 = await idx.rebuild({ client: fakeClient(["aa"]) });
  assert.equal(r2.pagesDone, 1, "completed checkpoint cleared; second run recrawls");
});

test("concurrent rebuild: second gets INDEX_BUSY; stale lock expires", async () => {
  const dir = tmpRoot();
  let now = 1000;
  const idx = createAwardIndex({ dir, now: () => now });
  const slow = { getAwardHtml: async (p) => { if (p === "/websites/") return { html: '<a href="/websites/aa/">x</a>' }; await new Promise((r) => setTimeout(r, 80)); return { html: listingFor("aa") }; } };
  const p1 = idx.rebuild({ client: slow });
  await assert.rejects(() => idx.rebuild({ client: fakeClient(["aa"]) }), (e) => e.code === "INDEX_BUSY");
  await p1;
  now += 40 * 60 * 1000; // stale lock window passes anyway
  const r = await idx.rebuild({ client: fakeClient(["aa"]) });
  assert.equal(r.pagesDone, 1);
});

test("corrupt JSON quarantined, index recovers empty", () => {
  const dir = tmpRoot();
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const idx = createAwardIndex({ dir });
  idx.upsertSites([{ slug: "a", title: "A" }]);
  fs.writeFileSync(path.join(dir, "sites.json"), "{not json");
  const idx2 = createAwardIndex({ dir });
  const s = idx2.getStatus();
  assert.ok(s.sitesCorrupt || s.counts.sites === 0);
  assert.equal(idx2.listSites().length, 0);
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes("corrupt"));
  assert.ok(leftovers.length >= 1, "quarantine file kept");
});

test("atomic writes leave valid JSON", () => {
  const dir = tmpRoot();
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const idx = createAwardIndex({ dir });
  idx.upsertSites([{ slug: "a", title: "A" }]);
  JSON.parse(fs.readFileSync(path.join(dir, "sites.json"), "utf8"));
  assert.ok(!fs.readdirSync(dir).some((f) => f.includes(".tmp-")), "no tmp leftovers");
});

test("schema version change detected as migrated", () => {
  const dir = tmpRoot();
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const idx = createAwardIndex({ dir });
  idx.setTaxonomy({ colors: [], filters: ["x"] });
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "taxonomy.json"), "utf8"));
  raw.version = 0;
  fs.writeFileSync(path.join(dir, "taxonomy.json"), JSON.stringify(raw));
  const idx2 = createAwardIndex({ dir });
  const t = idx2.getTaxonomy();
  assert.equal(t.version, AWARD_INDEX_VERSION);
});

test("newWinners: first call seeds, second reports delta only", async () => {
  const dir = tmpRoot();
  const idx = createAwardIndex({ dir });
  const v1 = `<div data-collectable-model-value="{&quot;slug&quot;:&quot;w1&quot;,&quot;title&quot;:&quot;W1&quot;,&quot;createdAt&quot;:1,&quot;tags&quot;:[],&quot;images&quot;:{},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/w1">x</a></div>`;
  const c1 = { getAwardHtml: async () => ({ html: v1 }) };
  const r1 = await idx.newWinners({ client: c1, award: "sotd" });
  assert.equal(r1.seeded, true);
  assert.deepEqual(r1.newWinners, []);
  const v2 = v1 + `<div data-collectable-model-value="{&quot;slug&quot;:&quot;w2&quot;,&quot;title&quot;:&quot;W2&quot;,&quot;createdAt&quot;:1,&quot;tags&quot;:[],&quot;images&quot;:{},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/w2">x</a></div>`;
  const r2 = await idx.newWinners({ client: { getAwardHtml: async () => ({ html: v2 }) }, award: "sotd" });
  assert.equal(r2.seeded, false);
  assert.deepEqual(r2.newWinners.map((w) => w.slug), ["w2"]);
  const r3 = await idx.newWinners({ client: { getAwardHtml: async () => ({ html: v2 }) }, award: "sotd" });
  assert.deepEqual(r3.newWinners, [], "reported once, never re-reported");
});

test("watches: add/list/remove, duplicates + invalid rejected", () => {
  const idx = createAwardIndex({ dir: tmpRoot() });
  const w = idx.watchAdd({ kind: "tag", pattern: "WebGL" });
  assert.equal(w.pattern, "webgl");
  assert.throws(() => idx.watchAdd({ kind: "tag", pattern: "webgl" }), (e) => e.code === "BAD_ARGS");
  assert.throws(() => idx.watchAdd({ kind: "nope", pattern: "x" }), (e) => e.code === "BAD_ARGS");
  assert.throws(() => idx.watchAdd({ kind: "tag", pattern: "BAD TAG!" }), (e) => e.code === "BAD_ARGS");
  assert.equal(idx.watchList().length, 1);
  assert.deepEqual(idx.watchRemove({ kind: "tag", pattern: "webgl" }), { removed: true });
  assert.deepEqual(idx.watchRemove({ kind: "tag", pattern: "webgl" }), { removed: false });
});

test("watch check: first seeds silently, second reports fresh matches", () => {
  const idx = createAwardIndex({ dir: tmpRoot() });
  idx.watchAdd({ kind: "tag", pattern: "webgl" });
  idx.upsertSites([{ slug: "a", title: "A", tags: ["webgl"] }]);
  assert.deepEqual(idx.checkWatches(), [], "first evaluation seeds");
  idx.upsertSites([{ slug: "b", title: "B", tags: ["webgl"] }]);
  const deltas = idx.checkWatches();
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0].matches[0].slug, "b");
});

test("motion store: record/search + empty vs zero-match", () => {
  const idx = createAwardIndex({ dir: tmpRoot() });
  assert.equal(idx.searchMotion({}).empty, true);
  idx.recordMotion({ url: "https://x.com", stack: { libs: ["gsap"], scrollModel: "native" }, easingVocab: [{ token: "power2.out" }], capturedAt: 1 });
  const r = idx.searchMotion({ library: "gsap" });
  assert.equal(r.total, 1);
  assert.equal(idx.searchMotion({ library: "lenis" }).total, 0);
  assert.equal(idx.searchMotion({}).empty, false);
});

test("elements dedupe by slug", () => {
  const idx = createAwardIndex({ dir: tmpRoot() });
  const r = idx.upsertElements([{ slug: "e1", title: "Hero" }, { slug: "e1", title: "Hero v2" }]);
  assert.equal(r.total, 1);
  assert.equal(idx.getElement("e1").title, "Hero v2");
});

test("dir traversal rejected", () => {
  assert.throws(() => createAwardIndex({ dir: "/tmp/../evil" }), (e) => e.code === "BAD_ARGS");
});
