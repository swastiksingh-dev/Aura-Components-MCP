// award-index-lifecycle.test.mjs — plan-based crawl cycles: bounded budgets,
// resume semantics, refresh, locking, legacy checkpoint adoption, and the
// drift/empty guards that protect the newWinners baseline.
import test from "node:test";
import assert from "node:assert/strict";
import { createAwardIndex } from "../src/awards-index.mjs";

const tmpDir = () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const os = process.getBuiltinModule("node:os");
  return fs.mkdtempSync(path.join(os.tmpdir(), "aura-aidx-"));
};
const card = (slug, extra = "") => `<div data-collectable-model-value="{&quot;slug&quot;:&quot;${slug}&quot;,&quot;title&quot;:&quot;T ${slug}&quot;,&quot;createdAt&quot;:1,&quot;tags&quot;:[&quot;aa&quot;],&quot;images&quot;:{},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/${slug}">x</a>${extra}</div>`;
const tagsPage = (tags) => `<html><body>${tags.map((t) => `<a href="/websites/${t}/">x</a>`).join("")}</body></html>`;
const DRIFT_HTML = '<html><body><div data-collectable-model-value="{broken json</div></body></html>';

function planClient(tags) {
  const fetched = [];
  return {
    fetched,
    getAwardHtml: async (raw) => {
      fetched.push(String(raw));
      if (raw === "/websites/") return { html: tagsPage(tags) };
      const m = String(raw).match(/^\/websites\/([a-z0-9-]+)\/$/);
      if (m) return { html: card("site-" + m[1]) };
      throw new Error("unexpected " + raw);
    },
  };
}

test("bounded cycle: maxPages caps fetches per call; resume continues the same plan", async () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  const tags = ["aa", "bb", "cc", "dd", "ee", "ff"];
  idx.setTaxonomy({ colors: [], filters: tags });
  const client = planClient(tags);
  const r1 = await idx.rebuild({ client, maxPages: 5 });
  assert.equal(r1.pagesTotal, 6);
  assert.equal(r1.pagesDone, 5);
  assert.equal(r1.complete, false);
  assert.equal(r1.continued, false);
  assert.match(r1.note, /budget|resume/);
  assert.equal(client.fetched.filter((u) => u.startsWith("/websites/") && u !== "/websites/").length, 5, "taxonomy exists: no bootstrap fetch, exactly the budget");
  const st1 = idx.getStatus();
  assert.equal(st1.crawl.pagesDone, 5);
  assert.equal(st1.crawl.complete, false);
  assert.deepEqual(st1.pendingPages, tags.slice(0, 5));

  client.fetched.length = 0;
  const r2 = await idx.resume({ client, maxPages: 5 });
  assert.deepEqual(client.fetched, ["/websites/ff/"]);
  assert.equal(r2.pagesDone, 1);
  assert.equal(r2.completedPages, 6);
  assert.equal(r2.complete, true);
  assert.equal(r2.continued, true);
  assert.match(r2.note, /complete/);

  client.fetched.length = 0;
  const r3 = await idx.resume({ client, maxPages: 5 });
  assert.deepEqual(client.fetched, [], "resume after completion is an explicit no-op");
  assert.equal(r3.pagesDone, 0);
  assert.equal(r3.complete, true);
  assert.equal(r3.continued, false);
  assert.match(r3.note, /already complete/);

  const r4 = await idx.refresh({ client, maxPages: 20 });
  assert.equal(r4.complete, true);
  assert.equal(r4.continued, false);
  assert.ok(r4.crawl.cycle >= 2, "refresh starts a new cycle");
});

test("bootstrap: empty taxonomy is fetched once, then crawl uses it", async () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  const client = planClient(["aa", "bb"]);
  const r = await idx.rebuild({ client, maxPages: 10 });
  assert.equal(r.pagesTotal, 2);
  assert.equal(r.complete, true);
  assert.deepEqual(client.fetched, ["/websites/", "/websites/aa/", "/websites/bb/"]);
  assert.deepEqual(idx.getStatus().counts.taxonomyFilters, 2);
});

test("cycle lock: concurrent run rejected with INDEX_BUSY; stale lock expires", async () => {
  const dir = tmpDir();
  const idx = createAwardIndex({ dir });
  idx.setTaxonomy({ colors: [], filters: ["aa"] });
  let release;
  const gate = new Promise((r) => { release = r; });
  const slowClient = { getAwardHtml: async () => { await gate; return { html: card("s1") }; } };
  const p = idx.rebuild({ client: slowClient, maxPages: 1 });
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(() => idx.resume({ client: slowClient, maxPages: 1 }), (e) => e.code === "INDEX_BUSY");
  release();
  await p;
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  fs.writeFileSync(path.join(dir, "lock.json"), JSON.stringify({ startedAt: Date.now() - 31 * 60 * 1000, pid: 1 }));
  const r = await idx.resume({ client: { getAwardHtml: async () => ({ html: card("s2") }) }, maxPages: 1 });
  assert.equal(r.complete, true, "stale lock did not block the run");
  assert.equal(fs.existsSync(path.join(dir, "lock.json")), false, "lock released after the run");
});

test("collector drift: rebuild throws named UPSTREAM_ERROR, checkpoint kept", async () => {
  const dir = tmpDir();
  const idx = createAwardIndex({ dir });
  idx.setTaxonomy({ colors: [], filters: ["aa", "bb"] });
  let calls = 0;
  const client = { getAwardHtml: async () => { calls++; return { html: calls === 1 ? card("s1") : DRIFT_HTML }; } };
  await assert.rejects(() => idx.rebuild({ client, maxPages: 5 }), (e) => e.code === "UPSTREAM_ERROR" && /collector drift/.test(e.message));
  const st = idx.getStatus();
  assert.deepEqual(st.pendingPages, ["aa"], "checkpoint before the drift page kept");
  assert.equal((idx.getSite("s1") || {}).slug, "s1", "sites before the drift page are indexed");
  assert.match(st.progress.lastError, /collector drift/);
});

test("legitimately empty/filtered tag pages do not abort the cycle", async () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  idx.setTaxonomy({ colors: [], filters: ["quiet", "noisy"] });
  const client = {
    getAwardHtml: async (raw) => {
      if (String(raw).includes("quiet")) return { html: '<div data-collectable-model-value="{&quot;slug&quot;:&quot;c1&quot;,&quot;title&quot;:&quot;C1&quot;,&quot;type&quot;:&quot;collection&quot;}"><a href="/sites/c1">x</a></div>' };
      return { html: card("n1") };
    },
  };
  const r = await idx.rebuild({ client, maxPages: 10 });
  assert.equal(r.complete, true);
  assert.equal(r.completedPages, 2);
  assert.ok(idx.getSite("n1"));
});

test("legacy checkpoint adoption: completed pages are not re-fetched", async () => {
  const dir = tmpDir();
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), progress: ["aa"], watches: [] }));
  const idx = createAwardIndex({ dir });
  idx.setTaxonomy({ colors: [], filters: ["aa", "bb"] });
  const client = planClient(["aa", "bb"]);
  const r = await idx.rebuild({ client, maxPages: 20 });
  assert.deepEqual(client.fetched, ["/websites/bb/"]);
  assert.equal(r.completedPages, 2);
  assert.equal(r.complete, true);
  assert.equal(r.continued, false, "legacy adoption creates a new plan — adopted checkpoints are reported via completedPages");
});

test("new winners: drift and filtered-empty listings never wipe the baseline", async () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  const v1 = card("w1");
  const good = { getAwardHtml: async () => ({ html: v1 }) };
  const seed = await idx.newWinners({ client: good, award: "sotd" });
  assert.equal(seed.seeded, true);
  assert.equal(seed.parser.parserVersion >= 1, true);

  const drift = await idx.newWinners({ client: { getAwardHtml: async () => ({ html: DRIFT_HTML }) }, award: "sotd" });
  assert.equal(drift.degraded, true);
  assert.deepEqual(drift.newWinners, []);
  assert.equal(drift.parser.verdict, "drift-empty");
  assert.match(drift.note, /baseline preserved/);

  const filtered = await idx.newWinners({ client: { getAwardHtml: async () => ({ html: '<div data-collectable-model-value="{&quot;slug&quot;:&quot;c1&quot;,&quot;title&quot;:&quot;C1&quot;,&quot;type&quot;:&quot;collection&quot;}"><a href="/sites/c1">x</a></div>' }) }, award: "sotd" });
  assert.equal(filtered.degraded, true);
  assert.match(filtered.note, /previous baseline/);

  const again = await idx.newWinners({ client: good, award: "sotd" });
  assert.deepEqual(again.newWinners, [], "w1 is not re-reported after degraded calls");

  const delta = await idx.newWinners({ client: { getAwardHtml: async () => ({ html: v1 + card("w2") }) }, award: "sotd" });
  assert.deepEqual(delta.newWinners.map((s) => s.slug), ["w2"]);
  assert.equal(delta.degraded, undefined);
});

test("new winners: a fresh index seeds an honest empty baseline on filtered markup", async () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  const filtered = { getAwardHtml: async () => ({ html: '<div data-collectable-model-value="{&quot;slug&quot;:&quot;c1&quot;,&quot;title&quot;:&quot;C1&quot;,&quot;type&quot;:&quot;collection&quot;}"><a href="/sites/c1">x</a></div>' }) };
  const seeded = await idx.newWinners({ client: filtered, award: "sotd" });
  assert.equal(seeded.seeded, true);
  assert.match(seeded.note, /baseline seeded empty/);
  assert.equal(seeded.degraded, undefined, "an understood empty listing is not drift");
});
