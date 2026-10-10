// catalog.test.mjs — hermetic tests for query building, shaping, caching.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchParams, buildUrl, shapeRow, createCatalog, pageUrl, queryTokens, trendingIso, detectThemeHint, scoreRows, chunkText, matchOverlap } from "../src/catalog.mjs";
import { installGuide, tokenHints, detectNeeds, buildPrompt, combineScaffold, facets } from "../src/guide.mjs";

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
  const stub = { getJson: async (url) => { calls.push(url); if (calls.length === 1) return { rows: [], total: 0 }; return { rows: [{ id: 1, title: "Cinematic Hero", slug: "S", created_by: null }], total: 9 }; } };
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

test("negative_theme + min_views filter (gap 1)", async () => {
  const stub = { getJson: async () => ({ rows: [
    { id: 1, title: "Light Hero", description: "x", tags: [], code: "<div class=x bg-white></div>", background: "ffffff", views: 2, created_by: null },
    { id: 2, title: "Dark Hero", description: "x", tags: [], code: "<div class=x bg-black></div>", background: "000000", views: 50, created_by: null },
  ], total: 2 }) };
  const { facets } = await import("../src/guide.mjs");
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: facets });
  const r = await cat.searchCatalog("components", { query: "hero", limit: 5, negative_theme: "light", min_views: 10 });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, 2);
});

test("inline snippets on design/skill search (gap 4)", async () => {
  const stub = { getJson: async (url) => url.includes("preview_html") || (url.includes("design_systems") && url.includes("content")) || url.includes("id=in.")
    ? { rows: [{ id: "d1", content: "tokens here", preview_html: "<body>hi</body>" }], total: 1 }
    : { rows: [{ id: "d1", slug: "s", title: "t", description: "d", created_by: null }], total: 1 } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const r = await cat.searchCatalog("design_systems", { query: "x", limit: 2 });
  assert.equal(String(r.items[0].preview_snippet).slice(0, 6), "<body>");
});

test("commercial_ok:true explains instead of silence (gap 5)", async () => {
  const { facets } = await import("../src/guide.mjs");
  assert.equal(facets("assets", { id: 1, image_800w: "u" }).commercial_ok, false);
});

test("editorialPicks orders forks-first server-side (gap 2)", async () => {
  let seenUrl = "";
  const stub = { getJson: async (url) => { seenUrl = url; return { rows: [{ id: 1, title: "a", slug: "a", code: "x", background: "fff", views: 1, forks: 2, created_by: null }], total: 1 }; } };
  const { facets } = await import("../src/guide.mjs");
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: facets });
  const p = await cat.editorialPicks(2);
  assert.ok(seenUrl.includes("order=forks.desc"));
  assert.equal(p.length, 1);
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

test("guide: combineScaffold merges deps once + files in order", () => {
  const sys = { title: "S" };
  const comps = [
    { title: "A", slug: "a", premium: false, code: '<div class="x"></div>', tags: [], page_url: "u" },
    { title: "B", slug: "b", premium: false, code: '<div class="y"></div>', tags: [], page_url: "u" },
  ];
  const r = combineScaffold(sys, comps);
  assert.deepEqual(r.combined_deps.map((d) => d.name), ["tailwindcss"]);
  assert.deepEqual(r.files.map((f) => f.path), ["styles/tokens.css", "DESIGN.md", "components/a.html", "components/b.html"]);
  assert.equal(r.guides.length, 2);
  const empty = combineScaffold(null, []);
  assert.deepEqual(empty.files.map((f) => f.path), ["styles/tokens.css"]);
});

test("guide: buildPrompt Pass1 draft requires user confirmation", () => {
  const p1 = buildPrompt({ goal: "dark SaaS pricing" });
  assert.equal(p1.phase, "draft");
  assert.equal(p1.questions.length, 6);
  assert.ok(p1.draft_prompt.includes("dark SaaS pricing"));
  assert.ok(p1.next_call.tool === "aura_prompt");
  assert.throws(() => buildPrompt({}), (e) => e.code === "BAD_ARGS");
});

test("guide: buildPrompt Pass2 final is copy-paste with order + calls", () => {
  const p2 = buildPrompt({ goal: "dark SaaS pricing", answers: { theme: "dark", sections: ["hero", "pricing"], system: "auto-pick", assets: "no" } });
  assert.equal(p2.phase, "final");
  assert.ok(p2.final_prompt.includes("container mx-auto px-4"));
  assert.deepEqual(p2.plan_order, ['1 tokens.css', '2 system preview_html', '3 component markup in listed order']);
  assert.ok(p2.suggested_calls.some((c) => c.tool === "aura_scaffold_page"));
});

test("safety net refusal: nonsense query returns honest empty", async () => {
  const stub = { getJson: async (url) => {
    if (url.includes("ilike")) return { rows: [], total: 0 }; // phrase + OR passes miss
    return { rows: [{ id: 9, title: "popular hero", slug: "PH9", code: "x".repeat(50), created_by: null }], total: 99 };
  } };
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: facets });
  const r = await cat.searchCatalog("components", { query: "xqztqvpzzzqqq", limit: 3 });
  assert.equal(r.items.length, 0);
  assert.equal(r.total, 0);
  assert.equal(r.isFallback, false);
  assert.equal(r.no_match, true);
  assert.equal(r.refused_fallback, "popular-safety-net");
  assert.ok(Array.isArray(r.suggested_queries) && r.suggested_queries.length > 0);
});

test("slim lists drop blobs by default, slim:false keeps them", async () => {
  const stub = { getJson: async () => ({ rows: [{ id: 1, title: "t", slug: "S", code: "x".repeat(500), created_by: null }], total: 1 }) };
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: facets });
  const slim = await cat.searchCatalog("components", { query: "t", limit: 1 });
  assert.ok(!("code" in slim.items[0]));
  assert.ok(slim.items[0].code_excerpt.length > 0 && slim.items[0].full_fetch);
  const full = await cat.searchCatalog("components", { query: "t", limit: 1, slim: false });
  assert.ok(typeof full.items[0].code === "string");
});

test("facets probe full code: late data-lucide marks needsIcons", () => {
  const row = shapeRow("components", { slug: "S", code: "x".repeat(700) + ' <i data-lucide="home"></i>' }, cfg, facets);
  assert.equal(row.facets.needsIcons, true);
});

test("has_preview is a real boolean for snippet-enriched systems", async () => {
  const stub = { getJson: async (url) => {
    if (url.includes("id=in.")) return { rows: [{ id: "u1", content: "tokens", preview_html: "<div>hi</div>" }], total: 1 };
    return { rows: [{ id: "u1", slug: "s1", title: "sys", created_by: null }], total: 1 };
  } };
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: facets });
  const r = await cat.searchCatalog("design_systems", { query: "sys", limit: 1 });
  assert.equal(r.items[0].facets.has_preview, true);
});

test("safety-net-kept: popular title containing a token is kept", async () => {
  const stub = { getJson: async (url) => {
    if (url.includes("ilike")) return { rows: [], total: 0 };
    return { rows: [{ id: 9, title: "popular hero", slug: "PH9", code: "x".repeat(50), created_by: null }], total: 99 };
  } };
  const { facets: f } = await import("../src/guide.mjs");
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: f });
  const r = await cat.searchCatalog("components", { query: "hero", limit: 3 });
  assert.equal(r.isFallback, true);
  assert.equal(r.fallback, "popular-safety-net");
  assert.ok(r.items.length > 0);
});

test("or-tokens refusal: fallback rows with zero title overlap return honest empty", async () => {
  const calls = [];
  const stub = { getJson: async (url) => { calls.push(url); if (calls.length === 1) return { rows: [], total: 0 }; return { rows: [{ id: 1, title: "Unrelated Stuff", slug: "S", created_by: null }], total: 1 }; } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const r = await cat.searchCatalog("components", { query: "dark cinematic portfolio", limit: 5 });
  assert.equal(r.items.length, 0);
  assert.equal(r.total, 0);
  assert.equal(r.isFallback, false);
  assert.equal(r.no_match, true);
  assert.ok((r.refused_fallback || "").startsWith("or-tokens:"));
  assert.ok(Array.isArray(r.suggested_queries) && r.suggested_queries.length > 0);
});

test("theme reorder keeps all rows dark-first with theme_deprioritized", async () => {
  const stub = { getJson: async () => ({ rows: [
    { id: 1, title: "Light SaaS Testimonial", description: "x", tags: ["testimonial"], code: "<div class=x bg-white></div>", background: "ffffff", views: 5, created_by: null },
    { id: 2, title: "Dark Portfolio Hero", description: "cinematic portfolio", tags: ["hero", "dark"], code: "<div class=x bg-black></div>", background: "000000", views: 3, created_by: null },
  ], total: 2 }) };
  const { facets: f } = await import("../src/guide.mjs");
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: f });
  const r = await cat.searchCatalog("components", { query: "dark cinematic portfolio", freeOnly: true, limit: 5 });
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].id, 2);
  assert.equal(r.theme_hint, "dark");
  assert.equal(r.theme_checked, 2);
  assert.equal(r.theme_kept, 2);
  assert.equal(r.theme_deprioritized, 1);
  assert.ok(!("theme_filtered_out" in r));
});

test("exact_match does exactly 1 fetch on miss", async () => {
  let calls = 0;
  const stub = { getJson: async () => { calls++; return { rows: [], total: 0 }; } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const r = await cat.searchCatalog("components", { query: "dark cinematic portfolio", limit: 5, exact_match: true });
  assert.equal(calls, 1);
  assert.equal(r.items.length, 0);
  assert.equal(r.total, 0);
  assert.equal(r.isFallback, false);
  assert.ok(Array.isArray(r.suggested_queries) && r.suggested_queries.length > 0);
});

test("DS ors include content.ilike+preview_html.ilike", () => {
  const { ors } = buildSearchParams("design_systems", { query: "portfolio", sort: "popular", limit: 5, offset: 0 });
  assert.ok(ors.join(",").includes("content.ilike"));
  assert.ok(ors.join(",").includes("preview_html.ilike"));
});

test("DS OR fallback includes content+preview_html", async () => {
  const seen = [];
  const stub = { getJson: async (url) => { seen.push(url); if (seen.length === 1) return { rows: [], total: 0 }; return { rows: [{ id: "d1", slug: "s", title: "Portfolio System", created_by: null }], total: 1 }; } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const r = await cat.searchCatalog("design_systems", { query: "portfolio system", limit: 5 });
  const orUrl = seen.find((u) => u.includes("or=("));
  assert.ok(orUrl.includes("content.ilike"));
  assert.ok(orUrl.includes("preview_html.ilike"));
  assert.ok(r.items.length > 0);
});

test("getItem full returns whole code chunks:1", async () => {
  const stub = { getJson: async () => ({ rows: [{ id: 9, title: "t", slug: "S", code: "x".repeat(300), background: "fff", created_by: null }], total: 1 }) };
  const { facets: f } = await import("../src/guide.mjs");
  const cat = createCatalog({ fetcher: stub, config: cfg, facetsFn: f });
  const g = await cat.getItem("components", 9, { full: true });
  assert.equal(g.item.code.length, 300);
  assert.deepEqual([g.item.code_info.chunks, g.item.code_info.chunk, g.item.code_info.truncated], [1, 0, false]);
  assert.equal(g.item.code_info.full_length, 300);
});

test("skills desc-only kept: OR-pass description match is not refused", async () => {
  const seen = [];
  const stub = { getJson: async (url) => {
    if (url.includes("id=in.")) return { rows: [{ id: "s1", content: "snippet here", source_url: "https://x/a" }], total: 1 };
    seen.push(url);
    if (seen.length === 1) return { rows: [], total: 0 };
    return { rows: [{ id: "s1", title: "Generic Guide", description: "Learn react animation techniques", source_url: "https://x/a", views: 3, created_by: null }], total: 1 };
  } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const r = await cat.searchCatalog("skills", { query: "react animation", limit: 3 });
  assert.ok(r.items.length > 0);
  assert.equal(r.isFallback, true);
  assert.ok(!r.no_match);
  assert.ok((r.fallback || "").startsWith("or-tokens:"));
});

test("components desc-only still refused: title-only gate stays strict", async () => {
  const seen = [];
  const stub = { getJson: async (url) => { seen.push(url); if (seen.length === 1) return { rows: [], total: 0 }; return { rows: [{ id: 1, title: "Generic Guide", description: "Learn react animation techniques", slug: "G1", created_by: null }], total: 1 }; } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const r = await cat.searchCatalog("components", { query: "react animation", limit: 3 });
  assert.equal(r.items.length, 0);
  assert.equal(r.total, 0);
  assert.equal(r.no_match, true);
  assert.ok((r.refused_fallback || "").startsWith("or-tokens:"));
});

test("matchOverlap unit: title-only for components, wide net for skills", () => {
  // components: tags do NOT count, description does NOT count
  assert.equal(matchOverlap("components", ["react", "animation"], { title: "React Starter", description: "animation galore", tags: ["animation"] }), 1);
  assert.equal(matchOverlap("components", ["react"], { title: "Generic", description: "react stuff", tags: ["react"] }), 0);
  assert.equal(matchOverlap("assets", ["hero"], { title: "Generic", description: "hero shot" }), 0);
  // skills: description counts
  assert.equal(matchOverlap("skills", ["react", "animation"], { title: "Generic", description: "react animation guide" }), 2);
  assert.equal(matchOverlap("skills", ["react"], { title: "Generic", description: "nothing here", tags: ["react"] }), 1);
  assert.equal(matchOverlap("design_systems", ["tokens"], { title: "Generic", description: "x", tokens_snippet: "design tokens here" }), 1);
});

test("getStatus freshness keys present (MAX updated_at per table)", async () => {
  const stub = { getJson: async (url) => {
    if (url.includes("select=updated_at")) return { rows: [{ updated_at: "2026-07-27T00:00:00.000Z" }], total: 1 };
    return { rows: [{ id: 1 }], total: 5 };
  } };
  const cat = createCatalog({ fetcher: stub, config: cfg });
  const s = await cat.getStatus();
  assert.ok(s.freshness);
  assert.equal(s.freshness.components, "2026-07-27T00:00:00.000Z");
  assert.equal(s.freshness.skills, "2026-07-27T00:00:00.000Z");
  assert.equal(s.freshness.assets, "2026-07-27T00:00:00.000Z");
  assert.equal(s.freshness.design_systems, "2026-07-27T00:00:00.000Z");
  assert.ok("components_free" in s.counts);
});
