// award-watches.test.mjs — watch add/list/remove semantics: slug+legacy url
// normalization, tag/studio matching, and checkWatchesDetailed seeding
// disclosure (deltas-only shape stays pinned for checkWatches).
import test from "node:test";
import assert from "node:assert/strict";
import { createAwardIndex } from "../src/awards-index.mjs";

const tmpDir = () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const os = process.getBuiltinModule("node:os");
  return fs.mkdtempSync(path.join(os.tmpdir(), "aura-watch-"));
};

test("url watches normalize canonical URLs and bare slugs to one target", () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  const w = idx.watchAdd({ kind: "url", pattern: "https://www.awwwards.com/sites/Aspen-Search/" });
  assert.equal(w.pattern, "aspen-search");
  assert.equal(w.input, "https://www.awwwards.com/sites/Aspen-Search/", "original input disclosed");
  const dup = (() => { try { idx.watchAdd({ kind: "url", pattern: "aspen-search" }); return null; } catch (e) { return e; } })();
  assert.ok(dup && /duplicate/.test(dup.message), "the slug form is the same watch");
  const offHost = (() => { try { idx.watchAdd({ kind: "url", pattern: "https://evil.example/sites/x" }); return null; } catch (e) { return e; } })();
  assert.ok(offHost && /awwwards\.com/.test(offHost.message));
  const badPath = (() => { try { idx.watchAdd({ kind: "url", pattern: "https://www.awwwards.com/inspiration/x" }); return null; } catch (e) { return e; } })();
  assert.ok(badPath && /sites/.test(badPath.message));
});

test("watch arg validation: kind, pattern, award", () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  assert.throws(() => idx.watchAdd({ kind: "nope", pattern: "x" }), (e) => e.code === "BAD_ARGS");
  assert.throws(() => idx.watchAdd({ kind: "tag", pattern: "" }), (e) => e.code === "BAD_ARGS");
  assert.throws(() => idx.watchAdd({ kind: "tag", pattern: "Web GL!" }), (e) => e.code === "BAD_ARGS");
  assert.throws(() => idx.watchAdd({ kind: "studio", pattern: "x".repeat(200) }), (e) => e.code === "BAD_ARGS");
  assert.throws(() => idx.watchAdd({ kind: "studio", pattern: "frog", award: "bogus" }), (e) => e.code === "BAD_ARGS");
});

test("watch matching: url watches match the slug; tag/studio normalize case and separators", () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  idx.watchAdd({ kind: "url", pattern: "https://www.awwwards.com/sites/aspen-search" });
  idx.watchAdd({ kind: "tag", pattern: "webgl" });
  idx.watchAdd({ kind: "studio", pattern: "frog" });
  idx.upsertSites([
    { slug: "aspen-search", title: "Aspen", tags: ["minimal"], studio: "Some Studio" },
    { slug: "webgl-play", title: "Play", tags: ["WebGL", "3D"], studio: "Frog Design" },
  ]);
  const first = idx.checkWatchesDetailed();
  assert.deepEqual(first.deltas, [], "first check seeds silently, no deltas");
  assert.equal(first.seeded.length, 3, "every seeded watch is disclosed");
  const seededUrl = first.seeded.find((s) => s.watch.kind === "url");
  assert.deepEqual(seededUrl.baselineMatches.map((m) => m.slug), ["aspen-search"]);
  idx.upsertSites([{ slug: "frog-new", title: "New", tags: ["webgl"], studio: "Frog", sourceUrl: "https://www.awwwards.com/sites/frog-new" }]);
  const second = idx.checkWatchesDetailed();
  assert.equal(second.seeded.length, 0, "seeding happens once");
  assert.equal(second.deltas.find((d) => d.watch.kind === "url"), undefined, "aspen-search already in baseline");
  const tagDelta = second.deltas.find((d) => d.watch.kind === "tag");
  assert.deepEqual(tagDelta.matches.map((m) => m.slug), ["frog-new"]);
  assert.equal(tagDelta.matches[0].sourceUrl, "https://www.awwwards.com/sites/frog-new");
  const studioDelta = second.deltas.find((d) => d.watch.kind === "studio");
  assert.deepEqual(studioDelta.matches.map((m) => m.slug), ["frog-new"]);
  idx.upsertSites([{ slug: "another-webgl", title: "W2", tags: ["webgl"] }]);
  const deltas = idx.checkWatches();
  assert.equal(deltas.length, 1, "deltas-only shape preserved");
  assert.equal(deltas[0].watch.kind, "tag");
  assert.equal(idx.checkWatchesDetailed().deltas.length, 0, "second call is a no-op");
});

test("watch_remove accepts the canonical slug for legacy raw-url records", () => {
  const dir = tmpDir();
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
    version: 1, updatedAt: new Date().toISOString(),
    watches: [{ kind: "url", pattern: "https://www.awwwards.com/sites/legacy-one", award: null, createdAt: "x", lastCheckedAt: null, lastSlugs: null }],
  }));
  const idx = createAwardIndex({ dir });
  assert.equal(idx.watchRemove({ kind: "url", pattern: "legacy-one" }).removed, true, "canonical slug removes the legacy record");
  assert.equal(idx.watchList().length, 0);
});

test("legacy url watch records still match the canonical slug at check time", () => {
  const dir = tmpDir();
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
    version: 1, updatedAt: new Date().toISOString(),
    watches: [{ kind: "url", pattern: "https://www.awwwards.com/sites/legacy-two", award: null, createdAt: "x", lastCheckedAt: null, lastSlugs: null }],
  }));
  const idx = createAwardIndex({ dir });
  idx.upsertSites([{ slug: "legacy-two", title: "L2", tags: [] }]);
  const det = idx.checkWatchesDetailed();
  assert.equal(det.seeded.length, 1);
  assert.deepEqual(det.seeded[0].baselineMatches.map((m) => m.slug), ["legacy-two"]);
});

test("watches cap at 50 with a named error", () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  for (let i = 0; i < 50; i++) idx.watchAdd({ kind: "tag", pattern: "tag-" + i });
  assert.throws(() => idx.watchAdd({ kind: "tag", pattern: "one-too-many" }), (e) => e.code === "BAD_ARGS" && /max 50/.test(e.message));
});
