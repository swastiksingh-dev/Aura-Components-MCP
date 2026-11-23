import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";
import { buildPrompt } from "../src/guide.mjs";
import { tokenNear } from "../src/catalog.mjs";
import { textResult } from "../src/protocol.mjs";
import { loadConfig } from "../src/config.mjs";

const item = (id, extra = {}) => ({
  id: String(id), slug: "component-" + id, title: "Component " + id, premium: false,
  code: "<section><h1>Example</h1></section>", code_chars: 43,
  facets: { theme: "unknown", needsTailwind: true, needsIcons: false, fonts: [] },
  page_url: "https://www.aura.build/component/component-" + id, ...extra,
});
const catalog = {
  getItem: async (kind, id, opts = {}) => ({
    kind, cached: false, item: item(id, kind === "skills" ? { content: "---\nname: example\ndescription: Example skill\n---\nBody." } : {}),
    opts,
  }),
  bundleItems: async (kind, ids) => ids.map((id) => ({ ok: true, id, item: item(id) })),
};
const parse = (r) => JSON.parse(r.content[0].text);

test("Inspo mappers are absent and aura_diff is registered", () => {
  const names = TOOL_DEFS.map((tool) => tool.name);
  assert.ok(names.includes("aura_diff"));
  assert.equal(names.filter((name) => name.startsWith("aura_inspo_")).length, 0);
  assert.equal(TOOL_DEFS.length, 35);
});

test("search defaults to five records while explicit configured limits remain supported", () => {
  assert.equal(loadConfig({}).defaultLimit, 5);
  assert.equal(loadConfig({ AURA_DEFAULT_LIMIT: "12" }).defaultLimit, 12);
});

test("aura_prompt second pass stays within Aura and preserves caller choices", () => {
  const r = buildPrompt({ goal: "portfolio", answers: { theme: "light", sections: ["work"], macrostructure: "editorial" } });
  assert.equal(r.answers.sections[0], "work");
  assert.ok(r.suggested_calls.length);
  assert.ok(r.suggested_calls.every((call) => call.tool.startsWith("aura_")));
  assert.equal(JSON.stringify(r).includes("inspo."), false);
});

test("aura_diff compares known fields and marks unavailable metrics unknown", async () => {
  const handlers = createHandlers(catalog);
  const r = parse(await handlers.aura_diff({ components: ["1", "2"] }));
  assert.equal(r.items.length, 2);
  assert.deepEqual(r.items[0].dependencies, ["tailwindcss"]);
  assert.equal(r.items[0].theme, "unknown");
  assert.equal(r.limitations.bundle_size, "unknown");
  assert.equal(r.items[0].compatibility, "unknown");
});

test("aura_diff does not claim complete structure from a truncated source chunk", async () => {
  const partial = {
    ...catalog,
    bundleItems: async (kind, ids) => ids.map((id) => ({
      ok: true, id,
      item: item(id, { tags: [], code: "<main>", code_info: { truncated: true, chunks: 3, chunk: 0 } }),
    })),
  };
  const r = parse(await createHandlers(partial).aura_diff({ components: ["1", "2"] }));
  assert.equal(r.items[0].structure, "unknown");
  assert.equal(r.items[0].structure_source, "unknown");
});

test("aura_bundle reports top-level truncation when full source exceeds a chunk cap", async () => {
  const partial = {
    ...catalog,
    bundleItems: async (kind, ids, max, opts) => ids.map((id) => ({
      ok: true, id,
      item: item(id, opts.full ? { code_info: { full_length: 50000, chunks: 3, chunk: 0, truncated: true } } : {}),
    })),
  };
  const r = parse(await createHandlers(partial).aura_bundle({ ids: ["1", "2"], full: true }));
  assert.equal(r.truncated, true);
  assert.equal(r.results[0].item.code_info.truncated, true);
  assert.equal(r.next_cursor, null);
});

test("aura_diff enforces the 2–4 candidate bound", async () => {
  const handlers = createHandlers(catalog);
  await assert.rejects(() => handlers.aura_diff({ components: ["1"] }), (e) => e.code === "BAD_ARGS");
  await assert.rejects(() => handlers.aura_diff({ components: ["1", "2", "3", "4", "5"] }), (e) => e.code === "BAD_ARGS");
});

test("detail handlers omit source by default and keep explicit full/chunk retrieval", async () => {
  const calls = [];
  const handlers = createHandlers({
    ...catalog,
    getItem: async (kind, id, opts) => { calls.push({ kind, id, opts }); return catalog.getItem(kind, id, opts); },
  });
  const meta = parse(await handlers.aura_get_component({ id: "1" }));
  assert.equal(Object.hasOwn(meta.item, "code"), false);
  assert.equal(calls.at(-1).opts.chunk, 0);
  const full = parse(await handlers.aura_get_component({ id: "1", full: true }));
  assert.equal(full.item.code.includes("<section>"), true);
  assert.equal(calls.at(-1).opts.full, true);
  const skill = parse(await handlers.aura_get_skill({ id: "s1" }));
  assert.equal(Object.hasOwn(skill.item, "content"), false);
  assert.equal(skill.item.skill_validation.valid, true);
});

test("skill discovery flags invalid frontmatter without treating unavailable snippets as invalid", async () => {
  const handlers = createHandlers({
    ...catalog,
    searchCatalog: async () => ({ items: [
      { id: "bad", content_snippet: "---\ntitle: Wrong\n---\nBody" },
      { id: "unknown" },
    ] }),
  });
  const result = parse(await handlers.aura_search_skills({ query: "test" }));
  assert.equal(result.items[0].loadable, false);
  assert.deepEqual(result.items[0].skill_validation.missing, ["name", "description"]);
  assert.equal(result.items[1].loadable, null);
});

test("skill frontmatter validation requires top-level name and description", async () => {
  const handlers = createHandlers({
    ...catalog,
    searchCatalog: async () => ({ items: [{
      id: "nested",
      content_snippet: "---\nmetadata:\n  name: Nested\n  description: Not top-level\n---\nBody",
    }] }),
  });
  const result = parse(await handlers.aura_search_skills({ query: "nested" }));
  assert.equal(result.items[0].loadable, false);
  assert.deepEqual(result.items[0].skill_validation.missing, ["name", "description"]);
});

test("skill frontmatter comment-only required values are not loadable", async () => {
  const handlers = createHandlers({
    ...catalog,
    searchCatalog: async () => ({ items: [{
      id: "comments",
      content_snippet: "---\nname: # required name missing\ndescription: # required description missing\n---\nBody",
    }] }),
  });
  const result = parse(await handlers.aura_search_skills({ query: "comments" }));
  assert.equal(result.items[0].loadable, false);
  assert.deepEqual(result.items[0].skill_validation.missing, ["name", "description"]);
});

test("textResult uses compact JSON without changing parsed meaning", () => {
  const value = { summary: "ok", items: [{ id: 1, label: "x" }] };
  const result = textResult(value);
  assert.equal(result.content[0].text, JSON.stringify(value));
  assert.deepEqual(JSON.parse(result.content[0].text), value);
});

test("local one-edit token matching is conservative and typo-tolerant", () => {
  assert.equal(tokenNear("pricng", "pricing"), true);
  assert.equal(tokenNear("pricing", "pricing"), true);
  assert.equal(tokenNear("pricing", "portfolio"), false);
  assert.equal(tokenNear("cta", "cat"), false);
});
