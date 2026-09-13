// catalog.test.mjs — hermetic tests for query building, shaping, caching.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchParams, buildUrl, shapeRow, createCatalog, pageUrl } from "../src/catalog.mjs";
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
