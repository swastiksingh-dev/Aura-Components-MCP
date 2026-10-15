// award-fixes.test.mjs — regressions for the 12 field-reported issues (P0-P2).
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/protocol.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";
import { createAwardIndex } from "../src/awards-index.mjs";
import { createBrowserAdapter, createCdpConn } from "../src/browser-cdp.mjs";
import { awardScoreSites, awardThemeHint } from "../src/awards.mjs";
import { matchOverlap, scoreRows, stemTok } from "../src/catalog.mjs";

const tmpDir = () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const os = process.getBuiltinModule("node:os");
  return fs.mkdtempSync(path.join(os.tmpdir(), "aura-awfix-"));
};
// Fake CDP page socket: opens instantly, answers commands, fires load event.
function fakePageSocket(sent) {
  return class {
    constructor() { this.sent = sent; setTimeout(() => this.onopen && this.onopen(), 0); }
    send(s) {
      const m = JSON.parse(s);
      sent.push(m.method);
      const reply = (result) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ id: m.id, result }) }), 0);
      if (m.method === "Page.navigate") {
        reply({ loaderId: "L1" });
        setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ method: "Page.loadEventFired", params: {} }) }), 5);
      }
      else if (m.method === "Page.captureScreenshot") reply({ data: "iVBORw0KGgo=" });
      else if (m.method === "Runtime.evaluate") reply({ result: { type: "object", value: { title: "T", totalHeight: 900, candidates: [] } } });
      else reply({});
    }
    close() {}
  };
}
const fakeSpawn = () => ({ spawn: () => ({ once() {}, kill() {}, exitCode: null }) });
const fakeFetchList = (list) => async (url) => {
  if (String(url).includes("/json/version")) return { ok: true, json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:1/browser" }) };
  if (String(url).includes("/json/list")) return { ok: true, json: async () => list };
  if (String(url).includes("/json/new")) return { ok: false, status: 404 };
  throw new Error("unexpected fetch " + url);
};

test("P0-1: page attach uses /json/list, never Target.createTarget", async () => {
  const sent = [];
  const ad = createBrowserAdapter({
    chromePath: process.execPath, fetchImpl: fakeFetchList([{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:1/page" }]),
    socketImpl: fakePageSocket(sent), spawnImpl: fakeSpawn(),
  });
  const r = await ad.capture("https://example.com", { settleMs: 10 });
  assert.ok(!sent.includes("Target.createTarget"), "must not hang on browser-endpoint target creation, sent: " + sent.join(","));
  assert.ok(sent.includes("Page.navigate") && sent.includes("Page.captureScreenshot"));
  assert.equal(r.source, "live-browser");
});

test("P0-1: hung setup normalizes to BROWSER_UNAVAILABLE with fallback", async () => {
  const refused = class { constructor() { setTimeout(() => this.onerror && this.onerror(new Error("refused")), 0); } send() {} close() {} };
  const ad = createBrowserAdapter({
    chromePath: process.execPath, fetchImpl: fakeFetchList([{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:1/page" }]),
    socketImpl: refused, spawnImpl: fakeSpawn(),
  });
  const err = await ad.motionInspect("https://example.com", {}).then(() => null, (e) => e);
  assert.ok(err && err.code === "BROWSER_UNAVAILABLE", "got: " + (err && err.code) + " " + (err && err.message));
  assert.ok(/Fallback/.test(err.message), "carries fallback guidance");
});

test("P0-1: empty target list normalizes to BROWSER_UNAVAILABLE", async () => {
  const sent = [];
  const ad = createBrowserAdapter({
    chromePath: process.execPath, fetchImpl: fakeFetchList([]),
    socketImpl: fakePageSocket(sent), spawnImpl: fakeSpawn(),
  });
  await assert.rejects(() => ad.structure("https://example.com", {}), (e) => e.code === "BROWSER_UNAVAILABLE");
});

test("P0-1: status() with bad chrome path reports unavailable, never throws", () => {
  const ad = createBrowserAdapter({ chromePath: "/nonexistent/zzz" });
  const s = ad.status();
  assert.equal(s.available, false);
  assert.equal(s.executable, null);
});

test("P0-1: CDP conn routes domain events to listeners", async () => {
  const conn = createCdpConn({ send: () => {} });
  let got = null;
  conn.onEvent("Page.loadEventFired", (p) => { got = p; });
  conn.deliver({ method: "Page.loadEventFired", params: { ts: 1 } });
  assert.deepEqual(got, { ts: 1 });
});

async function callWith(handlers, name, args) {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  return out[1];
}
const throwingBrowser = () => ({ structure: async () => { const e = new Error("boom"); e.code = "BROWSER_UNAVAILABLE"; throw e; } });

test("P0-2: structure degrades live-dom failure to labeled static-html", async () => {
  const prev = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => "<html><head><title>H</title></head><body><section><h1>Hero</h1></section></body></html>" });
  try {
    const h = createHandlers({}, null, null, { awardClient: null, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: throwingBrowser() });
    const m = await callWith(h, "aura_visual_audit", { mode: "structure", url: "https://example.com" });
    const r = JSON.parse(m.result.content[0].text);
    assert.equal(r.source, "static-html");
    assert.equal(r.fallbackFrom, "live-dom");
    assert.ok(r.fallbackWhy);
  } finally { globalThis.fetch = prev; }
});

test("P0-2: local file audited with allowLocal, rejected without", async () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const file = path.join(tmpDir(), "index.html");
  fs.writeFileSync(file, "<html><head><title>Build</title></head><body><header></header><section><h1>Hi</h1></section><footer></footer></body></html>");
  const h = createHandlers({}, null, null, { awardClient: null, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const denied = await callWith(h, "aura_visual_audit", { mode: "structure", url: file });
  assert.ok(denied.error, "local path without allowLocal must error");
  const ok = await callWith(h, "aura_visual_audit", { mode: "structure", url: file, allowLocal: true });
  const r = JSON.parse(ok.result.content[0].text);
  assert.equal(r.source, "local-file");
  assert.ok(r.bands.length >= 3, "header/section/footer parsed");
  const cap = await callWith(h, "aura_visual_audit", { mode: "capture", url: file, allowLocal: true });
  assert.ok(cap.error, "capture of a file path must error with serve guidance");
  assert.ok(/serve/i.test(cap.error.message));
});

test("P0-3: blueprint always has Evidence gaps + requested palette + section coverage", async () => {
  const detail = (slug) => `<html><head><meta property="og:title" content="${slug}" /></head><body><h2>Technologies & Tools</h2><span class="button button--tag">GSAP</span><h2>Color Palette</h2><strong>HEX</strong> #182124</body></html>`;
  const client = { getAwardHtml: async (raw) => { const p = String(raw).startsWith("http") ? new URL(String(raw)).pathname : String(raw); return { html: detail(p.split("/")[2]) }; } };
  const catalog = (() => {
    let n = 0;
    return {
      searchCatalog: async (kind, q) => kind === "components"
        ? { items: [{ id: ++n, title: "Match for " + q.query, tags: ["hero"], page_url: "https://www.aura.build/component/" + n, premium: false }] }
        : { items: [{ slug: "sys", title: "Sys", page_url: "https://www.aura.build/design-systems/sys" }] },
    };
  })();
  const h = createHandlers(catalog, null, null, { awardClient: client, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const m = await callWith(h, "aura_design_blueprint", { goal: "Dark red glassy page #0a0a0b with #ff2a2a accents", references: ["alpha-site", "beta-site"], visualDirection: "black glass" });
  const r = JSON.parse(m.result.content[0].text);
  assert.ok(r.markdown.includes("## Evidence gaps"), "heading always present");
  assert.ok(r.spec.gaps.length > 0, "motion-missing gap recorded, got: " + JSON.stringify(r.spec.gaps));
  assert.ok(r.spec.requestedPalette.some((p) => p.value === "#0A0A0B" && p.status === "proposed"), "requested bg synthesized as proposed");
  assert.ok(r.spec.requestedPalette.some((p) => p.value === "#FF2A2A"), "requested accent synthesized");
  assert.ok(r.markdown.includes("#FF2A2A"));
  assert.ok(r.spec.auraMatches.length >= 3, "per-section queries cover multiple sections, got " + r.spec.auraMatches.length);
  assert.ok(r.auraEvidence.sectionsCovered.length >= 3);
});

test("P1-5: technologies backfilled from tags and labeled inferred", async () => {
  const noTech = "<html><head><meta property=\"og:title\" content=\"Grail\" /></head><body></body></html>";
  const listing = `<div data-collectable-model-value="{&quot;slug&quot;:&quot;grail-app&quot;,&quot;title&quot;:&quot;Grail&quot;,&quot;createdAt&quot;:1,&quot;tags&quot;:[&quot;WebGL&quot;,&quot;3D&quot;],&quot;images&quot;:{},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/grail-app">x</a></div>`;
  const client = {
    getAwardHtml: async (raw) => {
      const p = String(raw).startsWith("http") ? new URL(String(raw)).pathname : String(raw);
      if (p.startsWith("/sites/")) return { html: noTech };
      return { html: listing };
    },
  };
  const h = createHandlers({}, null, null, { awardClient: client, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  // Realistic flow: search first (caches listing tags), then inspect.
  const s = await callWith(h, "aura_award_search", { mode: "sites", query: "grail", limit: 3 });
  assert.ok(JSON.parse(s.result.content[0].text).items.length >= 1);
  const m = await callWith(h, "aura_award_inspect", { mode: "site_details", slug: "grail-app" });
  const r = JSON.parse(m.result.content[0].text);
  assert.ok(r.detail.technologies.includes("WebGL"), "tags backfill the empty Technologies section");
  assert.equal(r.detail.technologiesInferred, true);
  assert.ok(/listing tags/.test(r.detail.technologyEvidence));
});

test("P1-6: compare yields keyword overlap + direction hints", async () => {
  const d = (slug, title, hex, tech) => `<html><head><meta property="og:title" content="${title}" /></head><body><h2>Technologies & Tools</h2>${tech.map((t) => `<span class="button button--tag">${t}</span>`).join("")}<h2>Elements</h2><div data-collectable-model-value="{&quot;collectableTitle&quot;:&quot;Hero banner&quot;,&quot;collectableImage&quot;:&quot;element/2026/01/a.mp4&quot;}">x</div><h2>Color Palette</h2><strong>HEX</strong> ${hex}</body></html>`;
  const pages = { "site-aa": d("site-aa", "AA", "#0A0A0B", ["GSAP"]), "site-bb": d("site-bb", "BB", "#111111", ["GSAP", "Lenis"]) };
  const client = { getAwardHtml: async (raw) => { const p = String(raw).startsWith("http") ? new URL(String(raw)).pathname : String(raw); return { html: pages[p.split("/")[2]] || "<html></html>" }; } };
  const h = createHandlers({}, null, null, { awardClient: client, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const m = await callWith(h, "aura_award_inspect", { mode: "compare_sites", slugs: ["site-aa", "site-bb"] });
  const r = JSON.parse(m.result.content[0].text);
  assert.ok(r.shared.technology.some((t) => t.value === "gsap"), "exact tech overlap");
  assert.ok(r.directionHints.length > 0, "luminance/stack hints, got: " + JSON.stringify(r.directionHints));
  assert.ok(r.compared.every((c) => Array.isArray(c.luminanceBands)));
});

test("P1-4: synonyms + theme-hint ranking (glassy finds glassmorphism)", () => {
  const sites = [
    { slug: "x", title: "Plain Portfolio", tags: ["portfolio"], awards: [], studio: null },
    { slug: "y", title: "Studio Work", tags: ["glassmorphism"], awards: [], studio: null },
  ];
  const { scored } = awardScoreSites(sites, "glassy portfolio");
  const y = scored.find((s) => s.site.slug === "y");
  assert.ok(y.score > 0, "alias glassy->glassmorphism scores");
  assert.ok(y.reasons.includes("tag:glassy"), "reason names the query word, not the alias");
  const dark = awardScoreSites([
    { slug: "l", title: "Bright Portfolio", tags: ["portfolio", "light"], awards: [], studio: null },
    { slug: "d", title: "Moody Portfolio", tags: ["portfolio", "dark"], awards: [], studio: null },
  ], "dark portfolio");
  assert.equal(dark.scored[0].site.slug, "d", "theme hint boosts the dark-tagged twin");
  assert.ok(dark.scored[0].reasons.includes("theme:dark"));
  assert.equal(awardThemeHint("dark cinematic"), "dark");
  const honest = awardScoreSites(sites, "xqztqvpzzz");
  assert.ok(honest.scored.every((s) => s.score === 0), "bonuses never rescue zero-token rows");
});

test("P1-7/8: catalog stemming hits inflections, keeps honest-empty", () => {
  assert.equal(stemTok("glassy"), "glass");
  assert.equal(stemTok("magazines"), "magazine");
  assert.equal(matchOverlap("components", ["glassy"], { title: "Glass Bento Grid" }), 1);
  assert.equal(matchOverlap("components", ["xqztq"], { title: "Glass Bento Grid" }), 0);
  const ranked = scoreRows("components", [{ title: "Glass Bento Grid", views: 1 }], ["glassy", "bento"], null);
  assert.equal(ranked[0].s, 4, "both stems hit title at +2 each");
});

test("P2-10: categories paginate filters, colors stay complete", async () => {
  const h = createHandlers({}, null, null, { awardClient: null, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const idx = createAwardIndex({ dir: tmpDir() });
  idx.setTaxonomy({ colors: ["#FF0000"], filters: ["aa", "bb", "cc", "dd"] });
  const h2 = createHandlers({}, null, null, { awardClient: null, awardIndex: idx, browser: null });
  const m = await callWith(h2, "aura_award_search", { mode: "categories", limit: 2, offset: 1 });
  const r = JSON.parse(m.result.content[0].text);
  assert.deepEqual(r.filters, ["bb", "cc"]);
  assert.equal(r.filtersTotal, 4);
  assert.deepEqual(r.colors, ["#FF0000"]);
  void h;
});

test("follow-up-1: weak consensus fills from editorial picks, labeled", async () => {
  const detail = `<html><head><meta property="og:title" content="Oddity" /></head><body><h2>Color Palette</h2><strong>HEX</strong> #123456</body></html>`;
  const client = { getAwardHtml: async () => ({ html: detail }) };
  const thinCatalog = {
    searchCatalog: async () => ({ items: [] }),
    editorialPicks: async (n) => [{ id: 901, title: "Editorial Hero", tags: ["hero"], page_url: "https://www.aura.build/component/901", premium: false }],
  };
  const h = createHandlers(thinCatalog, null, null, { awardClient: client, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const m = await callWith(h, "aura_design_blueprint", { goal: "xqztq oddity page", references: ["odd-a", "odd-b"] });
  const r = JSON.parse(m.result.content[0].text);
  const ed = r.spec.auraMatches.filter((x) => x.editorial === true);
  assert.ok(ed.length >= 1, "editorial fill present, matches: " + JSON.stringify(r.spec.auraMatches));
  assert.ok(/editorial/i.test(r.auraEvidence.unavailable || "") || r.auraEvidence.matched >= 1);
  assert.ok(r.spec.gaps.length > 0 && r.markdown.includes("## Evidence gaps"));
});

test("follow-up-2: compare finds tech families across spellings", async () => {
  const d = (slug, title, techs) => `<html><head><meta property="og:title" content="${title}" /></head><body><h2>Technologies & Tools</h2>${techs.map((t) => `<span class="button button--tag">${t}</span>`).join("")}<h2>Color Palette</h2><strong>HEX</strong> #0A0A0B</body></html>`;
  const pages = { "fam-aa": d("fam-aa", "AA", ["WebGL", "GSAP"]), "fam-bb": d("fam-bb", "BB", ["Three.js", "GreenSock"]) };
  const client = { getAwardHtml: async (raw) => { const p = String(raw).startsWith("http") ? new URL(String(raw)).pathname : String(raw); return { html: pages[p.split("/")[2]] || "<html></html>" }; } };
  const h = createHandlers({}, null, null, { awardClient: client, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const m = await callWith(h, "aura_award_inspect", { mode: "compare_sites", slugs: ["fam-aa", "fam-bb"] });
  const r = JSON.parse(m.result.content[0].text);
  const fams = (r.shared.technologyFamilies || []).map((t) => t.value);
  assert.ok(fams.includes("webgl") && fams.includes("gsap"), "families bridge spellings, got: " + JSON.stringify(fams));
  assert.ok(r.directionHints.some((x) => /family/.test(x)));
  assert.ok(r.compared[0].technologies.includes("WebGL"), "raw values stay verbatim");
});

test("follow-up-3: motion/capture errors carry fallback guidance", async () => {
  const h = createHandlers({}, null, null, { awardClient: null, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const ins = await callWith(h, "aura_motion_study", { mode: "inspect", url: "https://example.com" });
  assert.ok(ins.error, "spec keeps the error contract");
  assert.ok(/prefers-reduced-motion|ease-out/i.test(ins.error.message), "error carries a usable generic plan");
  const noBrowser = { structure: async () => { const e = new Error("dead"); e.code = "BROWSER_UNAVAILABLE"; throw e; } };
  const prev = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("connect refused"); };
  try {
    const h2 = createHandlers({}, null, null, { awardClient: null, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: noBrowser });
    const st = await callWith(h2, "aura_visual_audit", { mode: "structure", url: "http://127.0.0.1:8123/index.html", allowLocal: true });
    assert.ok(st.error, "dead server + dead browser must still error, not fake");
    assert.ok(/dev server|npx serve|allowLocal/i.test(st.error.message), "combined message names both fixes, got: " + st.error.message.slice(0, 200));
  } finally { globalThis.fetch = prev; }
});

test("speed+UX: try_for cues, full-cap, parallel order, ideas, next_calls, tokens_css", async () => {
  const { awardCompactSite, awardSiteIdeas, awardBuildBlueprint } = await import("../src/awards.mjs");
  // try_for derived from tags only
  const withTags = awardCompactSite({ slug: "a", title: "A", tags: ["dark", "hero"], detailPath: "/sites/a" }, null);
  assert.equal(withTags.try_for, "use for: dark hero sections");
  const noTags = awardCompactSite({ slug: "b", title: "B", tags: [], detailPath: "/sites/b" }, null);
  assert.ok(!("try_for" in noTags), "no tags → no cue, never invented");
  // ideas labeled suggested with basis; null detail → []
  assert.deepEqual(awardSiteIdeas(null), []);
  const ideas = awardSiteIdeas({ palette: ["#0A0A0B"], elements: ["Hero banner"], technologies: ["GSAP"] });
  assert.ok(ideas.length >= 3);
  assert.ok(ideas.every((i) => i.status === "suggested" && typeof i.basis === "string" && /observed/.test(i.basis)));
  // tokens_css carries requested hexes; empty → ""
  const built = awardBuildBlueprint({ goal: "dark page #0a0a0b with #ff2a2a", refs: ["aa", "bb"], details: [], auraMatches: [], requestedPalette: ["#0A0A0B", "#FF2A2A"], gaps: [] });
  assert.ok(built.spec.tokens_css.includes("#0A0A0B") && built.spec.tokens_css.includes("#FF2A2A"));
  assert.ok(built.markdown.includes("--aw-ground: #0A0A0B") && built.markdown.includes("--aw-ink: #FF2A2A"));
  const bare = awardBuildBlueprint({ goal: "plain", refs: ["aa", "bb"], details: [], auraMatches: [], requestedPalette: [], gaps: [] });
  assert.equal(bare.spec.tokens_css, "");
  assert.ok(!bare.markdown.includes("--aw-ground:"));
  // single-hex edge: ground ≠ ink
  const single = awardBuildBlueprint({ goal: "x", refs: ["aa", "bb"], details: [], auraMatches: [], requestedPalette: ["#0A0A0B"], gaps: [] });
  assert.ok(single.spec.tokens_css.includes("--aw-ground:#0A0A0B") && single.spec.tokens_css.includes("--aw-ink:#F5F5F5"));
});

test("speed+UX: full:true caps enrichment at 5 with disclosure", async () => {
  const listing = [1, 2, 3, 4, 5, 6, 7].map((n) => `<div data-collectable-model-value="{&quot;slug&quot;:&quot;site-${n}&quot;,&quot;title&quot;:&quot;Site ${n} portfolio&quot;,&quot;createdAt&quot;:1,&quot;tags&quot;:[&quot;portfolio&quot;],&quot;images&quot;:{},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/site-${n}">x</a></div>`).join("");
  const client = { getAwardHtml: async () => ({ html: listing }) };
  const h = createHandlers({}, null, null, { awardClient: client, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const m = await callWith(h, "aura_award_search", { mode: "sites", query: "portfolio", limit: 7, full: true });
  const r = JSON.parse(m.result.content[0].text);
  assert.equal(r.items.length, 7);
  assert.equal(r.full_enrichment_capped, 5);
  assert.ok(r.items.slice(0, 5).every((i) => "palette" in i), "first 5 carry full detail");
  assert.ok(r.items.slice(5).every((i) => !("palette" in i)), "rest stay compact");
});

test("speed+UX: blueprint details fetch concurrently, NOT_FOUND still throws", async () => {
  const order = [];
  const client = {
    getAwardHtml: async (raw) => {
      const p = String(raw).startsWith("http") ? new URL(String(raw)).pathname : String(raw);
      const slug = p.split("/")[2];
      order.push(slug);
      await new Promise((r) => setTimeout(r, 20));
      if (slug === "ghost-zz") { const e = new Error("gone"); e.code = "NOT_FOUND"; throw e; }
      return { html: `<html><head><meta property="og:title" content="${slug}" /></head><body></body></html>` };
    },
  };
  const catalog = { searchCatalog: async () => ({ items: [] }) };
  const h = createHandlers(catalog, null, null, { awardClient: client, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const t0 = Date.now();
  const m = await callWith(h, "aura_design_blueprint", { goal: "x", references: ["cc-aa", "cc-bb", "cc-cc"] });
  const ms = Date.now() - t0;
  const r = JSON.parse(m.result.content[0].text);
  assert.ok(r.spec, "blueprint built");
  assert.ok(ms < 3000, "3 details fetched concurrently, took " + ms + "ms");
  const bad = await callWith(h, "aura_design_blueprint", { goal: "x", references: ["cc-aa", "ghost-zz"] });
  assert.equal(bad.error.code, -32004, "unknown ref still surfaces NOT_FOUND");
});

test("speed+UX: next_calls use only real gathered ids/urls", async () => {
  const detail = (slug, live) => `<html><head><meta property="og:title" content="${slug}" /></head><body>${live ? `<h1 class="heading-1 text-uppercase"> <a href="${live}" target="_blank" rel="noopener">${slug}</a></h1>` : ""}</body></html>`;
  const client = { getAwardHtml: async (raw) => { const p = String(raw).startsWith("http") ? new URL(String(raw)).pathname : String(raw); const s = p.split("/")[2]; return { html: detail(s, s === "nc-aa" ? "https://nc-aa.example.com" : null) }; } };
  const catalog = {
    searchCatalog: async (kind, q) => kind === "components"
      ? { items: [{ id: 441, title: "NC Hero", tags: ["hero"], page_url: "https://www.aura.build/component/441", premium: false }] }
      : { items: [{ slug: "nc-sys", title: "NC Sys", page_url: "https://www.aura.build/design-systems/nc-sys" }] },
  };
  const h = createHandlers(catalog, null, null, { awardClient: client, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: null });
  const m = await callWith(h, "aura_design_blueprint", { goal: "nc test", references: ["nc-aa", "nc-bb"] });
  const r = JSON.parse(m.result.content[0].text);
  assert.ok(Array.isArray(r.next_calls) && r.next_calls.length > 0);
  const get = r.next_calls.find((c) => c.tool === "aura_get_component");
  assert.ok(get && get.arguments.id === 441, "get call uses the matched component id");
  const scaf = r.next_calls.find((c) => c.tool === "aura_scaffold_page");
  assert.ok(scaf && scaf.arguments.system === "nc-sys" && scaf.arguments.components.includes("441"), "scaffold reuses real system + component ids");
  const mo = r.next_calls.find((c) => c.tool === "aura_motion_study");
  assert.ok(mo && mo.arguments.url === "https://nc-aa.example.com", "motion call uses the observed liveUrl");
  assert.ok(r.next_calls.every((c) => typeof c.why === "string"));
});
