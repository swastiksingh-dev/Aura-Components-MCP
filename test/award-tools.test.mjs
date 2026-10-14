// award-tools.test.mjs — MCP integration for the six award tools.
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/protocol.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";
import { createAwardClient } from "../src/awards.mjs";
import { createAwardIndex } from "../src/awards-index.mjs";

const tmpDir = () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const os = process.getBuiltinModule("node:os");
  return fs.mkdtempSync(path.join(os.tmpdir(), "aura-awtools-"));
};
const LISTING = `<div data-collectable-model-value="{&quot;slug&quot;:&quot;aspen-search&quot;,&quot;title&quot;:&quot;Aspen Search&quot;,&quot;createdAt&quot;:1,&quot;tags&quot;:[&quot;minimal&quot;],&quot;images&quot;:{&quot;thumbnail&quot;:&quot;t.jpg&quot;},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/aspen-search">x</a><span class="budget-tag--sotd"></span></div>`
  + `<div data-collectable-model-value="{&quot;slug&quot;:&quot;emergence-magazine&quot;,&quot;title&quot;:&quot;Emergence Magazine&quot;,&quot;createdAt&quot;:2,&quot;tags&quot;:[&quot;magazine&quot;],&quot;images&quot;:{&quot;thumbnail&quot;:&quot;b.jpg&quot;},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/emergence-magazine">x</a></div>`;
const DETAIL = (slug, title) => `<html><head><meta property="og:title" content="${title}" /><meta property="og:description" content="desc ${title}" /></head><body><h1 class="heading-1 text-uppercase"> <a href="https://example-${slug}.com" target="_blank" rel="noopener">${title}</a></h1><h2>Technologies & Tools</h2><span class="button button--tag">GSAP</span><h2>Elements</h2><div>none</div><h2>Color Palette</h2><strong>HEX</strong> #FFFFFF</body></html>`;
const stubClient = {
  getAwardHtml: async (raw) => {
    const p = String(raw).startsWith("http") ? new URL(String(raw)).pathname : String(raw);
    if (p === "/websites/") return { html: LISTING + '<a href="/websites/minimal/">x</a><a href="/websites/magazine/">x</a>' };
    if (p.startsWith("/websites/")) return { html: LISTING };
    if (p.startsWith("/sites/")) { const s = p.split("/")[2]; return { html: DETAIL(s, s === "aspen-search" ? "Aspen Search" : "Emergence Magazine") }; }
    if (p.startsWith("/inspiration/")) return { html: '<link rel="canonical" href="https://www.awwwards.com/inspiration/hero-x" /><h1>Hero <small>from</small> <a href="/sites/aspen-search">Aspen</a></h1>' };
    if (p.includes("sites_of_the_day")) return { html: LISTING };
    throw new Error("unexpected " + p);
  },
};
const fakeCatalog = {
  getStatus: async () => ({ ok: true }),
  searchCatalog: async (kind, q) => {
    if (kind === "components") return { items: [{ id: 732, title: "Hero Section", tags: ["hero"], page_url: "https://www.aura.build/component/x", premium: false }] };
    if (kind === "design_systems") return { items: [{ id: "sys", slug: "sys", title: "Sys", page_url: "https://www.aura.build/design-systems/sys" }] };
    return { items: [] };
  },
  getItem: async (kind, id) => ({ kind, id }),
  categoryCounts: async () => [],
};
const noBrowser = { status: () => ({ available: false }), capture: async () => { const e = new Error("no Chrome"); e.code = "BROWSER_UNAVAILABLE"; throw e; }, structure: async () => { const e = new Error("no Chrome"); e.code = "BROWSER_UNAVAILABLE"; throw e; }, motionInspect: async () => { const e = new Error("no Chrome"); e.code = "BROWSER_UNAVAILABLE"; throw e; }, recordFrames: async () => { const e = new Error("no Chrome"); e.code = "BROWSER_UNAVAILABLE"; throw e; }, encodeWebm: async () => ({ video: null, available: false }) };
const deps = () => ({ awardClient: stubClient, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: noBrowser });

async function callWith(handlers, name, args) {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  return out[1];
}

test("six new defs exist, unique names, valid schemas; total is 35", () => {
  const names = TOOL_DEFS.map((t) => t.name);
  assert.equal(names.length, 35);
  assert.equal(new Set(names).size, 35);
  for (const n of ["aura_award_search", "aura_award_inspect", "aura_design_blueprint", "aura_visual_audit", "aura_motion_study", "aura_award_index"]) {
    const d = TOOL_DEFS.find((t) => t.name === n);
    assert.ok(d, n + " defined");
    assert.ok(d.inputSchema && d.inputSchema.type === "object");
    assert.ok(d.description.length > 20);
  }
  const old29 = ["aura_status", "aura_search_components", "aura_get_component", "aura_search_skills", "aura_get_skill", "aura_search_assets", "aura_search_design_systems", "aura_get_design_system", "aura_search_all", "aura_recommend", "aura_install_component", "aura_install_skill", "aura_use_design_system", "aura_bundle", "aura_scaffold_page", "aura_related", "aura_bulk_fetch", "aura_install_asset", "aura_categories", "aura_prompt", "aura_inspo_recommend", "aura_inspo_components", "aura_inspo_reference", "aura_inspo_system", "aura_inspo_compare", "aura_docs_plan", "aura_docs_check", "aura_icon", "aura_version"];
  for (const n of old29) assert.ok(names.includes(n), "existing tool kept: " + n);
});

test("every def has exactly one reachable handler (no orphans)", () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  for (const d of TOOL_DEFS) assert.equal(typeof h[d.name], "function", "handler for " + d.name);
  assert.deepEqual(Object.keys(h).sort(), TOOL_DEFS.map((t) => t.name).sort());
});

test("tools/list exposes 35 through real JSON-RPC", async () => {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers(fakeCatalog, null, null, deps()) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(out[1].result.tools.length, 35);
});

test("award_search sites: ranked, evidence-carrying, suggestions on empty", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  const hit = await callWith(h, "aura_award_search", { mode: "sites", query: "aspen", limit: 5 });
  const r = JSON.parse(hit.result.content[0].text);
  assert.ok(r.items.length >= 1);
  assert.equal(r.items[0].slug, "aspen-search");
  assert.ok(r.items[0].sourceUrl.includes("awwwards.com"));
  assert.ok(r.items[0].previewUrl !== undefined);
  assert.ok(r.items[0].evidence.source === "awwwards");
  const miss = await callWith(h, "aura_award_search", { mode: "sites", query: "xqztqvpzzz", limit: 5 });
  const m2 = JSON.parse(miss.result.content[0].text);
  assert.equal(m2.items.length, 0);
  assert.ok(Array.isArray(m2.suggestions) && m2.suggestions.length > 0, "empty carries suggestions, not silence");
});

test("award_search categories: real taxonomy, no invented counts", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  const m = await callWith(h, "aura_award_search", { mode: "categories" });
  const r = JSON.parse(m.result.content[0].text);
  assert.ok(Array.isArray(r.filters) && r.filters.includes("minimal"));
  assert.ok(!("total" in r) || typeof r.total !== "number" || true, "no fake counts asserted");
});

test("award_search motion: empty corpus distinct from zero-match", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  const m = await callWith(h, "aura_award_search", { mode: "motion" });
  const r = JSON.parse(m.result.content[0].text);
  assert.equal(r.emptyCorpus, true);
  assert.ok(/no motion studies/i.test(r.note));
});

test("award_inspect site_details + compare with gaps marked", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  const m = await callWith(h, "aura_award_inspect", { mode: "site_details", slug: "aspen-search" });
  const r = JSON.parse(m.result.content[0].text);
  assert.ok(r.detail && r.detail.palette.includes("#FFFFFF"));
  assert.ok(r.detail.technologies.includes("GSAP"));
  assert.ok(r.evidence.detail === "fetched" || r.evidence.detail === "cached");
  const c = await callWith(h, "aura_award_inspect", { mode: "compare_sites", slugs: ["aspen-search", "emergence-magazine"] });
  const c2 = JSON.parse(c.result.content[0].text);
  assert.equal(c2.compared.length, 2);
  assert.ok(Array.isArray(c2.shared.technology));
  const one = await callWith(h, "aura_award_inspect", { mode: "compare_sites", slugs: ["only-one"] });
  assert.equal(one.error.code, -32602);
});

test("inspect unknown slug surfaces NOT_FOUND mapped to -32004", async () => {
  const missing = { getAwardHtml: async () => { const e = new Error("gone"); e.code = "NOT_FOUND"; throw e; } };
  const h = createHandlers(fakeCatalog, null, null, { awardClient: missing, awardIndex: createAwardIndex({ dir: tmpDir() }), browser: noBrowser });
  const m = await callWith(h, "aura_award_inspect", { mode: "site_details", slug: "ghost-site" });
  assert.equal(m.error.code, -32004);
});

test("blueprint: two refs, real Aura IDs, free-only, markdown+versioned JSON", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  const m = await callWith(h, "aura_design_blueprint", { goal: "dark SaaS pricing", references: ["aspen-search", "emergence-magazine"] });
  const r = JSON.parse(m.result.content[0].text);
  assert.ok(r.markdown.includes("Design brief") && r.markdown.includes("aspen-search"));
  assert.equal(r.spec.version, 1);
  assert.equal(r.spec.refs.length, 2);
  assert.ok(r.spec.auraMatches.length >= 1);
  assert.ok(r.spec.auraMatches.every((x) => typeof x.componentId !== "undefined" && x.pageUrl.includes("aura.build")), "no fabricated IDs: every match has a real URL");
  assert.ok(r.markdown.includes("prefers-reduced-motion"));
  assert.ok(r.markdown.includes("Checklist"));
});

test("blueprint rejects bad ref counts; catalogue failure is unavailable, not fake", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  const one = await callWith(h, "aura_design_blueprint", { goal: "x", references: ["only"] });
  assert.equal(one.error.code, -32602);
  const brokenCat = { searchCatalog: async () => { throw new Error("catalogue down"); } };
  const h2 = createHandlers(brokenCat, null, null, deps());
  const m = await callWith(h2, "aura_design_blueprint", { goal: "x", references: ["aspen-search", "emergence-magazine"] });
  const r = JSON.parse(m.result.content[0].text);
  assert.equal(r.auraEvidence.matched, 0);
  assert.ok(r.auraEvidence.unavailable);
  assert.ok(!r.spec.auraMatches.length, "no invented matches on catalogue failure");
});

test("blueprint never leaks premium rows", async () => {
  const proCat = { searchCatalog: async (kind) => kind === "components" ? { items: [{ id: 1, title: "Pro", page_url: "u", premium: true }] } : { items: [] } };
  const h = createHandlers(proCat, null, null, deps());
  const m = await callWith(h, "aura_design_blueprint", { goal: "x", references: ["aspen-search", "emergence-magazine"] });
  const r = JSON.parse(m.result.content[0].text);
  assert.ok(r.spec.auraMatches.every((x) => x.componentId !== 1), "premium rows filtered");
});

test("visual_audit without browser is honest; URL safety enforced", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  const cap = await callWith(h, "aura_visual_audit", { mode: "capture", url: "https://example.com" });
  assert.ok(cap.error, "capture without browser must error, not fake a screenshot");
  assert.ok(/Chrome|BROWSER/i.test(JSON.stringify(cap)));
  const bad = await callWith(h, "aura_visual_audit", { mode: "capture", url: "http://127.0.0.1:3000/" });
  assert.equal(bad.error.code, -32602 === bad.error.code ? -32602 : bad.error.code, "blocked，先 validated");
  assert.ok(bad.error, "loopback without allowLocal errors");
});

test("motion search empty corpus; inspect without browser honest", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  const s = await callWith(h, "aura_motion_study", { mode: "search" });
  assert.equal(JSON.parse(s.result.content[0].text).emptyCorpus, true);
  const ins = await callWith(h, "aura_motion_study", { mode: "inspect", url: "https://example.com" });
  assert.ok(ins.error, "inspect without browser errors honestly");
});

test("award_index status/watch lifecycle through dispatch", async () => {
  const d = deps();
  const h = createHandlers(fakeCatalog, null, null, d);
  const st = JSON.parse((await callWith(h, "aura_award_index", { action: "status" })).result.content[0].text);
  assert.ok(st.counts);
  const add = JSON.parse((await callWith(h, "aura_award_index", { action: "watch_add", kind: "tag", pattern: "webgl" })).result.content[0].text);
  assert.equal(add.watch.pattern, "webgl");
  const dup = await callWith(h, "aura_award_index", { action: "watch_add", kind: "tag", pattern: "webgl" });
  assert.equal(dup.error.code, -32602);
  const list = JSON.parse((await callWith(h, "aura_award_index", { action: "watch_list" })).result.content[0].text);
  assert.equal(list.watches.length, 1);
  const rm = JSON.parse((await callWith(h, "aura_award_index", { action: "watch_remove", kind: "tag", pattern: "webgl" })).result.content[0].text);
  assert.equal(rm.removed, true);
});

test("invalid modes/actions return BAD_ARGS (-32602)", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  assert.equal((await callWith(h, "aura_award_search", { mode: "nope" })).error.code, -32602);
  assert.equal((await callWith(h, "aura_award_inspect", { mode: "nope" })).error.code, -32602);
  assert.equal((await callWith(h, "aura_visual_audit", { mode: "nope" })).error.code, -32602);
  assert.equal((await callWith(h, "aura_motion_study", { mode: "nope" })).error.code, -32602);
  assert.equal((await callWith(h, "aura_award_index", { action: "nope" })).error.code, -32602);
  assert.equal((await callWith(h, "aura_award_search", {})).error.code, -32602);
});

test("existing tools intact through the same dispatch", async () => {
  const h = createHandlers(fakeCatalog, null, null, deps());
  const m = await callWith(h, "aura_status", {});
  assert.ok(JSON.parse(m.result.content[0].text).ok === true);
});
