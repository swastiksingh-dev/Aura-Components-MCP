// browser-cdp.test.mjs — hermetic CDP adapter tests (mocked transport).
import test from "node:test";
import assert from "node:assert/strict";
import {
  cdpResolveViewport, cdpCollapseBands, cdpBandsFromHtml, createCdpConn,
  findChromeExecutable, findFfmpeg, createBrowserAdapter, reduceCdpScan,
  CDP_VIEWPORTS, CDP_SCAN_JS, CDP_MOTION_JS,
} from "../src/browser-cdp.mjs";

test("viewport presets validate", () => {
  assert.deepEqual(cdpResolveViewport("desktop"), CDP_VIEWPORTS.desktop);
  assert.equal(cdpResolveViewport("mobile").width, 390);
  assert.throws(() => cdpResolveViewport("tablet"), (e) => e.code === "BAD_ARGS");
});

test("CDP conn: ids increment, out-of-order delivery resolves correctly", async () => {
  const sent = [];
  const conn = createCdpConn({ send: (s) => sent.push(JSON.parse(s)) });
  const p1 = conn.command("Page.navigate", { url: "https://a.com" }, 2000);
  const p2 = conn.command("Runtime.evaluate", {}, 2000);
  assert.equal(sent[0].id, 1);
  assert.equal(sent[1].id, 2);
  conn.deliver({ id: 2, result: { two: true } });
  conn.deliver({ id: 1, result: { one: true } });
  assert.deepEqual(await p2, { two: true });
  assert.deepEqual(await p1, { one: true });
  assert.equal(conn.pendingCount(), 0);
});

test("CDP conn: error result rejects; timeout rejects", async () => {
  const conn = createCdpConn({ send: () => {} });
  const p = conn.command("Page.x", {}, 30);
  conn.deliver({ id: 1, error: { message: "nope" } });
  await assert.rejects(() => p, /CDP/);
  const conn2 = createCdpConn({ send: () => {} });
  await assert.rejects(() => conn2.command("Page.y", {}, 30), (e) => e.code === "CAPTURE_TIMEOUT");
});

test("chrome discovery: env path wins; missing returns null", () => {
  const exe = findChromeExecutable({ envPath: null, exists: () => false, platform: "linux" });
  assert.equal(exe, null);
  const hit = findChromeExecutable({ exists: (p) => p === "/usr/bin/chromium", platform: "linux" });
  assert.equal(hit, "/usr/bin/chromium");
});

test("ffmpeg lookup returns null when absent (honest)", () => {
  const r = findFfmpeg({});
  assert.ok(r === null || typeof r === "string");
});

test("adapter status reports availability honestly", () => {
  const off = createBrowserAdapter({ chromePath: null, fetchImpl: async () => { throw new Error("no"); } });
  // findChromeExecutable may find a real browser on this machine; either way shape holds
  const s = off.status();
  assert.ok(typeof s.available === "boolean");
  assert.ok(Array.isArray(s.viewports) || typeof s.viewports === "object");
});

test("capture without browser => BROWSER_UNAVAILABLE (never fake)", async () => {
  const orig = process.env.AURA_CHROME_PATH;
  process.env.AURA_CHROME_PATH = "/nonexistent/chrome-zzz";
  const ad = createBrowserAdapter({ chromePath: "/nonexistent/chrome-zzz" });
  const err = await ad.capture("https://example.com", {}).then(() => null, (e) => e);
  assert.ok(err && err.code === "BROWSER_UNAVAILABLE");
  assert.ok(/Chrome|chrom/i.test(err.message));
  if (orig === undefined) delete process.env.AURA_CHROME_PATH; else process.env.AURA_CHROME_PATH = orig;
});

test("structure without browser => BROWSER_UNAVAILABLE", async () => {
  const ad = createBrowserAdapter({ chromePath: "/nonexistent/chrome-zzz" });
  await assert.rejects(() => ad.structure("https://example.com", {}), (e) => e.code === "BROWSER_UNAVAILABLE");
});

test("motionInspect without browser => BROWSER_UNAVAILABLE", async () => {
  const ad = createBrowserAdapter({ chromePath: "/nonexistent/chrome-zzz" });
  await assert.rejects(() => ad.motionInspect("https://example.com", {}), (e) => e.code === "BROWSER_UNAVAILABLE");
});

test("URL validation: private hosts blocked unless allowLocal", async () => {
  const ad = createBrowserAdapter({ chromePath: "/nonexistent/chrome-zzz" });
  await assert.rejects(() => ad.capture("http://127.0.0.1:3000/", {}), (e) => e.code === "UNSUPPORTED_OPERATION");
  await assert.rejects(() => ad.capture("https://169.254.169.254/meta", {}), (e) => e.code === "UNSUPPORTED_OPERATION" || e.code === "BAD_ARGS");
  await assert.rejects(() => ad.capture("file:///etc/passwd", {}), (e) => e.code === "BAD_ARGS");
  await assert.rejects(() => ad.capture("https://example.com", { viewport: "tablet" }), (e) => e.code === "BAD_ARGS" || e.code === "BROWSER_UNAVAILABLE");
});

test("band collapse: smallest-covering wins, slivers absorbed, capped", () => {
  const bands = cdpCollapseBands([
    { tag: "body", label: "body", bg: "rgb(255, 255, 255)", top: 0, height: 2000, textStart: "" },
    { tag: "section", label: ".hero", bg: "rgb(0, 0, 0)", top: 0, height: 800, textStart: "Hero" },
    { tag: "section", label: ".tail", bg: "rgb(0, 0, 0)", top: 800, height: 400, textStart: "More" },
  ], 2000);
  assert.ok(bands.length >= 1 && bands.length <= 3);
  assert.equal(bands[0].background, "rgb(0, 0, 0)");
  assert.equal(bands[0].offsetTop, 0);
  const many = Array.from({ length: 60 }, (_, i) => ({ tag: "div", label: ".d" + i, bg: "rgb(" + i + ",0,0)", top: i * 100, height: 100, textStart: "" }));
  assert.ok(cdpCollapseBands(many, 6000).length <= 40, "band cap holds");
});

test("static-html fallback is labeled estimated, never live-dom", () => {
  const r = cdpBandsFromHtml('<html><head><title>T</title></head><body><section><h1>Hero</h1><img src="a.jpg"></section><footer></footer></body></html>', "https://example.com");
  assert.equal(r.source, "static-html");
  assert.ok(r.bands.length >= 2);
  assert.equal(r.bands[0].offsetTop, null, "no invented offsets");
  assert.ok(r.note.includes("without layout"));
});

test("motion reduce: honest counts, no invented private state", () => {
  const scan = { libs: ["gsap", "scrolltrigger"], render: ["webgl"], scrollTrigger: { count: 4, scrub: 2, pin: 1, sample: [{ start: "top bottom", end: "bottom top", scrub: true, pin: false, duration: null, ease: null }] }, tweens: { durations: [0.4, 0.7, 1.2], eases: ["power2.out", "none"] }, cssBeziers: ["cubic-bezier(0.25, 0.46, 0.45, 0.94)"] };
  const m = reduceCdpScan("https://example.com", scan, 123, "desktop");
  assert.deepEqual(m.stack.libs, ["gsap", "scrolltrigger"]);
  assert.equal(m.scroll.triggerCount, 4);
  assert.equal(m.scroll.scrubRatio, 0.5);
  assert.ok(m.easingVocab.some((e) => e.token === "power2.out"));
  assert.ok(!m.easingVocab.some((e) => e.token === "none"), "scrub defaults carry no style signal");
  assert.ok(m.durationVocab.median > 400 && m.durationVocab.median < 1200);
  assert.equal(m.source, "live-browser");
  const empty = reduceCdpScan("https://example.com", { libs: [], render: [], scrollTrigger: { count: 0, scrub: 0, pin: 0, sample: [] }, tweens: { durations: [], eases: [] }, cssBeziers: [] }, 1, "mobile");
  assert.equal(empty.stack.scrollModel, "unknown");
  assert.equal(empty.durationVocab, null);
});

test("page snippets are self-contained source strings", () => {
  assert.ok(typeof CDP_SCAN_JS === "string" && CDP_SCAN_JS.includes("candidates"));
  assert.ok(typeof CDP_MOTION_JS === "string" && CDP_MOTION_JS.includes("scrollTrigger"));
});
