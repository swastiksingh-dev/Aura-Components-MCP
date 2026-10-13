// inspo.test.mjs — hermetic tests for the aura.inspo.* pure mappers + polish gates.
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/protocol.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";
import {
  buildInspoRecommend, buildInspoComponents, buildInspoReference,
  buildInspoSystem, buildInspoCompare, buildPrompt, inspoContrastWarn,
  INSPO_MACROS, INSPO_MACRO_TO_CATEGORY,
} from "../src/guide.mjs";

test("macro map covers all 19 macros with valid aura categories", () => {
  assert.equal(INSPO_MACROS.length, 19);
  const cats = ['hero', 'section', 'button', 'card', 'background', 'header', 'logo', 'feature', 'pricing', 'testimonial', 'footer', 'form', 'heading'];
  for (const m of INSPO_MACROS) assert.ok(cats.includes(INSPO_MACRO_TO_CATEGORY[m]), m);
});

test("recommend without macro returns need_macro gate (no generic scaffold)", () => {
  const r = buildInspoRecommend({ brief: "dark SaaS pricing" });
  assert.equal(r.need_macro, true);
  assert.equal(r.inspo_call.tool, "inspo.recommend");
  assert.deepEqual(r.palette_priority, ['brand_hex', 'inspo_evidence', 'aura_tokens']);
  assert.throws(() => buildInspoRecommend({}), (e) => e.code === "BAD_ARGS");
  assert.throws(() => buildInspoRecommend({ brief: "x", macrostructure: "nope" }), (e) => e.code === "BAD_ARGS");
});

test("recommend with macro maps to aura calls + brand_hex priority", () => {
  const r = buildInspoRecommend({ brief: "dark SaaS pricing", mode: "dark", vibe: "serious", macrostructure: "marquee-hero", brand_hex: "#c7402f" });
  assert.equal(r.need_macro, false);
  assert.equal(r.aura_category, "hero");
  assert.equal(r.aura_calls.length, 3);
  assert.equal(r.aura_calls[2].arguments.category, "hero");
  assert.equal(r.brand_hex, "#c7402f");
  assert.equal(r.next.tool, "aura_inspo_components");
});

test("components maps inspo type to aura category + scaffold hint", () => {
  const r = buildInspoComponents({ evidence: { type: "pricing", mode: "dark" }, brief: "saas pricing" });
  assert.equal(r.aura_category, "pricing");
  assert.equal(r.inspo_call.tool, "inspo.find_components");
  assert.equal(r.scaffold_hint.tokens_first, true);
  assert.throws(() => buildInspoComponents({ evidence: { type: "nope" } }), (e) => e.code === "BAD_ARGS");
  assert.throws(() => buildInspoComponents({}), (e) => e.code === "BAD_ARGS");
});

test("reference returns scoped adapt plan", () => {
  const r = buildInspoReference({ evidence: { type: "hero", id: "marquee" }, aura_component: { slug: "AbC-12" } });
  assert.equal(r.inspo_call.tool, "inspo.get_reference_jsx");
  assert.equal(r.aura_call.tool, "aura_get_component");
  assert.equal(r.adapt_plan.scope, "aura-abc12");
  assert.ok(r.adapt_plan.files.some((f) => f.path === "styles/tokens.css"));
});

test("system returns A/B/blend + question + contrast warn", () => {
  const r = buildInspoSystem({ inspo_tokens: { palette: ["#000000"], background: "#000000", text: "#111111", fonts: ["Inter"] }, aura_system: "nexus" });
  assert.deepEqual(r.question.options, ['A-inspo', 'B-aura', 'C-blend']);
  assert.ok(r.contrast_warning && r.contrast_warning.includes("below 4.5"));
  assert.equal(r.tokens_first, true);
  const ok = buildInspoSystem({ inspo_tokens: { palette: ["#ffffff"], background: "#ffffff", text: "#000000" }, aura_system: { slug: "s" } });
  assert.equal(ok.contrast_warning, null);
  assert.throws(() => buildInspoSystem({ inspo_tokens: { palette: ["zzz"] }, aura_system: "s" }), (e) => e.code === "BAD_ARGS");
});

test("inspoContrastWarn unit: black on near-black warns, black on white passes", () => {
  assert.ok(inspoContrastWarn("#000000", "#111111").includes("below 4.5"));
  assert.equal(inspoContrastWarn("#000000", "#ffffff"), null);
  assert.equal(inspoContrastWarn(null, "#fff"), null);
});

test("compare triangulates 2-4 slim sites, rejects autopsy + wrong counts", () => {
  const r = buildInspoCompare({ evidence: [{ slug: "a", macrostructure: "marquee-hero" }, { slug: "b", macrostructure: "marquee-hero" }] });
  assert.deepEqual(r.sites, ["a", "b"]);
  assert.equal(r.house_style.macrostructure, "marquee-hero");
  assert.equal(r.inspo_call.tool, "inspo.compare");
  assert.equal(r.ranked_components_query.arguments.category, "hero");
  assert.throws(() => buildInspoCompare({ evidence: [{ slug: "a" }] }), (e) => e.code === "BAD_ARGS");
  assert.throws(() => buildInspoCompare({ evidence: [{ slug: "a", autopsy: "x" }, { slug: "b" }] }), (e) => e.code === "BAD_ARGS");
});

test("prompt Pass2 suggested_calls start at inspo (polish order)", () => {
  const p2 = buildPrompt({ goal: "dark SaaS", answers: { theme: "dark", sections: ["hero"], system: "auto-pick", assets: "no", macrostructure: "marquee-hero", vibe: "serious" } });
  assert.equal(p2.suggested_calls[0].tool, "inspo.recommend");
  assert.equal(p2.suggested_calls[1].tool, "aura_inspo_recommend");
  assert.ok(p2.suggested_calls.some((c) => c.tool === "aura_scaffold_page"));
});

test("tools/list exposes 28 tools incl. 5 inspo mappers", async () => {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.ok(out[1].result.tools.length > 0);
  for (const n of ["aura_inspo_recommend", "aura_inspo_components", "aura_inspo_reference", "aura_inspo_system", "aura_inspo_compare", "aura_docs_plan", "aura_docs_check", "aura_icon", "aura_version"]) {
    assert.ok(out[1].result.tools.some((t) => t.name === n), n);
  }
});

test("inspo handlers validate args -> -32602, happy path returns text", async () => {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}) });
  const call = (id, name, args) => dispatch({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await call(2, "aura_inspo_recommend", { brief: "dark portfolio" });
  assert.equal(JSON.parse(out[1].result.content[0].text).need_macro, true);
  await call(3, "aura_inspo_recommend", {});
  assert.equal(out[2].error.code, -32602);
  await call(4, "aura_inspo_compare", { evidence: [{ slug: "only-one" }] });
  assert.equal(out[3].error.code, -32602);
});

test("scaffold Pro guard filters explicit Pro ids", async () => {
  const cat = {
    searchCatalog: async () => ({ items: [] }),
    bundleItems: async () => [
      { ok: true, item: { id: 1, slug: "free-a", title: "F", code: "<div></div>", tags: [], page_url: "u", premium: false } },
      { ok: true, item: { id: 2, slug: "pro-b", title: "P", code: "<div></div>", tags: [], page_url: "u", premium: true } },
    ],
    getItem: async () => ({ item: { title: "sys", content: "", preview_html: "" } }),
  };
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers(cat) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_scaffold_page", arguments: { goal: "x", components: ["1", "2"] } } });
  const s = JSON.parse(out[1].result.content[0].text);
  assert.equal(s.components.length, 1);
  assert.equal(s.components[0].slug, "free-a");
  assert.equal(s.pro_filtered_out, 1);
});
