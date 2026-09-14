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
  assert.equal(out[1].result.tools.length, 20);
  assert.ok(out[2].result.content[0].text.includes('"ok": true'));
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
