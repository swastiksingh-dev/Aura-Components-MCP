// awards.test.mjs — hermetic tests for award parsing, ranking, client.
import test from "node:test";
import assert from "node:assert/strict";
import {
  awardDecodeEntities, awardStripTags, awardNormalizeSlug, awardFilterUrl, awardSiteUrl,
  awardThumbnailUrl, awardElementUrl, awardParseListing, awardParseDetail, awardParseCategories,
  awardParseElementsSection, awardParseElementGallery, awardParseElementPage, awardIsNomineePage,
  awardTokens, awardStemLite, awardScoreSites, awardSuggestQueries, awardCompactSite,
  awardValidateHttpUrl, awardIsBlockedHost, createAwardClient, AWARD_BASE_URL,
} from "../src/awards.mjs";

const LISTING_HTML = `<div data-collectable-model-value="{&quot;id&quot;:1,&quot;slug&quot;:&quot;aspen-search&quot;,&quot;title&quot;:&quot;Aspen Search&quot;,&quot;createdAt&quot;:1750000000,&quot;tags&quot;:[&quot;minimal&quot;,&quot;portfolio&quot;],&quot;images&quot;:{&quot;thumbnail&quot;:&quot;submissions/2026/08/a.jpg&quot;},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/aspen-search">x</a><a class="figure-rollover__bt" href="https://aspensearch.com">live</a><span class="budget-tag--sotd"></span><h3 class="avatar-name__title">StudioA</h3></div>`
  + `<div data-collectable-model-value="{&quot;id&quot;:2,&quot;slug&quot;:&quot;emergence-mag&quot;,&quot;title&quot;:&quot;Emergence Magazine&quot;,&quot;createdAt&quot;:1750000001,&quot;tags&quot;:[&quot;magazine&quot;,&quot;editorial&quot;],&quot;images&quot;:{&quot;thumbnail&quot;:&quot;submissions/2026/08/b.jpg&quot;},&quot;type&quot;:&quot;submission&quot;}"><a href="/sites/emergence-mag">x</a><span class="budget-tag--dev"></span></div>`;

const DETAIL_HTML = `<html><head><meta property="og:title" content="Aspen Search" /><meta property="og:description" content="Minimal talent studio" /><meta property="og:image" content="https://assets.awwwards.com/awards/media/cache/thumb_880_660/a.jpg" /></head><body>`
  + `<h2 class="text-default">Site of the Day - Sep 20, 2026</h2><h1 class="heading-1 text-uppercase"> <a href="https://aspensearch.com" target="_blank" rel="noopener">Aspen Search</a></h1>`
  + `<h2>Technologies & Tools</h2><span class="button button--tag">GSAP</span><span class="button button--tag">Tailwind</span>`
  + `<h2>Elements</h2><div data-collectable-model-value="{&quot;collectableTitle&quot;:&quot;Hero&quot;,&quot;collectableImage&quot;:&quot;element/2026/08/h.mp4&quot;}">x</div><h2>Color Palette</h2><strong>HEX</strong> #FAFAF8 <strong>HEX</strong> #1a1a1a`
  + `<h2>Description</h2><h3 class="heading-6"><p>Swiss minimal showcase</p></h3>`
  + `<div class="c-heading-score__note">→ 7.48<sup>/ 10</sup></div>Site of the Day - September 20, 2026</body></html>`;

test("entity decoding + strip tags", () => {
  assert.equal(awardDecodeEntities("a &amp; b &quot;x&quot;"), 'a & b "x"');
  assert.equal(awardStripTags("<p>hi <b>there</b></p>"), "hi there");
});

test("listing parse: blobs, awards, studio, live, dedupe", () => {
  const sites = awardParseListing(LISTING_HTML);
  assert.equal(sites.length, 2);
  assert.equal(sites[0].slug, "aspen-search");
  assert.equal(sites[0].title, "Aspen Search");
  assert.deepEqual(sites[0].tags, ["minimal", "portfolio"]);
  assert.equal(sites[0].liveUrl, "https://aspensearch.com");
  assert.ok(sites[0].awards.includes("Site of the Day"));
  assert.equal(sites[0].studio, "StudioA");
  assert.equal(sites[1].studio, null);
  assert.ok(sites[0].sourceUrl.includes("/sites/aspen-search"));
  const dup = awardParseListing(LISTING_HTML + LISTING_HTML);
  assert.equal(dup.length, 2, "duplicate slugs collapse");
});

test("listing ignores non-submission + collection cards", () => {
  const html = `<div data-collectable-model-value="{&quot;slug&quot;:&quot;x&quot;,&quot;title&quot;:&quot;X&quot;,&quot;type&quot;:&quot;collection&quot;}"><a href="/sites/x">x</a></div>`
    + `<div data-collectable-model-value="{&quot;slug&quot;:&quot;y&quot;,&quot;title&quot;:&quot;&quot;}"><a href="/sites/y">x</a></div>`
    + `<div data-collectable-model-value="not-json">`;
  assert.deepEqual(awardParseListing(html), []);
});

test("listing fallback anchors when blob scheme drifts", () => {
  const sites = awardParseListing('<a href="/sites/plain-site">Plain Site</a>');
  assert.equal(sites.length, 1);
  assert.equal(sites[0].slug, "plain-site");
});

test("detail parse: palette/tech/elements/awards/score/live", () => {
  const d = awardParseDetail(DETAIL_HTML, "aspen-search");
  assert.equal(d.slug, "aspen-search");
  assert.equal(d.title, "Aspen Search");
  assert.deepEqual(d.palette, ["#FAFAF8", "#1A1A1A"]);
  assert.ok(d.technologies.includes("GSAP"));
  assert.deepEqual(d.elements, ["Hero"]);
  assert.ok(d.awards.some((a) => a.title === "Site of the Day"));
  assert.equal(d.score, 7.48);
  assert.equal(d.liveUrl, "https://aspensearch.com");
  assert.equal(d.nominee, false);
  assert.ok(d.description.includes("Swiss"));
});

test("nominee page: empty design parse is real content", () => {
  assert.equal(awardIsNomineePage('<h2 class="text-default">Nominee - Sep 1, 2026</h2>'), true);
  assert.equal(awardIsNomineePage(DETAIL_HTML), false);
  const d = awardParseDetail('<h2 class="text-default">Nominee</h2><meta property="og:title" content="WIP" />', "wip");
  assert.equal(d.nominee, true);
  assert.deepEqual(d.palette, []);
});

test("detail tolerates missing optional sections", () => {
  const d = awardParseDetail("<html></html>", "ghost");
  assert.equal(d.title, null);
  assert.equal(d.description, null);
  assert.deepEqual(d.palette, []);
  assert.equal(d.score, null);
});

test("categories parse: colors + filters, no award collections", () => {
  const tax = awardParseCategories('<a href="/websites/%23FF5733/">c</a><a href="/websites/webgl/">t</a><a href="/websites/3d/">t</a><a href="/websites/sites_of_the_day/">x</a>');
  assert.deepEqual(tax.colors, ["#FF5733"]);
  assert.ok(tax.filters.includes("webgl") && tax.filters.includes("3d"));
  assert.ok(!tax.filters.includes("sites_of_the_day"));
});

test("elements section: null when absent, array when present", () => {
  assert.equal(awardParseElementsSection("<html></html>"), null);
  const els = awardParseElementsSection(DETAIL_HTML);
  assert.equal(els.length, 1);
  assert.equal(els[0].mediaPath, "element/2026/08/h.mp4");
});

test("element gallery + page parse", () => {
  const slugs = awardParseElementGallery('<a href="/inspiration/about-page-realevate">x</a><a href="/inspiration/about-page-realevate">dup</a>');
  assert.deepEqual(slugs, ["about-page-realevate"]);
  const page = awardParseElementPage('<link rel="canonical" href="https://www.awwwards.com/inspiration/about-page-realevate" /><h1 class="x">About Page <small>from</small> <a href="/sites/realevate">Realevate</a></h1><p class="subtitle-center">This element was built with...</p><strong class="button button--tag no-pointer">interaction</strong><a href="/elements/footer/">c</a><div data-collectable-model-value="{&quot;collectableImage&quot;:&quot;element/2026/08/e.mp4&quot;}">');
  assert.equal(page.slug, "about-page-realevate");
  assert.equal(page.author, "Realevate");
  assert.equal(page.siteSlug, "realevate");
  assert.ok(page.builtWith.includes("interaction"));
  assert.equal(page.mediaType, "video");
  assert.ok(page.mediaUrl.includes("assets.awwwards.com"));
  assert.equal(awardParseElementPage("<html></html>"), null);
});

test("filter URL: one filter per URL, most specific wins", () => {
  assert.equal(awardFilterUrl({}), AWARD_BASE_URL + "/websites/");
  assert.ok(awardFilterUrl({ color: "#ff5733" }).includes("%23FF5733"));
  assert.ok(awardFilterUrl({ award: "sotd" }).includes("sites_of_the_day"));
  assert.ok(awardFilterUrl({ technology: "WebGL" }).includes("/websites/webgl/"));
  assert.ok(awardFilterUrl({ tags: ["3d"] }).includes("/websites/3d/"));
  assert.throws(() => awardFilterUrl({ color: "zzz" }), (e) => e.code === "BAD_ARGS");
  assert.throws(() => awardFilterUrl({ award: "nope" }), (e) => e.code === "BAD_ARGS");
});

test("slug/url/thumb builders validate", () => {
  assert.equal(awardNormalizeSlug("Aspen Search!"), "aspen-search");
  assert.throws(() => awardNormalizeSlug(""), (e) => e.code === "BAD_ARGS");
  assert.equal(awardSiteUrl("Aspen-Search"), AWARD_BASE_URL + "/sites/aspen-search");
  assert.ok(awardThumbnailUrl("submissions/2026/08/a.jpg").includes("thumb_880_660"));
  assert.ok(awardElementUrl("element/2026/08/h.mp4").includes("assets.awwwards.com"));
});

test("URL safety blocks private/metadata/credentials", () => {
  assert.ok(awardIsBlockedHost("127.0.0.1") && awardIsBlockedHost("10.0.0.1") && awardIsBlockedHost("169.254.169.254"));
  assert.ok(!awardIsBlockedHost("www.awwwards.com"));
  assert.throws(() => awardValidateHttpUrl("ftp://x.com"), (e) => e.code === "BAD_ARGS");
  assert.throws(() => awardValidateHttpUrl("https://user:pass@x.com"), (e) => e.code === "BAD_ARGS");
  assert.throws(() => awardValidateHttpUrl("http://127.0.0.1:3000/"), (e) => e.code === "UNSUPPORTED_OPERATION");
  assert.equal(awardValidateHttpUrl("http://127.0.0.1:3000/", { allowLocal: true }), "http://127.0.0.1:3000/");
  assert.ok(awardValidateHttpUrl("https://www.awwwards.com/sites/x"));
});

test("ranking: title > tag, prefix + multiword, stable order", () => {
  const sites = [
    { slug: "b", title: "Generic Studio", tags: ["portfolio"], awards: [], studio: null },
    { slug: "a", title: "Magazine Editorial", tags: ["magazine"], awards: [], studio: null },
    { slug: "c", title: "Magazine Archive", tags: ["magazine"], awards: ["Site of the Day"], studio: null },
  ];
  const { scored } = awardScoreSites(sites, "magazines");
  assert.equal(scored[0].site.slug, "c", "stem magazines->magazine; award bonus (+0.3) puts the awarded twin first");
  const exact = awardScoreSites(sites, "magazine");
  assert.ok(exact.scored[0].score >= exact.scored[1].score);
  const multi = awardScoreSites([{ slug: "x", title: "Dark 3D Portfolio", tags: ["3d", "portfolio"], awards: [], studio: null }], "dark 3d portfolio");
  assert.ok(multi.scored[0].reasons.length >= 2);
  assert.deepEqual(awardTokens("the dark Site of web design"), ["dark"]);
  assert.equal(awardStemLite("magazines"), "magazine");
});

test("suggest queries + compact shape", () => {
  const s = awardSuggestQueries("xqztq", { filters: ["webgl", "editorial"] });
  assert.ok(s.length > 0 && s.length <= 5);
  const c = awardCompactSite({ slug: "a", title: "A", tags: ["x"], awards: ["Site of the Day"], studio: "S", thumbnailPath: "p.jpg", detailPath: "/sites/a" }, { score: 1.5, reasons: ["title:a"] });
  assert.equal(c.slug, "a");
  assert.ok(c.previewUrl.includes("assets.awwwards.com"));
  assert.equal(c.relevance, 1.5);
  assert.equal(c.evidence.source, "awwwards");
});

test("client: 404 is NOT_FOUND (not empty success)", async () => {
  const client = createAwardClient({ fetchImpl: async () => ({ status: 404, ok: false, headers: { get: () => null }, text: async () => "nope" }), rateMs: 0 });
  await assert.rejects(() => client.getAwardHtml("/sites/ghost"), (e) => e.code === "NOT_FOUND");
});

test("client: 403/429 blocked, never retried", async () => {
  let calls = 0;
  const client = createAwardClient({ fetchImpl: async () => { calls++; return { status: 429, ok: false, headers: { get: () => null }, text: async () => "" }; }, rateMs: 0 });
  const err = await client.getAwardHtml("/websites/").then(() => null, (e) => e);
  assert.ok(err && err.code === "UPSTREAM_ERROR" && err.blocked === true);
  assert.equal(calls, 1);
});

test("client: 500 retried once then succeeds", async () => {
  let calls = 0;
  const client = createAwardClient({
    fetchImpl: async () => (++calls === 1 ? { status: 500, ok: false, headers: { get: () => null }, text: async () => "" } : { status: 200, ok: true, headers: { get: () => null }, text: async () => "<html></html>" }),
    rateMs: 0,
  });
  const r = await client.getAwardHtml("/websites/");
  assert.ok(r.html.includes("html"));
  assert.equal(calls, 2);
});

test("client: timeout surfaces as upstream, oversize rejected", async () => {
  const hanging = createAwardClient({ fetchImpl: (u, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; rej(e); })), timeoutMs: 40, rateMs: 0 });
  await assert.rejects(() => hanging.getAwardHtml("/websites/"), /timeout/i);
  const big = createAwardClient({ fetchImpl: async () => ({ status: 200, ok: true, headers: { get: (k) => (k === "content-length" ? String(10 * 1024 * 1024) : null) }, text: async () => "x" }), rateMs: 0 });
  await assert.rejects(() => big.getAwardHtml("/websites/"), /exceeds/);
});

test("client: off-host paths rejected before fetch", async () => {
  let fetched = false;
  const client = createAwardClient({ fetchImpl: async () => { fetched = true; return { status: 200, ok: true, headers: { get: () => null }, text: async () => "" }; }, rateMs: 0 });
  await assert.rejects(() => client.getAwardHtml("https://evil.com/x"), (e) => e.code === "BAD_ARGS");
  assert.equal(fetched, false);
});

test("client: markup drift (no cards) returns empty array, not failure", () => {
  assert.deepEqual(awardParseListing("<html><body>redesigned, no blobs, no anchors</body></html>"), []);
});
