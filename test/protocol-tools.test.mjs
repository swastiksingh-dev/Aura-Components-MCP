// protocol-tools.test.mjs — handshake gating, unknown tool, arg validation.
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/protocol.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";

const fakeCatalog = {
  getStatus: async () => ({ ok: true }),
  searchCatalog: async (kind, q) => ({ kind, q }),
  getItem: async (kind, id) => ({ kind, id }),
  categoryCounts: async () => [],
};

async function run(msgs) {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers(fakeCatalog) });
  for (const m of msgs) await dispatch(m);
  return out;
}

async function runWith(catalog, msgs) {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers(catalog) });
  for (const m of msgs) await dispatch(m);
  return out;
}

test("tools/list blocked before initialize", async () => {
  const out = await run([{ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }]);
  assert.equal(out[0].error.code, -32600);
});

test("initialize -> list -> call aura_status", async () => {
  const out = await run([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "aura_status", arguments: {} } },
  ]);
  assert.equal(out[0].result.serverInfo.name, "aura-components-mcp");
  assert.match(out[0].result.serverInfo.version, /^\d+\.\d+\.\d+$/);
  assert.ok(out[1].result.tools.length > 0);
  assert.ok(out[2].result.content[0].text.includes('"ok": true'));
});

test("tool registry integrity: defs and handlers agree, no duplicates", async () => {
  const names = TOOL_DEFS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "duplicate tool names");
  for (const t of TOOL_DEFS) {
    assert.ok(t.inputSchema && typeof t.inputSchema === "object", t.name + " needs an inputSchema");
    assert.equal(typeof t.description, "string", t.name + " needs a description");
  }
  const handlers = createHandlers(fakeCatalog);
  const hkeys = Object.keys(handlers);
  assert.deepEqual(new Set(hkeys).size, hkeys.length);
  for (const n of names) assert.equal(typeof handlers[n], "function", "no handler for " + n);
  for (const k of hkeys) assert.ok(names.includes(k), "orphan handler without definition: " + k);
  const out = await run([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  ]);
  assert.deepEqual(out[1].result.tools.map((t) => t.name).sort(), [...names].sort());
});

test("aura_prompt Pass1 draft + Pass2 final, missing goal -> -32602", async () => {
  const out = await run([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_prompt", arguments: { goal: "dark SaaS pricing" } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "aura_prompt", arguments: { goal: "dark SaaS pricing", answers: { theme: "dark", sections: ["hero", "pricing"], system: "auto-pick", assets: "no" } } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "aura_prompt", arguments: {} } },
  ]);
  const p1 = JSON.parse(out[1].result.content[0].text);
  assert.equal(p1.phase, "draft");
  assert.equal(p1.questions.length, 6);
  assert.ok(p1.next_call && p1.next_call.tool === "aura_prompt");
  const p2 = JSON.parse(out[2].result.content[0].text);
  assert.equal(p2.phase, "final");
  assert.ok(p2.final_prompt.includes("dark SaaS pricing"));
  assert.deepEqual(p2.plan_order, ['1 tokens.css', '2 system preview_html', '3 component markup in listed order']);
  assert.equal(out[3].error.code, -32602);
});

test("unknown tool -> -32601; bad args -> -32602", async () => {
  const out = await run([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "nope", arguments: {} } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "aura_get_skill", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "aura_search_components", arguments: { sort: "bogus" } } },
  ]);
  assert.equal(out[1].error.code, -32601);
  assert.equal(out[2].error.code, -32602);
  assert.equal(out[3].error.code, -32602);
});

test("aura_trending removed: absent from list, call -> -32601", async () => {
  const out = await run([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "aura_trending", arguments: { limit: 2 } } },
  ]);
  assert.ok(out[1].result.tools.length > 0);
  assert.ok(!out[1].result.tools.some((t) => t.name === "aura_trending"));
  assert.equal(out[2].error.code, -32601);
});

test("recommend caps 3/surface + commercial note", async () => {
  const many = (k) => ({ items: [1, 2, 3, 4, 5].map((i) => ({ title: k + i, page_url: "u" + i })) });
  const cat = { ...fakeCatalog, searchCatalog: async (kind, q) => ({ items: many(kind).items.slice(0, (q && q.limit) || 10), total: 5 }) };
  const out = await runWith(cat, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_recommend", arguments: { goal: "hero" } } },
  ]);
  const r = JSON.parse(out[1].result.content[0].text);
  assert.ok(r.components.items.length <= 3 && r.skills.items.length <= 3);
  assert.ok(r.commercial_note.includes("Terms"));
});

test("recommend auto-retry: no_match + suggested_queries -> retried_from, no picks call", async () => {
  let compCalls = 0;
  let retryQuery = null;
  let picksCalled = false;
  const cat = { ...fakeCatalog,
    searchCatalog: async (kind, q) => {
      if (kind === 'components') {
        compCalls++;
        if (compCalls === 1) return { kind: 'components', total: 0, items: [], no_match: true, refused_fallback: 'popular-safety-net', suggested_queries: ['pricing'] };
        retryQuery = q;
        return { kind: 'components', total: 2, items: [{ title: 'Pricing A', page_url: 'u1' }, { title: 'Pricing B', page_url: 'u2' }] };
      }
      return { kind, total: 1, items: [{ title: kind + ' hit', page_url: 'u' }] };
    },
    editorialPicks: async () => { picksCalled = true; return []; },
  };
  const out = await runWith(cat, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_recommend", arguments: { goal: "xqztqvpzzzqqq saas", theme: "dark" } } },
  ]);
  const r = JSON.parse(out[1].result.content[0].text);
  assert.equal(compCalls, 2);
  assert.equal(retryQuery.query, 'pricing');
  assert.equal(retryQuery.theme, 'dark');
  assert.equal(retryQuery.freeOnly, true);
  assert.equal(r.components.retried, true);
  assert.equal(r.components.retried_from, 'pricing');
  assert.ok(r.components.items.length > 0);
  assert.ok(r.starter_kit.components.length > 0);
  assert.equal(picksCalled, false);
});

test("recommend editorial fill: retry still empty -> editorial_fallback", async () => {
  let compCalls = 0;
  const cat = { ...fakeCatalog,
    searchCatalog: async (kind, q) => {
      if (kind === 'components') {
        compCalls++;
        if (compCalls === 1) return { kind: 'components', total: 0, items: [], no_match: true, refused_fallback: 'popular-safety-net', suggested_queries: ['pricing'] };
        return { kind: 'components', total: 0, items: [], no_match: true, suggested_queries: ['pricing'] };
      }
      return { kind, total: 0, items: [] };
    },
    editorialPicks: async (n) => {
      assert.equal(n, 3);
      return [{ title: 'Pick A', page_url: 'pa' }, { title: 'Pick B', page_url: 'pb' }];
    },
  };
  const out = await runWith(cat, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_recommend", arguments: { goal: "xqztqvpzzzqqq" } } },
  ]);
  const r = JSON.parse(out[1].result.content[0].text);
  assert.equal(compCalls, 2);
  assert.equal(r.components.editorial_fallback, true);
  assert.equal(r.components.total, 2);
  assert.ok(r.components.editorial_note.includes('human-grade'));
  assert.equal(r.starter_kit.components.length, 2);
});

test("scaffold accepts [{id}] object refs and normalizes", async () => {
  const seen = {};
  const cat = { ...fakeCatalog,
    searchCatalog: async (kind, q) => {
      if (kind === 'design_systems') return { items: [{ title: 'sys', content: 'primary: #fff', preview_html: '<div class="bg-black"></div>' }] };
      return { items: [] };
    },
    bundleItems: async (kind, ids, max, opts) => { seen.kind = kind; seen.ids = ids; seen.max = max; seen.opts = opts; return [{ ok: true, item: { id: '732', slug: 's', title: 't', code: '<div></div>', tags: [], page_url: 'u', premium: false } }]; },
    getItem: async (kind, id, opts) => ({ item: { title: 'sys', content: 'primary: #fff', preview_html: '' } }),
  };
  const out = await runWith(cat, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_scaffold_page", arguments: { goal: "dark SaaS", components: [{ id: "732" }] } } },
  ]);
  assert.ok(out[1].result, JSON.stringify(out[1]).slice(0, 300));
  const s = JSON.parse(out[1].result.content[0].text);
  assert.equal(s.components.length, 1);
  assert.deepEqual(seen.ids, ["732"]);
  assert.equal(seen.kind, 'components');
});

test("scaffold rejects [{foo}] with example text -> -32602", async () => {
  const out = await runWith(fakeCatalog, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_scaffold_page", arguments: { goal: "x", components: [{ foo: 1 }] } } },
  ]);
  assert.equal(out[1].error.code, -32602);
  assert.ok(out[1].error.message.includes('["732","1364"]'), out[1].error.message.slice(0, 300));
});

test("search_all forwards theme to components call", async () => {
  const qs = {};
  const cat = { ...fakeCatalog, searchCatalog: async (kind, q) => { qs[kind] = q; return { items: [], total: 0 }; } };
  const out = await runWith(cat, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_search_all", arguments: { query: "hero", theme: "dark" } } },
  ]);
  assert.ok(out[1].result, JSON.stringify(out[1]).slice(0, 200));
  assert.equal(qs.components.theme, 'dark');
});
