// award-output-quality.test.mjs — parser diagnosability (verdicts, malformed
// counts, field bounds) and the honesty of blueprint confidence + handler
// disclosures (recorded motion vs static cues; watch baseline seeding).
import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/protocol.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";
import { createAwardIndex } from "../src/awards-index.mjs";
import { awardParseListing, awardParseListingEx, AWARD_PARSER_VERSION } from "../src/awards.mjs";

const tmpDir = () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const os = process.getBuiltinModule("node:os");
  return fs.mkdtempSync(path.join(os.tmpdir(), "aura-outq-"));
};
const cardHtml = (slug) => `<div data-collectable-model-value="{&quot;slug&quot;:&quot;${slug}&quot;,&quot;title&quot;:&quot;T ${slug}&quot;,&quot;createdAt&quot;:1,&quot;tags&quot;:[&quot;minimal&quot;],&quot;images&quot;:{},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/${slug}">x</a></div>`;

test("listing parser verdicts are explicit: ok / empty-input / drift-empty / empty-listing / filtered-empty", () => {
  assert.equal(awardParseListingEx("").diagnostics.verdict, "empty-input");
  assert.equal(awardParseListingEx("<html><body>nothing here</body></html>").diagnostics.verdict, "drift-empty");
  const understood = '<html><head><title>Awwwards - websites</title></head><body><p>no cards yet</p></body></html>';
  const u = awardParseListingEx(understood);
  assert.equal(u.sites.length, 0);
  assert.equal(u.diagnostics.verdict, "empty-listing", "understood page with zero cards is not drift");
  const filtered = '<div data-collectable-model-value="{&quot;slug&quot;:&quot;c1&quot;,&quot;title&quot;:&quot;C1&quot;,&quot;type&quot;:&quot;collection&quot;}"></div>';
  const f = awardParseListingEx(filtered);
  assert.equal(f.sites.length, 0);
  assert.equal(f.diagnostics.verdict, "filtered-empty", "collections are filtered, not unreadable");
  assert.equal(f.diagnostics.filtered, 1);
  const ok = awardParseListingEx(cardHtml("fine"));
  assert.equal(ok.diagnostics.verdict, "ok");
  assert.equal(ok.diagnostics.parserVersion, AWARD_PARSER_VERSION);
  assert.ok(Array.isArray(awardParseListing(cardHtml("fine"))), "array-returning wrapper stays pinned");
});

test("malformed collector blobs are counted, never guessed", () => {
  const m = awardParseListingEx('<div data-collectable-model-value="{broken json</div>');
  assert.equal(m.sites.length, 0);
  assert.equal(m.diagnostics.blobs, 1);
  assert.equal(m.diagnostics.malformed, 1);
  assert.equal(m.diagnostics.verdict, "drift-empty");
  const mixed = awardParseListingEx('<div data-collectable-model-value="{broken json</div>' + cardHtml("fine"));
  assert.deepEqual(mixed.sites.map((s) => s.slug), ["fine"]);
  assert.equal(mixed.diagnostics.malformed, 1);
  assert.equal(mixed.diagnostics.verdict, "ok", "readable cards win over individual malformed blobs");
});

test("listing fields are length-bounded (no unbounded upstream strings)", () => {
  const longTitle = "T".repeat(500);
  const longTags = Array.from({ length: 50 }, (_, i) => "tag" + i);
  const json = JSON.stringify({ slug: "bounded", title: longTitle, createdAt: 1, tags: longTags, images: {}, type: "submission" }).replace(/"/g, "&quot;");
  const r = awardParseListingEx(`<div data-collectable-model-value="${json}"><a href="/sites/bounded">x</a></div>`);
  assert.equal(r.sites.length, 1);
  assert.ok(r.sites[0].title.length <= 200, "title capped");
  assert.ok(r.sites[0].tags.length <= 20, "tags capped");
});

// ---- handler-level honesty ----
const STATIC_HTML = '<html><head><title>X</title><script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script><style>@keyframes fade{from{}to{}} .a{transition:opacity .3s}</style></head><body><div data-aos="fade-up"></div></body></html>';
globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => STATIC_HTML });

const DETAIL = (slug) => `<html><head><meta property="og:title" content="${slug}" /></head><body><h1 class="heading-1 text-uppercase"> <a href="https://example-${slug}.com" target="_blank" rel="noopener">${slug}</a></h1><h2>Technologies & Tools</h2><span class="button button--tag">GSAP</span><h2>Color Palette</h2><strong>HEX</strong> #101418</body></html>`;
const detailClient = {
  getAwardHtml: async (raw) => {
    const p = String(raw).startsWith("http") ? new URL(String(raw)).pathname : String(raw);
    if (p.startsWith("/sites/")) { const s = p.split("/")[2]; return { html: DETAIL(s) }; }
    if (p.includes("sites_of_the_day")) return { html: cardHtml("fresh-one") };
    throw new Error("unexpected " + p);
  },
};
const fakeCatalog = {
  searchCatalog: async (kind) => {
    if (kind === "components") return { items: [{ id: 732, title: "Hero", page_url: "https://www.aura.build/component/x", premium: false }] };
    if (kind === "design_systems") return { items: [{ id: "sys", slug: "sys", title: "Sys", page_url: "https://www.aura.build/design-systems/sys" }] };
    return { items: [] };
  },
};
async function callWith(handlers, name, args) {
  const out = [];
  const { dispatch } = createSession((m) => out.push(m), { tools: TOOL_DEFS, handlers });
  await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  return out[1];
}

test("blueprint confidence: static markup cues add nothing; recorded motion adds exactly one point", async () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  const h = createHandlers(fakeCatalog, null, null, { awardClient: detailClient, awardIndex: idx, browser: null });
  const args = { goal: "dark portfolio landing", references: ["aspen-search", "emergence-magazine"] };
  const before = JSON.parse((await callWith(h, "aura_design_blueprint", args)).result.content[0].text);
  assert.ok(/Static markup cues/.test(before.markdown), "static cues are disclosed as NOT runtime observation");
  assert.ok(!before.spec.confidenceWhy.includes("recorded motion evidence"));
  assert.equal(before.spec.confidence, "low-medium");
  idx.recordMotion({ url: "https://example-aspen-search.com", viewport: "desktop" });
  const after = JSON.parse((await callWith(h, "aura_design_blueprint", args)).result.content[0].text);
  assert.ok(after.spec.confidenceWhy.includes("recorded motion evidence"));
  assert.equal(after.spec.confidence, "medium", "exactly one point moved the label");
  assert.ok(/Recorded motion/.test(after.markdown));
});

test("award_index new_winners discloses seeded watch baselines exactly once", async () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  idx.upsertSites([{ slug: "aspen-search", title: "Aspen", tags: [], studio: "S" }]);
  idx.watchAdd({ kind: "url", pattern: "aspen-search" });
  const h = createHandlers({}, null, null, { awardClient: detailClient, awardIndex: idx, browser: null });
  const first = JSON.parse((await callWith(h, "aura_award_index", { action: "new_winners" })).result.content[0].text);
  assert.ok(Array.isArray(first.watchDeltas));
  assert.equal(first.watchBaselineSeeded.length, 1);
  assert.deepEqual(first.watchBaselineSeeded[0].baselineMatches.map((x) => x.slug), ["aspen-search"]);
  assert.ok(/seeded their baseline silently/.test(first.watchBaselineNote));
  const second = JSON.parse((await callWith(h, "aura_award_index", { action: "new_winners" })).result.content[0].text);
  assert.equal(second.watchBaselineSeeded, undefined, "seeding disclosed once, not every call");
});

test("award_index rebuild through dispatch: bounded per call, resume completes, tags not sliced", async () => {
  const idx = createAwardIndex({ dir: tmpDir() });
  idx.setTaxonomy({ colors: [], filters: ["aa", "bb", "cc"] });
  const fetched = [];
  const client = {
    getAwardHtml: async (raw) => {
      fetched.push(String(raw));
      const m = String(raw).match(/^\/websites\/([a-z]+)\/$/);
      if (m) return { html: cardHtml("site-" + m[1]) };
      throw new Error("unexpected " + raw);
    },
  };
  const h = createHandlers({}, null, null, { awardClient: client, awardIndex: idx, browser: null });
  const r1 = JSON.parse((await callWith(h, "aura_award_index", { action: "rebuild", maxPages: 2 })).result.content[0].text);
  assert.equal(r1.pagesTotal, 3, "full taxonomy is the plan");
  assert.equal(r1.pagesDone, 2);
  assert.match(r1.note, /resume/);
  const r2 = JSON.parse((await callWith(h, "aura_award_index", { action: "resume", maxPages: 5 })).result.content[0].text);
  assert.equal(r2.complete, true);
  assert.deepEqual(fetched, ["/websites/aa/", "/websites/bb/", "/websites/cc/"]);
});
