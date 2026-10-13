// access.test.mjs — central free-only policy across every retrieval path.
// A caller must not reach restricted content by supplying a known ID.
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/protocol.mjs";
import { createHandlers } from "../src/tools.mjs";
import { createCatalog, isFreeRow } from "../src/catalog.mjs";
import { facets } from "../src/guide.mjs";

const cfg = { supabaseUrl: "https://x.supabase.co", anonKey: "k", timeoutMs: 1000, retries: 0, cacheTtlMs: 60000, defaultLimit: 10, maxLimit: 25, codeChars: 100, contentChars: 100, freeOnlyDefault: true, userAgent: "t" };
const SECRET = "SECRET-MARKUP-9ZQ";

const compRow = (id, premium) => {
  const r = { id, slug: "s" + id, title: "T" + id, description: "d", tags: ["hero"], code: "<div>" + SECRET + "-" + id + "</div>", views: 10, created_by: null, background: "fff" };
  if (premium !== "missing") r.premium = premium;
  return r;
};
// id -> row. 1 free, 2 pro, 3 ambiguous (no premium key), 5 free.
const DB = { 1: compRow(1, false), 2: compRow(2, true), 3: compRow(3, "missing"), 5: compRow(5, false) };

function stubCatalog() {
  const seen = [];
  const fetcher = {
    getJson: async (url) => {
      seen.push(url);
      if (url.includes("/rest/v1/skills?") || url.includes("/rest/v1/design_systems?")) {
        return { rows: [{ id: "u1", slug: "sys", title: "S", content: "x", created_by: null }], total: 1 };
      }
      if (url.includes("/rest/v1/assets?") && url.includes("id=eq.")) {
        const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
        if (id === "9") return { rows: [{ id: 9, title: "A", premium: true, image_800w: "u", created_by: null }], total: 1 };
        return { rows: [], total: 0 };
      }
      if (url.includes("id=eq.")) {
        const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]);
        return DB[id] ? { rows: [DB[id]], total: 1 } : { rows: [], total: 0 };
      }
      if (url.includes("slug=eq.")) {
        const slug = decodeURIComponent(url.match(/slug=eq\.([^&]+)/)[1]);
        const row = Object.values(DB).find((r) => r.slug === slug);
        return row ? { rows: [row], total: 1 } : { rows: [], total: 0 };
      }
      return { rows: [], total: 0 };
    },
  };
  return { cat: createCatalog({ fetcher, config: cfg, facetsFn: facets }), seen };
}

test("isFreeRow: only components/assets gate on premium===false (fail-closed)", () => {
  assert.equal(isFreeRow("components", { premium: false }), true);
  assert.equal(isFreeRow("components", { premium: true }), false);
  assert.equal(isFreeRow("components", {}), false);
  assert.equal(isFreeRow("components", null), false);
  assert.equal(isFreeRow("assets", { premium: true }), false);
  assert.equal(isFreeRow("skills", {}), true);
  assert.equal(isFreeRow("design_systems", {}), true);
});

test("getItem: free component returns full payload", async () => {
  const { cat } = stubCatalog();
  const got = await cat.getItem("components", 1);
  assert.ok(got.item.code.includes(SECRET + "-1"));
  assert.equal(got.item.premium, false);
});

test("getItem: Pro component refused with BAD_ARGS and no payload leak", async () => {
  const { cat } = stubCatalog();
  const err = await cat.getItem("components", 2).then(() => null, (e) => e);
  assert.ok(err && err.code === "BAD_ARGS");
  assert.ok(/Pro \(paid\)/.test(err.message));
  assert.ok(!err.message.includes(SECRET), "refusal must not leak restricted markup");
});

test("getItem: ambiguous entitlement (no premium key) refused, skills unaffected", async () => {
  const { cat } = stubCatalog();
  await assert.rejects(() => cat.getItem("components", 3), (e) => e.code === "BAD_ARGS");
  const s = await cat.getItem("skills", "u1");
  assert.equal(s.item.id, "u1");
  await assert.rejects(() => cat.getItem("assets", 9), (e) => e.code === "BAD_ARGS");
});

test("getItem: refusals are never cached (fail-closed on every call)", async () => {
  let calls = 0;
  const fetcher = { getJson: async () => { calls++; return { rows: [compRow(2, true)], total: 1 }; } };
  const cat = createCatalog({ fetcher, config: cfg, facetsFn: facets });
  await assert.rejects(() => cat.getItem("components", 2), (e) => e.code === "BAD_ARGS");
  await assert.rejects(() => cat.getItem("components", 2), (e) => e.code === "BAD_ARGS");
  assert.equal(calls, 2);
});

test("bundleItems: mixed free/pro/missing keeps batch alive without leaks", async () => {
  const { cat } = stubCatalog();
  const out = await cat.bundleItems("components", [1, 2, 999, 3]);
  assert.equal(out.length, 4);
  assert.equal(out[0].ok, true);
  assert.ok(out[0].item.code.includes(SECRET + "-1"));
  assert.equal(out[1].ok, false);
  assert.ok(/Pro \(paid\)/.test(out[1].error) && !out[1].error.includes(SECRET));
  assert.equal(out[2].ok, false);
  assert.equal(out[2].error, "not found");
  assert.equal(out[3].ok, false, "ambiguous entitlement also refused per-item");
});

test("handlers: install Pro -> -32602, scaffold drops Pro, related on Pro base errors", async () => {
  const { cat, seen } = stubCatalog();
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: [], handlers: createHandlers(cat) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const call = (id, name, args) => dispatch({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  await call(2, "aura_install_component", { id: 2 });
  assert.equal(out[1].error.code, -32602);
  assert.ok(!out[1].error.message.includes(SECRET));
  await call(3, "aura_scaffold_page", { goal: "x", components: ["1", "2"] });
  const s = JSON.parse(out[2].result.content[0].text);
  assert.equal(s.components.length, 1);
  assert.equal(s.components[0].id, 1);
  assert.equal(s.dropped_refs, 1, "refused Pro ref disclosed, never silently dropped");
  await call(4, "aura_related", { kind: "components", id: 2 });
  assert.equal(out[3].error.code, -32602);
  await call(5, "aura_related", { kind: "components", id: 1 });
  const relUrl = seen.find((u) => u.includes("neq.1"));
  assert.ok(relUrl && relUrl.includes("premium=eq.false"), "related discovery stays free-only upstream");
});
