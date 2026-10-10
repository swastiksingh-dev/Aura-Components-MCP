// icon.test.mjs — hermetic tests for live icon fetch (stubbed fetcher).
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/protocol.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";
import { createIcons, iconCredit, ICON_CREDITS } from "../src/icons.mjs";

const FA_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M0 0h1v1H0z"/></svg>';
const PX_SVG = '<?xml version="1.0" encoding="UTF-8"?><svg id="Bolt" viewBox="0 0 24 24"><path d="m0 0h1v1H0z"/></svg>';

const stubFA = () => {
  const seen = [];
  return { seen, fetcher: { getText: async (url) => { seen.push(url); return url.includes("fontawesome") ? FA_SVG : null; } } };
};

test("FA hit on first try: svg kept, license + credit always", async () => {
  const { fetcher } = stubFA();
  const icons = createIcons({ fetcher });
  const r = await icons.getIcon({ name: "Bolt" });
  assert.equal(r.name, "bolt");
  assert.equal(r.source, "fontawesome");
  assert.equal(r.style, "solid");
  assert.ok(r.svg.startsWith("<svg"));
  assert.ok(r.license.includes("CC BY 4.0"));
  assert.ok(r.credit.includes("Font Awesome"));
  assert.ok(r.alt.use.includes("fa-solid fa-bolt"));
  assert.equal(r.cached, false);
});

test("fallback chain: FA 404s walk into pixel, tried URLs reported", async () => {
  const seen = [];
  const fetcher = { getText: async (url) => { seen.push(url); return url.includes("pixel-icon-library") && url.includes("regular/bolt.svg") ? PX_SVG : null; } };
  const icons = createIcons({ fetcher });
  const r = await icons.getIcon({ name: "bolt" });
  assert.equal(r.source, "pixel");
  assert.ok(!r.svg.includes("<?xml"), "xml prolog stripped for inline paste");
  assert.ok(r.svg.startsWith("<svg"));
  assert.ok(r.credit.includes("HackerNoon"));
  assert.ok(r.tried.length >= 3, "FA styles tried first");
  assert.ok(r.alt.class === "hn hn-bolt");
});

test("explicit source skips the other library", async () => {
  const seen = [];
  const fetcher = { getText: async (url) => { seen.push(url); return PX_SVG; } };
  const icons = createIcons({ fetcher });
  await icons.getIcon({ name: "bolt", source: "pixel" });
  assert.ok(seen.every((u) => u.includes("pixel-icon-library")));
  assert.ok(seen.length >= 1);
});

test("total miss -> NOT_FOUND with spelling hint", async () => {
  const icons = createIcons({ fetcher: { getText: async () => null } });
  await assert.rejects(() => icons.getIcon({ name: "zzz-nope" }), (e) => e.code === "NOT_FOUND" && /spelling|dashes/.test(e.message));
});

test("bad names and enums -> BAD_ARGS", async () => {
  const icons = createIcons({ fetcher: { getText: async () => null } });
  await assert.rejects(() => icons.getIcon({}), (e) => e.code === "BAD_ARGS");
  await assert.rejects(() => icons.getIcon({ name: "has space" }), (e) => e.code === "BAD_ARGS");
  await assert.rejects(() => icons.getIcon({ name: "bolt", source: "nope" }), (e) => e.code === "BAD_ARGS");
  await assert.rejects(() => icons.getIcon({ name: "bolt", style: "nope" }), (e) => e.code === "BAD_ARGS");
});

test("oversize bodies are skipped, cache serves second call", async () => {
  let calls = 0;
  const fetcher = { getText: async () => { calls++; return "<svg>" + "x".repeat(60 * 1024) + "</svg>"; } };
  const icons = createIcons({ fetcher });
  await assert.rejects(() => icons.getIcon({ name: "bolt", source: "fontawesome", style: "solid" }), (e) => e.code === "NOT_FOUND");
  let ok = 0;
  const fetcher2 = { getText: async () => { ok++; return FA_SVG; } };
  const icons2 = createIcons({ fetcher: fetcher2 });
  const a = await icons2.getIcon({ name: "bolt" });
  const b = await icons2.getIcon({ name: "bolt" });
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  assert.equal(ok, 1);
});

test("iconCredit covers both sources", () => {
  assert.ok(iconCredit("fontawesome").license.includes("CC BY 4.0"));
  assert.ok(iconCredit("pixel").credit.includes("HackerNoon"));
  assert.ok(Object.keys(ICON_CREDITS).length === 2);
});

test("tools/list exposes 28 tools incl. aura_icon", async () => {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}, { getIcon: async () => ({}) }) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(out[1].result.tools.length, 29);
  assert.ok(out[1].result.tools.some((t) => t.name === "aura_icon"));
});

test("aura_icon handler: happy path + -32602 + unwired backend", async () => {
  const icons = createIcons({ fetcher: { getText: async (url) => (url.includes("fontawesome") ? FA_SVG : null) } });
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}, icons) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const call = (id, name, args) => dispatch({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  await call(2, "aura_icon", { name: "house" });
  const r = JSON.parse(out[1].result.content[0].text);
  assert.ok(r.svg.startsWith("<svg"));
  assert.ok(r.credit.length > 0);
  await call(3, "aura_icon", {});
  assert.equal(out[2].error.code, -32602);
  await call(4, "aura_icon", { name: "house", source: "nope" });
  assert.equal(out[3].error.code, -32602);
  const out2 = [];
  const { dispatch: d2 } = createSession((m) => out2.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}) });
  await d2({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await d2({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "aura_icon", arguments: { name: "house" } } });
  assert.equal(out2[1].error.code, -32000);
});
