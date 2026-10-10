// version.test.mjs — hermetic tests for running-vs-npm version notice.
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/protocol.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";
import { createVersion } from "../src/version.mjs";

const ver = (body) => createVersion({ fetcher: { getText: async () => body }, running: "1.7.0" });

test("behind npm -> update_available with prefer-latest notice", async () => {
  const r = await ver('{"version":"1.9.0"}').getVersion();
  assert.equal(r.running, "1.7.0");
  assert.equal(r.latest, "1.9.0");
  assert.equal(r.update_available, true);
  assert.ok(r.notice.includes("prefer", "notice prefers latest") || r.notice.includes("Prefer"));
  assert.ok(r.notice.includes("npm i -g"));
});

test("ahead or equal -> no update, latest-prefer note kept", async () => {
  const same = await ver('{"version":"1.7.0"}').getVersion();
  assert.equal(same.update_available, false);
  const ahead = await ver('{"version":"1.6.3"}').getVersion();
  assert.equal(ahead.update_available, false);
});

test("unreachable or unpublished registry never fails", async () => {
  const down = createVersion({ fetcher: { getText: async () => { throw new Error("no net"); } }, running: "1.7.0" });
  const r = await down.getVersion();
  assert.equal(r.latest, null);
  assert.equal(r.update_available, false);
  assert.ok(r.notice.includes("Could not reach"));
  const empty = await ver("not-json{{{").getVersion();
  assert.equal(empty.latest, null);
});

test("hourly cache serves second call without refetch", async () => {
  let calls = 0;
  const v = createVersion({ fetcher: { getText: async () => { calls++; return '{"version":"1.7.0"}'; } }, running: "1.7.0" });
  const a = await v.getVersion();
  const b = await v.getVersion();
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(calls, 1);
});

test("tools/list exposes 29 tools incl. aura_version", async () => {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}, null, null) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(out[1].result.tools.length, 29);
  assert.ok(out[1].result.tools.some((t) => t.name === "aura_version"));
});

test("aura_version handler returns verdict; unwired backend errors", async () => {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}, null, ver('{"version":"1.7.0"}')) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_version", arguments: {} } });
  const r = JSON.parse(out[1].result.content[0].text);
  assert.equal(r.running, "1.7.0");
  assert.equal(r.update_available, false);
  const out2 = [];
  const { dispatch: d2 } = createSession((m) => out2.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}) });
  await d2({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await d2({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_version", arguments: {} } });
  assert.equal(out2[1].error.code, -32000);
});

test("aura_status carries update block but never fails without backend", async () => {
  const cat = { getStatus: async () => ({ counts: {}, freshness: {} }) };
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers(cat, null, ver('{"version":"9.9.9"}')) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_status", arguments: {} } });
  const s = JSON.parse(out[1].result.content[0].text);
  assert.equal(s.update.update_available, true);
  assert.ok(s.update.notice.includes("npm i -g"));
  const out2 = [];
  const { dispatch: d2 } = createSession((m) => out2.push(m), { tools: TOOL_DEFS, handlers: createHandlers(cat) });
  await d2({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await d2({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_status", arguments: {} } });
  assert.ok(JSON.parse(out2[1].result.content[0].text).counts);
});
