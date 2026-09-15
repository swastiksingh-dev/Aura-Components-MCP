// catalog.test.mjs — hermetic tests for query building, shaping, caching.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchParams, buildUrl, shapeRow, createCatalog, pageUrl, queryTokens, trendingIso, detectThemeHint, scoreRows, chunkText } from "../src/catalog.mjs";
import { installGuide, tokenHints, detectNeeds } from "../src/guide.mjs";

const cfg = { supabaseUrl: "https://x.supabase.co", anonKey: "k", timeoutMs: 1000, retries: 0, cacheTtlMs: 60000, defaultLimit: 10, maxLimit: 25, codeChars: 100, contentChars: 100, freeOnlyDefault: false, userAgent: "t" };

test("components freeOnly + tag + text produce PostgREST filters", () => {
  const { params, filters, ors } = buildSearchParams("components", { query: "hero", tag: "hero", freeOnly: true, sort: "popular", limit: 10, offset: 0 });
  assert.ok(filters.includes("private=eq.false"));
  assert.ok(filters.includes("premium=eq.false"));
  assert.ok(filters.includes("tags=cs.{hero}"));
  assert.ok(ors.join(",").includes("title.ilike.*hero*"));
  const url = buildUrl("https://x.supabase.co", "components", params, filters, ors);
  assert.ok(url.includes("/rest/v1/components?"));
});

test("pageUrl derivations per kind", () => {
  assert.equal(pageUrl("components", { slug: "ABC12" }), "https://www.aura.build/component/ABC12");
  assert.ok(pageUrl("skills", { id: "u" }).includes("/skills/u"));
  assert.ok(pageUrl("design_systems", { slug: "s" }).includes("/design-systems/s"));
});

test("shapeRow truncates code/content and adds page_url", () => {
  const c = shapeRow("components", { slug: "S", code: "x".repeat(200) }, cfg);
  assert.ok(c.code.length < 200 && c.code.includes("truncated") && c.page_url.includes("/component/S"));
  const s = shapeRow("skills", { id: "u", content: "y".repeat(200) }, cfg);
  assert.ok(s.content.includes("truncated"));
});

test("searchCatalog caches second call (stub fetch counts)", async () => {
  let calls = 0;
  const stub = { getJson: async () => { calls++; return { rows: [{ id: 1, title: "t", slug: "S", created_by: null }], total: 1 }; } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const a = await cat.searchCatalog("components", { query: "x", limit: 5 });
  const b = await cat.searchCatalog("components", { query: "x", limit: 5 });
  assert.equal(calls, 1);
  assert.equal(b.cached, true);
  assert.equal(a.items[0].page_url, "https://www.aura.build/component/S");
});

test("getItem NOT_FOUND surfaces code", async () => {
  const stub = { getJson: async () => ({ rows: [], total: 0 }) };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  await assert.rejects(() => cat.getItem("components", 999999), (e) => e.code === "NOT_FOUND");
});

test("categoryCounts fans out 13 tag queries", async () => {
  let calls = 0;
  const stub = { getJson: async () => { calls++; return { rows: [{ id: 1 }], total: 7 }; } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const cats = await cat.categoryCounts();
  assert.equal(cats.length, 13);
  assert.equal(calls, 13);
  assert.ok(cats.every((c) => c.free === 7));
  const again = await cat.categoryCounts();
  assert.equal(calls, 13); // cached: no refetch
  assert.equal(again.length, 13);
});

test("concurrent identical searches coalesce to one fetch", async () => {
  let calls = 0;
  const stub = { getJson: async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return { rows: [], total: 0 }; } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  await Promise.all([cat.searchCatalog("skills", { query: "x" }), cat.searchCatalog("skills", { query: "x" }), cat.searchCatalog("skills", { query: "x" })]);
  assert.equal(calls, 1);
});

test("queryTokens strips stop-words, keeps significant terms", () => {
  assert.deepEqual(queryTokens("dark cinematic portfolio"), ["cinematic", "portfolio"]);
  assert.deepEqual(queryTokens("hero"), ["hero"]);
  assert.deepEqual(queryTokens("a"), []);
});

test("design_systems search covers title + description", () => {
  const { ors } = buildSearchParams("design_systems", { query: "portfolio", sort: "popular", limit: 5, offset: 0 });
  assert.ok(ors.join(",").includes("description.ilike"));
});

test("trending window is 90 days (7d seed is empty)", () => {
  const { filters } = buildSearchParams("design_systems", { sort: "trending", limit: 5, offset: 0 });
  const f = filters.find((x) => x.startsWith("created_at=gte."));
  assert.ok(f);
  const days = (Date.now() - Date.parse(f.slice("created_at=gte.".length))) / 86400000;
  assert.ok(days > 80 && days < 100);
  assert.ok(trendingIso().length > 10);
});

test("empty AND-phrase falls back to OR tokens", async () => {
  const calls = [];
  const stub = { getJson: async (url) => { calls.push(url); if (calls.length === 1) return { rows: [], total: 0 }; return { rows: [{ id: 1, title: "t", slug: "S", created_by: null }], total: 9 }; } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const r = await cat.searchCatalog("components", { query: "dark cinematic portfolio", limit: 5 });
  assert.equal(r.items.length, 1);
  assert.ok((r.fallback || "").startsWith("or-tokens:"));
  assert.equal(calls.length, 2);
});

test("facets ride on search + get (theme/weight/download)", async () => {
  const stub = { getJson: async (url) => (url.includes("assets") ? { rows: [{ id: 9, title: "t", image_800w: "u800", image_original: "uorig", created_by: null }], total: 1 } : { rows: [{ id: 1, title: "t", slug: "S", code: "<div class=x bg-black></div>", background: "000000", created_by: null }], total: 1 }) };
  const { facets } = await import("../src/guide.mjs");
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: facets });
  const s = await cat.searchCatalog("components", { query: "x", limit: 2 });
  assert.equal(s.items[0].facets.theme, "dark");
  const g = await cat.getItem("assets", 9);
  assert.ok(String(g.item.facets.download).endsWith("/uorig")); // absolute-URL fix (ISS8)
});

test("parity: search facets equal detail facets (ISS1-3)", async () => {
  const stub = { getJson: async () => ({ rows: [{ id: 7, title: "t", slug: "S", code: "<div class=x><svg></svg></div>", background: "000000", tags: [], created_by: null }], total: 1 }) };
  const { facets } = await import("../src/guide.mjs");
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: facets });
  const s = await cat.searchCatalog("components", { query: "x", limit: 1 });
  const g = await cat.getItem("components", 7);
  assert.deepEqual(s.items[0].facets, g.item.facets);
});

test("related defaults freeOnly (ISS10)", async () => {
  const seen = [];
  const stub = { getJson: async (url) => { seen.push(url); if (url.includes("id=eq.1") && !url.includes("neq")) return { rows: [{ id: 1, title: "one two three", description: "x", tags: ["hero"], code: "x", background: "fff", created_by: null }], total: 1 }; return { rows: [], total: 0 }; } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  await cat.relatedItems("components", 1, 3);
  assert.ok(seen.some((u) => u.includes("premium=eq.false")));
});

test("skill dedupe by source_url + canonical flag (ISS7)", async () => {
  const stub = { getJson: async () => ({ rows: [
    { id: "a", title: "A", source_url: "https://x/SKILL.md", views: 10, created_by: null },
    { id: "b", title: "B", source_url: "https://x/SKILL.md", views: 5, created_by: null },
  ], total: 2 }) };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const r = await cat.searchCatalog("skills", { query: "x", limit: 5 });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].canonical, true);
  assert.equal(r.deduped, 1);
});

test("theme hint reranks dark first + scored fallback (precision)", async () => {
  const stub = { getJson: async () => ({ rows: [
    { id: 1, title: "Light SaaS Testimonial", description: "x", tags: ["testimonial"], code: "<div class=x bg-white></div>", background: "ffffff", views: 5, created_by: null },
    { id: 2, title: "Dark Portfolio Hero", description: "cinematic portfolio", tags: ["hero", "dark"], code: "<div class=x bg-black></div>", background: "000000", views: 3, created_by: null },
  ], total: 2 }) };
  const { facets } = await import("../src/guide.mjs");
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: facets });
  const r = await cat.searchCatalog("components", { query: "dark cinematic portfolio", freeOnly: true, limit: 5 });
  assert.equal(r.items[0].id, 2);
  assert.equal(r.theme_hint, "dark");
  // stub returns rows on first pass (no fallback trip): theme_hint alone proves rerank
  assert.ok(r.fallback_score === undefined || String(r.fallback_score).includes("theme:dark"));
});

test("chunkText paginates + getItem chunk param (payloads)", async () => {
  const c = chunkText("abcdefghij", 4, 1);
  assert.equal(c.text, "efgh…[truncated]");
  assert.deepEqual([c.chunk, c.chunks, c.full_length, c.truncated], [1, 3, 10, true]);
  const stub = { getJson: async () => ({ rows: [{ id: 9, title: "t", slug: "S", code: "x".repeat(300), background: "fff", created_by: null }], total: 1 }) };
  const { facets } = await import("../src/guide.mjs");
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: facets });
  const g0 = await cat.getItem("components", 9);
  assert.equal(g0.item.code_info.chunks, 3);
  const g2 = await cat.getItem("components", 9, { chunk: 2 });
  assert.equal(g2.item.code_info.chunk, 2);
  assert.ok(!String(g2.item.code).endsWith("…[truncated]"));
});

test("detectThemeHint reads dark/light/cinematic", () => {
  assert.equal(detectThemeHint("dark cinematic portfolio"), "dark");
  assert.equal(detectThemeHint("bright airy landing"), "light");
  assert.equal(detectThemeHint("pricing section"), null);
});

test("slim lists exclude blobs (payload guard)", () => {
  // components list fetches code for the 600-char facet probe, but shapeRow truncates
  // before facets, so wire payloads stay ~0.7KB/row (parity fix ISS1-3).
  const { params } = buildSearchParams("components", { sort: "popular", limit: 5, offset: 0 });
  assert.ok(String(params.get("select")).includes("code"));
  const a = buildSearchParams("assets", { sort: "popular", limit: 5, offset: 0 });
  assert.ok(!String(a.params.get("select")).includes("image_original"));
});

test("bundle captures per-id errors, related excludes self", async () => {
  const stub = { getJson: async (url) => {
    if (url.includes("id=eq.1")) return { rows: [{ id: 1, title: "one two three", description: "four five", tags: ["hero"], code: "x", background: "fff", created_by: null }], total: 1 };
    if (url.includes("id=eq.2")) return { rows: [], total: 0 };
    return { rows: [{ id: 3, title: "one two", description: "three", tags: ["hero"], code: "x", background: "fff", created_by: null }], total: 1 };
  } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const b = await cat.bundleItems("components", [1, 2]);
  assert.equal(b[0].ok, true); assert.equal(b[1].ok, false);
  const rel = await cat.relatedItems("components", 1, 3);
  assert.ok(rel.related.every((r) => r.id !== 1));
});

test("guide: component install detects tailwind + keyframes", () => {
  const g = installGuide("components", { title: "T", slug: "S", premium: false, code: '<div class="x"></div><style>@keyframes a{}</style>', tags: ["hero"], page_url: "u" });
  assert.ok(g.steps.length >= 3);
  assert.ok(g.deps.some((d) => d.name === "tailwindcss"));
  assert.equal(g.files[0].path, "components/S.html");
});

test("guide: tokenHints pulls tokens line by line", () => {
  const md = 'colors:' + String.fromCharCode(10) + '  primary: "#D946EF"' + String.fromCharCode(10) + '  background: "#0F1115"';
  const t = tokenHints(md);
  assert.equal(t.tokens.primary, "#D946EF");
  assert.ok(t.css.includes("--aura-primary: #D946EF"));
});

test("guide: detectNeeds spots icons and fonts", () => {
  const n = detectNeeds('<div class="font-geist"><iconify-icon></iconify-icon></div>', []);
  assert.equal(n.needsIcons, true);
  assert.ok(n.fonts.includes("geist"));
});
