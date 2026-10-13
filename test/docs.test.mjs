// docs.test.mjs — hermetic tests for the aura_docs.* pure helpers + stamps.
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/protocol.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";
import { buildDocsPlan, buildDocsCheck, docsStampFor, DOCS_TRUSTED } from "../src/guide.mjs";

test("trusted list covers the four page-building libraries", () => {
  assert.deepEqual(Object.keys(DOCS_TRUSTED).sort(), ['gsap', 'iconify', 'lenis', 'tailwind']);
  assert.equal(DOCS_TRUSTED.lenis.id, '/darkroomengineering/lenis');
});

test("plan: trusted library returns resolve/query/apply/stamp", () => {
  const r = buildDocsPlan({ library: 'GSAP', need: 'ScrollTrigger pin syntax' });
  assert.equal(r.library, 'gsap');
  assert.equal(r.trusted, true);
  assert.equal(r.context7.resolve, 'gsap');
  assert.equal(r.context7.query, 'ScrollTrigger pin syntax');
  assert.ok(r.apply.aura_touchpoints.length > 0);
  assert.equal(r.stamp.status, 'planned');
  assert.throws(() => buildDocsPlan({ library: 'gsap' }), (e) => e.code === 'BAD_ARGS');
  assert.throws(() => buildDocsPlan({}), (e) => e.code === 'BAD_ARGS');
});

test("plan: unlisted library stays generic but usable", () => {
  const r = buildDocsPlan({ library: 'three', need: 'CDN UMD build' });
  assert.equal(r.trusted, false);
  assert.equal(r.context7.resolve, 'three');
});

test("check: lenis rename is flagged with look-preserving fix", () => {
  const r = buildDocsCheck({ library: 'lenis', code_excerpt: "import Lenis from 'studio-freight/lenis'" });
  assert.equal(r.verdict, 'needs-update');
  assert.ok(r.fixes.some((f) => f.lib === 'lenis' && f.fix.includes('look unchanged')));
  assert.equal(r.stamp.status, 'checked-with-findings');
});

test("check: version pins become needs_check, clean code stays current", () => {
  const r = buildDocsCheck({ library: 'gsap', code_excerpt: '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>' });
  assert.equal(r.verdict, 'current');
  assert.ok(r.needs_check.some((n) => n.startsWith('gsap:')));
  assert.equal(r.rule.includes('look'), true);
  assert.throws(() => buildDocsCheck({ library: 'gsap', code_excerpt: 'x'.repeat(20001) }), (e) => e.code === 'BAD_ARGS');
  assert.throws(() => buildDocsCheck({ library: 'gsap' }), (e) => e.code === 'BAD_ARGS');
});

test("check: agent-reported docs change is echoed into needs_check", () => {
  const r = buildDocsCheck({ library: 'tailwind', code_excerpt: '<div class="container mx-auto">', docs_note: 'v4 browser build moved' });
  assert.ok(r.needs_check.some((n) => n.includes('v4 browser build moved')));
});

test("docsStampFor maps install deps to check reminders", () => {
  const s = docsStampFor([{ name: 'tailwindcss' }, { name: 'iconify-icon' }, { name: 'other' }]);
  assert.equal(s.status, 'unchecked');
  assert.ok(s.needs_check.some((n) => n.startsWith('tailwind:')));
  assert.ok(s.needs_check.some((n) => n.startsWith('iconify:')));
  assert.equal(docsStampFor([]).needs_check.length, 0);
});

test("tools/list exposes 27 tools incl. docs pair", async () => {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.ok(out[1].result.tools.length > 0);
  assert.ok(out[1].result.tools.some((t) => t.name === 'aura_docs_plan'));
  assert.ok(out[1].result.tools.some((t) => t.name === 'aura_docs_check'));
});

test("docs handlers validate args -> -32602, happy path returns text", async () => {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers({}) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const call = (id, name, args) => dispatch({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  await call(2, "aura_docs_plan", { library: "tailwind", need: "v4 browser CDN" });
  assert.equal(JSON.parse(out[1].result.content[0].text).trusted, true);
  await call(3, "aura_docs_plan", { library: "tailwind" });
  assert.equal(out[2].error.code, -32602);
  await call(4, "aura_docs_check", { library: "x", code_excerpt: "" });
  assert.equal(out[3].error.code, -32602);
});

test("install + scaffold outputs carry docs_stamp", async () => {
  const cat = {
    getItem: async (kind) => (kind === 'components'
      ? { item: { id: 1, slug: 's', title: 'T', code: '<div class="x"></div>', tags: [], page_url: 'u', premium: false } }
      : { item: { title: 'sys', content: '', preview_html: '' } }),
    bundleItems: async () => [{ ok: true, item: { id: 1, slug: 's', title: 'T', code: '<div class="x"></div>', tags: [], page_url: 'u', premium: false } }],
    searchCatalog: async () => ({ items: [] }),
  };
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers: createHandlers(cat) });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const call = (id, name, args) => dispatch({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  await call(2, "aura_install_component", { id: 1 });
  assert.equal(JSON.parse(out[1].result.content[0].text).docs_stamp.status, 'unchecked');
  await call(3, "aura_scaffold_page", { goal: 'x', components: ['1'] });
  assert.equal(JSON.parse(out[2].result.content[0].text).docs_stamp.status, 'unchecked');
});
