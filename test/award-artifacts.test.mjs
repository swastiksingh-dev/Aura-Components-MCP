// award-artifacts.test.mjs — browser artifact lifecycle: post-navigation URL
// guard, honest artifactPath/artifactNote, tmp retention (captures keep-20,
// motion dirs >24h), and encodeWebm frame validation. All hermetic: fake CDP
// socket + fake Chrome spawn; retention sandboxes TMP/TEMP.
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserAdapter, cdpPruneOldFiles, cdpPruneOldDirs } from "../src/browser-cdp.mjs";

const req = (name) => process.getBuiltinModule(name);
const tmpDir = () => req("node:fs").mkdtempSync(req("node:path").join(req("node:os").tmpdir(), "aura-art-"));

// Fake CDP page socket. `href` is what location.href reports after navigation:
// a string simulates a real committed URL; null simulates a non-string value
// (test doubles / detached contexts) that the guard must skip.
function pageSocket({ href = null, sent = [] } = {}) {
  return class {
    constructor() { this.sent = sent; setTimeout(() => this.onopen && this.onopen(), 0); }
    send(s) {
      const m = JSON.parse(s);
      sent.push(m.method);
      const reply = (result) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ id: m.id, result }) }), 0);
      if (m.method === "Page.navigate") {
        reply({ loaderId: "L1" });
        setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ method: "Page.loadEventFired", params: {} }) }), 5);
      } else if (m.method === "Runtime.evaluate") {
        if (m.params && m.params.expression === "location.href" && href !== null) reply({ result: { type: "string", value: href } });
        else reply({ result: { type: "object", value: { title: "T", totalHeight: 900, candidates: [] } } });
      } else if (m.method === "Page.captureScreenshot") reply({ data: "iVBORw0KGgo=" });
      else reply({});
    }
    close() {}
  };
}
const mkAdapter = (href, sent = []) => createBrowserAdapter({
  chromePath: process.execPath,
  fetchImpl: async (url) => {
    if (String(url).includes("/json/version")) return { ok: true, json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:1/browser" }) };
    if (String(url).includes("/json/list")) return { ok: true, json: async () => [{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:1/page" }] };
    if (String(url).includes("/json/new")) return { ok: false, status: 404 };
    throw new Error("unexpected fetch " + url);
  },
  socketImpl: pageSocket({ href, sent }),
  spawnImpl: { spawn: () => ({ once() {}, kill() {}, exitCode: null }) },
});
// Sandbox os.tmpdir() (Windows honors TMP/TEMP at call time) for retention tests.
async function inSandboxTmp(fn) {
  const fs = req("node:fs"), path = req("node:path"), os = req("node:os");
  const prev = { TMP: process.env.TMP, TEMP: process.env.TEMP };
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "aura-art-sbx-"));
  process.env.TMP = sandbox; process.env.TEMP = sandbox;
  try { return await fn({ sandbox, fs, path }); }
  finally {
    if (prev.TMP === undefined) delete process.env.TMP; else process.env.TMP = prev.TMP;
    if (prev.TEMP === undefined) delete process.env.TEMP; else process.env.TEMP = prev.TEMP;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

test("nav guard: capture fails on a blocked final URL with blockedUrl attached", async () => {
  const err = await mkAdapter("http://192.168.1.1/router").capture("https://example.com", { settleMs: 5, saveDir: tmpDir() }).then(() => null, (e) => e);
  assert.equal(err.code, "UNSUPPORTED_OPERATION");
  assert.equal(err.blockedUrl, "http://192.168.1.1/router");
  assert.match(err.message, /blocked URL/);
});

test("nav guard: structure and motionInspect are guarded too", async () => {
  await assert.rejects(
    () => mkAdapter("http://169.254.169.254/latest/meta-data/").structure("https://example.com"),
    (e) => e.code === "UNSUPPORTED_OPERATION" && e.blockedUrl === "http://169.254.169.254/latest/meta-data/",
  );
  await assert.rejects(
    () => mkAdapter("http://[fc00::1]/").motionInspect("https://example.com"),
    (e) => e.code === "UNSUPPORTED_OPERATION",
  );
});

test("nav guard: loopback final URL rejected without allowLocal, allowed with it", async () => {
  await assert.rejects(
    () => mkAdapter("http://127.0.0.1:3000/").capture("https://example.com", { settleMs: 5, saveDir: tmpDir() }),
    (e) => e.code === "UNSUPPORTED_OPERATION",
  );
  const ok = await mkAdapter("http://127.0.0.1:3000/").capture("https://example.com", { settleMs: 5, allowLocal: true, saveDir: tmpDir() });
  assert.equal(ok.source, "live-browser");
});

test("nav guard: non-string location values are skipped, never failed", async () => {
  const sent = [];
  const r = await mkAdapter(null, sent).capture("https://example.com", { settleMs: 5, saveDir: tmpDir() });
  assert.equal(r.source, "live-browser");
  assert.ok(sent.includes("Runtime.evaluate"));
});

test("capture artifacts: artifactPath only when the file is written; honest note otherwise", async () => {
  const fs = req("node:fs"), path = req("node:path");
  const sandbox = tmpDir();
  const ok = await mkAdapter("https://example.com").capture("https://example.com", { settleMs: 5, saveDir: path.join(sandbox, "shots") });
  assert.ok(ok.artifactPath && fs.existsSync(ok.artifactPath), "written file is disclosed");
  assert.equal(ok.artifactNote, undefined);
  assert.ok(ok.bytes > 0);
  const blocker = path.join(sandbox, "blocked");
  fs.writeFileSync(blocker, "x");
  const bad = await mkAdapter("https://example.com").capture("https://example.com", { settleMs: 5, saveDir: blocker });
  assert.equal(bad.artifactPath, undefined, "no phantom path when the write failed");
  assert.match(bad.artifactNote, /kept in memory/);
  assert.ok(bad.bytes > 0, "bytes still reported");
});

test("capture retention: newest 20 kept in the tool-owned tmp dir; caller saveDir untouched", async () => {
  await inSandboxTmp(async ({ sandbox, fs, path }) => {
    const dir = path.join(sandbox, "aura-captures");
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now() - 100000;
    for (let i = 0; i < 25; i++) {
      const f = path.join(dir, "capture-old-" + String(i).padStart(2, "0") + ".png");
      fs.writeFileSync(f, "x");
      fs.utimesSync(f, new Date(t0 + i * 1000), new Date(t0 + i * 1000));
    }
    fs.writeFileSync(path.join(dir, "unrelated.txt"), "x");
    const r = await mkAdapter("https://example.com").capture("https://example.com", { settleMs: 5 });
    const files = fs.readdirSync(dir);
    assert.equal(files.filter((n) => n.startsWith("capture-")).length, 20, "26 capture files pruned to the newest 20");
    assert.ok(files.includes("unrelated.txt"), "prune is prefix-scoped");
    assert.match(r.retentionNote || "", /pruned 6 older capture file/);
    assert.ok(fs.existsSync(r.artifactPath));
    const own = path.join(sandbox, "own");
    fs.mkdirSync(own);
    for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(own, "capture-" + i + ".png"), "x");
    const r2 = await mkAdapter("https://example.com").capture("https://example.com", { settleMs: 5, saveDir: own });
    assert.equal(r2.retentionNote, undefined, "caller saveDir is never pruned");
    assert.equal(fs.readdirSync(own).length, 4);
  });
});

test("motion retention: prior aura-motion dirs older than 24h pruned, current kept", async () => {
  await inSandboxTmp(async ({ sandbox, fs, path }) => {
    const oldDir = path.join(sandbox, "aura-motion-old");
    fs.mkdirSync(oldDir);
    const old = new Date(Date.now() - 48 * 3600 * 1000);
    fs.utimesSync(oldDir, old, old);
    const other = path.join(sandbox, "aura-captures-old");
    fs.mkdirSync(other);
    fs.utimesSync(other, old, old);
    const r = await mkAdapter("https://example.com").recordFrames("https://example.com", { frames: 2, durationMs: 4000, viewport: "desktop" });
    assert.ok(r.frameCount >= 1, "frames captured");
    assert.match(r.retentionNote || "", /pruned 1 prior motion-study dir/);
    assert.equal(fs.existsSync(oldDir), false, "old tool-owned dir pruned");
    assert.equal(fs.existsSync(other), true, "capture prefix untouched by the motion prune");
    assert.ok(r.dir && fs.existsSync(r.dir), "current run's dir kept");
  });
});

test("prune helpers: keep-newest order, prefix scope, age threshold, skip", () => {
  const fs = req("node:fs"), path = req("node:path");
  const sandbox = tmpDir();
  const dir = path.join(sandbox, "caps");
  fs.mkdirSync(dir);
  const t0 = Date.now() - 100000;
  for (let i = 0; i < 8; i++) {
    const f = path.join(dir, "capture-" + i + ".png");
    fs.writeFileSync(f, "x");
    fs.utimesSync(f, new Date(t0 + i * 1000), new Date(t0 + i * 1000));
  }
  fs.writeFileSync(path.join(dir, "keepme.txt"), "x");
  const removed = cdpPruneOldFiles(dir, { prefix: "capture-", keepNewest: 5 });
  assert.equal(removed, 3);
  const kept = fs.readdirSync(dir).filter((n) => n.startsWith("capture-")).sort();
  assert.deepEqual(kept, ["capture-3.png", "capture-4.png", "capture-5.png", "capture-6.png", "capture-7.png"], "newest by mtime kept");
  assert.ok(fs.existsSync(path.join(dir, "keepme.txt")));
  const parent = path.join(sandbox, "motion");
  fs.mkdirSync(parent);
  const oldDir = path.join(parent, "aura-motion-old");
  fs.mkdirSync(oldDir);
  const old = new Date(Date.now() - 48 * 3600 * 1000);
  fs.utimesSync(oldDir, old, old);
  const freshDir = path.join(parent, "aura-motion-fresh");
  fs.mkdirSync(freshDir);
  const otherDir = path.join(parent, "other-old");
  fs.mkdirSync(otherDir);
  fs.utimesSync(otherDir, old, old);
  assert.equal(cdpPruneOldDirs(parent, { prefix: "aura-motion-", maxAgeMs: 24 * 3600 * 1000 }), 1);
  assert.equal(fs.existsSync(oldDir), false);
  assert.equal(fs.existsSync(freshDir), true);
  assert.equal(fs.existsSync(otherDir), true, "prefix filter protects unrelated dirs");
  assert.equal(cdpPruneOldDirs(parent, { prefix: "aura-motion-", maxAgeMs: 0, skip: freshDir }), 0);
  assert.equal(fs.existsSync(freshDir), true, "skip protects the current run");
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test("encodeWebm: empty/missing/multi-dir frames refuse honestly before ffmpeg runs", async () => {
  const fs = req("node:fs"), path = req("node:path");
  const ad = mkAdapter(null);
  await assert.rejects(() => ad.encodeWebm([], {}), (e) => e.code === "BAD_ARGS");
  const missing = await ad.encodeWebm([path.join(tmpDir(), "frame-00.jpg")], { ffmpegPath: process.execPath });
  assert.equal(missing.video, null);
  assert.equal(missing.available, false);
  assert.match(missing.hint, /gone/);
  const d1 = tmpDir(), d2 = tmpDir();
  const f1 = path.join(d1, "frame-00.jpg"); fs.writeFileSync(f1, "x");
  const f2 = path.join(d2, "frame-01.jpg"); fs.writeFileSync(f2, "x");
  const multi = await ad.encodeWebm([f1, f2], { ffmpegPath: process.execPath });
  assert.equal(multi.video, null);
  assert.match(multi.hint, /multiple directories/);
});
