// Module: tools — thin adapters. Each tool validates args at the seam,
// calls one catalog/guide method, wraps textResult. No retries/caching here
// (except aura_recommend's single bounded auto-retry + editorial fill).
import { textResult } from './protocol.mjs';
import { installGuide, tokenHints, buildPrompt, buildDocsPlan, buildDocsCheck, docsStampFor, combineScaffold } from './guide.mjs';
import { awardErr, awardNormalizeSlug, awardValidateHttpUrl, awardFilterUrl, awardSiteUrl, awardThumbnailUrl, awardElementUrl, awardParseListing, awardParseDetail, awardParseCategories, awardParseElementsSection, awardParseElementPage, awardTokens, awardScoreSites, awardSuggestQueries, awardCompactSite, awardFullSite, awardCompareSites, awardBuildBlueprint, awardSiteIdeas, awardStaticMotion, awardStaticSummary, awardFetchGuardedHtml, AWARD_SECTIONS } from './awards.mjs';
import { createAwardIndex } from './awards-index.mjs';
import { cdpBandsFromHtml } from './browser-cdp.mjs';
import { planDesign, searchResearch, readResearch } from './design-research.mjs';
import { planMotion } from './motion-plan.mjs';
const SORTS = ['popular', 'recent', 'trending', 'updated'];
const CATS = ['hero','section','button','card','background','header','logo','feature','pricing','testimonial','footer','form','heading'];
function bad(msg) { const e = new Error(msg); e.code = 'BAD_ARGS'; throw e; }
function str(v, name) { if (v !== undefined && typeof v !== 'string') bad(name + ' must be a string'); return v; }
function num(v, name) { if (v !== undefined && typeof v !== 'number') bad(name + ' must be a number'); return v; }
function bool(v, name) { if (v !== undefined && typeof v !== 'boolean') bad(name + ' must be a boolean'); return v; }
function sort(v) { if (v !== undefined && !SORTS.includes(v)) bad('sort must be one of ' + SORTS.join('|')); return v; }
function theme(v) { if (v !== undefined && v !== 'dark' && v !== 'light') bad('theme must be dark|light'); return v; }
function normRefs(v, name) {
  if (v === undefined) return v;
  let preview = '';
  try { preview = JSON.stringify(v).slice(0, 120); } catch { preview = String(v).slice(0, 120); }
  const ex = name + ' must be an array like ["732","1364"] or [{id:"732"}] — got ' + preview;
  if (!Array.isArray(v) || !v.length || v.length > 8) bad(ex);
  const out = [];
  for (const e of v) {
    if (typeof e === 'string' && e) out.push(e);
    else if (typeof e === 'number' && Number.isFinite(e)) out.push(String(e));
    else if (e && typeof e === 'object' && !Array.isArray(e)) {
      if (typeof e.id === 'string' && e.id) out.push(e.id);
      else if (typeof e.id === 'number' && Number.isFinite(e.id)) out.push(String(e.id));
      else if (typeof e.slug === 'string' && e.slug) out.push(e.slug);
      else bad(ex);
    } else bad(ex);
  }
  if (!out.length) bad(ex);
  return out;
}
function cat(v) { if (v !== undefined && !CATS.includes(v)) bad('category must be one of ' + CATS.join('|')); return v; }
function skillFrontmatter(content) {
  const text = String(content || "");
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { valid: null, missing: [], frontmatter: "unknown" };
  const frontmatter = match ? match[1] : "";
  const lines = frontmatter.split(/\r?\n/);
  const has = (key) => {
    const index = lines.findIndex((line) => new RegExp("^" + key + "\\s*:").test(line));
    if (index < 0) return false;
    let value = lines[index].slice(lines[index].indexOf(":") + 1).trim();
    if (!value || value.startsWith("#")) return false;
    if (/^[|>][+-]?$/.test(value)) {
      return lines.slice(index + 1).some((line) => /^\s+\S/.test(line) && !/^\s+#/.test(line));
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1).trim();
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    return value.length > 0;
  };
  const missing = ["name", "description"].filter((key) => !has(key));
  return { valid: missing.length === 0, missing, frontmatter: "present" };
}
function diffFacts(item) {
  const facets = item.facets || {};
  const code = typeof item.code === "string" ? item.code : "";
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const structureTags = tags.filter((t) => /hero|nav|header|footer|pricing|feature|testimonial|form|card/i.test(String(t)));
  const dependencies = [];
  if (facets.needsTailwind === true) dependencies.push("tailwindcss");
  if (facets.needsIcons === true) dependencies.push("iconify-icon");
  const sourceComplete = typeof item.code === "string" && item.code_info?.truncated === false;
  const markupStructure = sourceComplete ? [...code.matchAll(/<(header|nav|main|section|footer|form)\b/gi)].map((m) => m[1].toLowerCase()).filter((v, i, a) => a.indexOf(v) === i) : [];
  const structure = structureTags.length ? structureTags : (markupStructure.length ? markupStructure : "unknown");
  return {
    id: item.id ?? null, slug: item.slug ?? null, title: item.title ?? null, category: item.category ?? tags[0] ?? "unknown",
    theme: facets.theme ?? "unknown", dependencies: typeof facets.needsTailwind === "boolean" || typeof facets.needsIcons === "boolean" ? dependencies : "unknown", fonts: Array.isArray(facets.fonts) && facets.fonts.length ? facets.fonts : "unknown",
    structure: structure.length ? structure : "unknown",
    structure_source: structureTags.length ? "catalogue_tags" : (markupStructure.length ? "complete_component_markup" : "unknown"),
    source_quality: item.code_chars ? { source: "Aura catalogue", code_chars: item.code_chars } : "unknown",
    compatibility: "unknown", page_url: item.page_url ?? null,
  };
}
export const TOOL_DEFS = [
  { name: 'aura_plan_design', description: 'Turn a brief into a compact Design Contract. Separates supplied facts, recommendations, and open questions; no catalogue rows or code. Then search a few indicated first-party candidates.', inputSchema: { type: 'object', properties: { brief: { type: 'string', minLength: 1, maxLength: 600 }, project_type: { type: 'string', maxLength: 120 }, audience: { type: 'string', maxLength: 300 }, goals: { type: 'array', items: { type: 'string', maxLength: 240 }, maxItems: 5 }, brand_notes: { type: 'string', maxLength: 600 }, content_outline: { type: 'array', items: { type: 'string', maxLength: 240 }, maxItems: 8 }, references: { type: 'array', items: { type: 'string', maxLength: 240 }, maxItems: 5 }, constraints: { type: 'array', items: { type: 'string', maxLength: 240 }, maxItems: 8 }, preferred_stack: { type: 'string', maxLength: 120 } }, required: ['brief'], additionalProperties: false } },
  { name: 'aura_motion_plan', description: 'Create a compact motion contract for purpose, trigger, target, properties, timing, interruption, reduced-motion, responsive fallback and accessibility. Supplied observation summaries are attributed and not independently verified.', inputSchema: { type: 'object', properties: { purpose: { type: 'string', maxLength: 240 }, trigger: { type: 'string', maxLength: 120 }, target: { type: 'string', maxLength: 160 }, properties: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 40 } }, interaction: { type: 'string', maxLength: 120 }, stack: { type: 'string', maxLength: 120 }, constraints: { type: 'string', maxLength: 360 }, observation: { type: 'object', properties: { source: { type: 'string', maxLength: 300 }, viewport: { type: 'string', maxLength: 80 }, trigger: { type: 'string', maxLength: 120 }, target: { type: 'string', maxLength: 160 }, changes: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 160 } }, limitations: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 200 } } }, additionalProperties: false } }, additionalProperties: false } },
  { name: 'aura_research_search', description: 'Search curated, compact research evidence cards. Returns at most five findings with source links, limitations, and a detail reference; never returns papers or PDFs.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 300 }, limit: { type: 'number', minimum: 1, maximum: 5 } }, required: ['query'], additionalProperties: false } },
  { name: 'aura_research_read', description: 'Read one selected research evidence card and its source metadata. Returns a compact claim, provenance, limitations, and implication; not source full text.', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_status', description: 'Catalogue health plus counts (components_free/pro, assets (all) + assets_free/pro, skills, design systems) with a counts_note. Free only, no login. Start here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_search_components', description: 'Find free components by brief, category and theme. Results are metadata-first; even slim:false caps source at 1,200 chars/item. Continue with offset; fetch source via aura_get_component.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: CATS }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_component', description: 'Inspect a free component. Metadata is default; pass chunk for one bounded source chunk or full:true for the first chunk. Numeric id or slug.', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' }, chunk: { type: 'number' }, full: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_skills', description: 'Search free Aura agent skills (192). Metadata only, slim by default; use aura_get_skill for the full SKILL.md content. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_skill', description: 'Inspect a free skill; metadata and frontmatter validation by default. Pass chunk for one body chunk or full:true for the first chunk.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, chunk: { type: 'number' }, full: { type: 'boolean' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_search_assets', description: 'Search free Aura assets (images and video). Keywords, media_type image or video. Slim rows by default. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, mediaType: { type: 'string', enum: ['image', 'video'] }, commercial_ok: { type: 'boolean' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_design_systems', description: 'Search free Aura DESIGN.md systems (725). Metadata + snippets, slim by default; use aura_get_design_system for content. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_design_system', description: 'Inspect a free design system; metadata and token hints by default. Pass chunk for bounded content/preview or full:true for the first bounded chunks.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' }, chunk: { type: 'number' }, full: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_all', description: 'One call across components, skills, assets, and design systems in parallel. Free only. Slim rows by default (excerpts, no blobs). Each surface runs its own fallback pipeline, so mixed outcomes are normal (skills may fall back while components go honestly empty) — read isFallback/no_match per surface, not once globally.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' }, slim: { type: 'boolean' }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_recommend', description: 'Starter kit for a goal: top 3 free hits per surface with page URLs and rationale. Slim rows + commercial-use note. Empty components auto-retry once via suggested_queries, then editorial picks.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, slim: { type: 'boolean' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_install_component', description: 'Paste-ready setup for a free component: dependency list, setup steps, file map, fonts. Goes beyond the official Aura MCP, which only reads project source.', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_install_skill', description: 'Save-and-load plan for a free skill: where to put SKILL.md per client plus upstream source.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_use_design_system', description: 'Apply a free DESIGN.md system: token starter CSS plus copy order (tokens first, then markup).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_bundle', description: 'Fetch 2–8 component records in one call. Returns metadata by default; full:true includes bounded first source chunks. Per-item errors are isolated.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: {} }, slugs: { type: 'array', items: { type: 'string' } }, full: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_scaffold_page', description: 'Plan a page from a brief and optional component refs. Returns tokens, dependencies, order and detail pointers; full:true includes bounded first chunks and reports truncated token source.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, system: { type: 'string' }, components: { type: 'array', items: {} }, full: { type: 'boolean' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_related', description: 'More-like-this: 3 related items for a component/skill/design-system by tag + text overlap. Discovery never dead-ends.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'skills', 'design_systems'] }, id: {} }, required: ['kind', 'id'], additionalProperties: false } },
  { name: 'aura_bulk_fetch', description: 'Bulk-fetch 2-8 details in one call for components, design_systems, or assets. Alias-friendly name for aura_bundle. Per-item errors never fail the batch.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'design_systems', 'assets'] }, ids: { type: 'array', items: {} } }, required: ['kind', 'ids'], additionalProperties: false } },
  { name: 'aura_install_asset', description: 'Legal drop-in plan for an asset: direct download URL, preview URL, license (all-rights-reserved per Aura Terms §4 — check page before commercial use), suggested file path.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_categories', description: 'The 13 component categories with live free counts. Pick one, then search within it.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_prompt', description: 'Compatibility wrapper for a two-pass design brief. Ask the user to choose theme, sections, system, assets and mood; the second pass suggests Aura tools only. Answers stay customisable.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, surfaces: { type: 'array', items: { type: 'string' } }, system: { type: 'string' }, answers: { type: 'object' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_diff', description: 'Compare 2–4 free components by known metadata: theme, dependencies, fonts, structure and source length. Unknown facts stay unknown; no visual/performance claims.', inputSchema: { type: 'object', properties: { components: { type: 'array', minItems: 2, maxItems: 4, items: {} }, goal: { type: 'string' } }, required: ['components'], additionalProperties: false } },
  { name: 'aura_docs_plan', description: 'Plan a fresh-docs lookup (pure, no fetch). library + need -> Context7 resolve/query plan (trusted: tailwind, gsap, lenis, iconify) + apply steps for Aura files + docs stamp slot. The agent calls Context7, Aura shapes the rest.', inputSchema: { type: 'object', properties: { library: { type: 'string' }, need: { type: 'string' } }, required: ['library', 'need'], additionalProperties: false } },
  { name: 'aura_docs_check', description: 'Check pasted code against fresh docs (pure). library + code_excerpt (under 20000 chars, excerpts not full pages) + optional docs_note -> verdict current|needs-update, look-preserving fixes, version-pin needs_check. Fresh API wins, look stays identical.', inputSchema: { type: 'object', properties: { library: { type: 'string' }, code_excerpt: { type: 'string' }, docs_note: { type: 'string' } }, required: ['library', 'code_excerpt'], additionalProperties: false } },
  { name: 'aura_icon', description: 'Fetch one free icon as ready-to-paste SVG (live). name in kebab-case (bolt, arrow-down). source auto|fontawesome|pixel, style auto|solid|regular|brands. Auto-fallback across styles then libraries; every hit carries license + credit (CC BY 4.0, credit always) plus a font/CSS alternative. 24h icon cache.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, source: { type: 'string', enum: ['auto', 'fontawesome', 'pixel'] }, style: { type: 'string', enum: ['solid', 'regular', 'brands', 'auto'] } }, required: ['name'], additionalProperties: false } },
  { name: 'aura_version', description: 'Running vs npm-published version (live, hourly cache). Returns update_available + notice telling the agent to prefer latest (npm i -g aura-components-mcp@latest) when behind. Never fails — offline registries return latest:null. aura_status already carries this verdict on every call.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_award_search', description: 'Search award-winning website references (Awwwards). Modes: sites (ranked refs with preview links), categories (real taxonomy from the index/source), elements (hero/nav/pricing/footer examples), motion (previously recorded motion studies). Local index first, one polite live refresh when empty.', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['sites', 'categories', 'elements', 'motion'] }, query: { type: 'string' }, slug: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, category: { type: 'string' }, color: { type: 'string' }, technology: { type: 'string' }, award: { type: 'string', enum: ['sotd', 'developer', 'honorable'] }, studio: { type: 'string' }, limit: { type: 'number' }, offset: { type: 'number' }, full: { type: 'boolean' }, library: { type: 'string' }, easing: { type: 'string' }, scrollModel: { type: 'string' } }, required: ['mode'], additionalProperties: false } },
  { name: 'aura_award_inspect', description: 'Inspect award refs: site_details (palette/tech/awards/evidence), site_elements (section visuals with media URLs), element (one gallery record), compare_sites (2-3 refs: shared vs gaps, missing marked unknown).', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['site_details', 'site_elements', 'element', 'compare_sites'] }, slug: { type: 'string' }, elementSlug: { type: 'string' }, slugs: { type: 'array', items: { type: 'string' } } }, required: ['mode'], additionalProperties: false } },
  { name: 'aura_design_blueprint', description: 'Evidence-backed build plan from 2-5 award refs + goal: Markdown brief + versioned JSON, mapped to real free Aura components/systems (free-only enforced, failures marked unavailable). Never copies third-party source.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, references: { type: 'array', items: { type: 'string' } }, technology: { type: 'string' }, visualDirection: { type: 'string' }, responsive: { type: 'string' }, constraints: { type: 'array', items: { type: 'string' } }, includeStructure: { type: 'boolean' } }, required: ['goal', 'references'], additionalProperties: false } },
  { name: 'aura_visual_audit', description: 'Capture/analyze a reference or your build. Modes: capture (real browser screenshot), structure (section band map: live-dom or static-html), responsive (measured viewport-width matrix), compare (reference vs build mismatches). Browser unavailable is explicit; loopback only with allowLocal:true.', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['capture', 'structure', 'responsive', 'compare'] }, url: { type: 'string' }, referenceUrl: { type: 'string' }, buildUrl: { type: 'string' }, viewport: { type: 'string', enum: ['desktop', 'mobile'] }, viewports: { type: 'array', minItems: 1, maxItems: 7, items: { type: 'integer', minimum: 320, maximum: 1920 } }, waitStrategy: { type: 'string', enum: ['load', 'networkidle'] }, settleMs: { type: 'number' }, allowLocal: { type: 'boolean' } }, required: ['mode'], additionalProperties: false } },
  { name: 'aura_motion_study', description: 'Evidence-backed motion guidance. Modes: inspect (live runtime scan: libs/easing/scroll), record (bounded frame study; .webm only when ffmpeg present), search (stored studies by library/easing/scroll). Never claims unobserved library state.', inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['inspect', 'record', 'search'] }, url: { type: 'string' }, library: { type: 'string' }, easing: { type: 'string' }, scrollModel: { type: 'string' }, frames: { type: 'number' }, durationMs: { type: 'number' }, viewport: { type: 'string', enum: ['desktop', 'mobile'] }, allowLocal: { type: 'boolean' } }, required: ['mode'], additionalProperties: false } },
  { name: 'aura_award_index', description: 'Local award corpus: status (counts/freshness/lock), rebuild/resume/refresh (bounded polite crawl), new_winners (baseline then delta), watch_add/list/remove (studio/tag/url watches). Never auto-crawls on startup.', inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'rebuild', 'resume', 'refresh', 'new_winners', 'watch_add', 'watch_list', 'watch_remove'] }, award: { type: 'string', enum: ['sotd', 'developer', 'honorable'] }, maxPages: { type: 'number' }, kind: { type: 'string', enum: ['studio', 'tag', 'url'] }, pattern: { type: 'string' } }, required: ['action'], additionalProperties: false } },
];
export function createHandlers(catalog, icons, version, awardDeps) {
  // Automatic update notice: every aura_status carries the cached version
  // verdict (hourly npm re-check), so agents learn about updates unprompted.
  const versionNote = async () => {
    try {
      if (version && typeof version.getVersion === "function") return await version.getVersion();
    } catch { /* status must never fail on version check */ }
    return null;
  };
  // Award subsystem deps (optional for old callers): client (live fetch),
  // index (persistent JSON store), browser (native CDP). Missing pieces stay
  // honest: local-empty results + unavailable notes, never invented data.
  const awardClient = (awardDeps && awardDeps.awardClient) || null;
  const awardBrowser = (awardDeps && awardDeps.browser) || null;
  const awardIndex = (awardDeps && awardDeps.awardIndex) || awardFallbackIndex();
  function awardFallbackIndex() {
    const sites = new Map(); const elements = new Map(); const motions = [];
    let tax = { colors: [], filters: [] }; let watches = [];
    return {
      root: "(memory)", files: [],
      getStatus: () => ({ dir: "(memory)", version: 1, counts: { sites: sites.size, elements: elements.size, motion: motions.length, taxonomyFilters: tax.filters.length, taxonomyColors: tax.colors.length, watches: watches.length }, freshness: null, stale: true, progress: null, pendingPages: [], lock: { held: false } }),
      listSites: (n) => [...sites.values()].slice(0, n || 50),
      getSite: (slug) => { try { return sites.get(String(slug).toLowerCase()) || null; } catch { return null; } },
      upsertSites: (rows) => { let added = 0; for (const s of (rows || [])) { if (s && s.slug && !sites.has(String(s.slug).toLowerCase())) added++; if (s && s.slug) sites.set(String(s.slug).toLowerCase(), s); } return { added, updated: 0, total: sites.size }; },
      getTaxonomy: () => ({ version: 1, colors: tax.colors, filters: tax.filters }),
      setTaxonomy: (t) => { tax = { colors: (t.colors || []).slice(0, 100), filters: (t.filters || []).slice(0, 400) }; return { colors: tax.colors.length, filters: tax.filters.length }; },
      upsertElements: (rows) => { let added = 0; for (const e of (rows || [])) { if (e && e.slug && !elements.has(String(e.slug))) added++; if (e && e.slug) elements.set(String(e.slug), e); } return { added, total: elements.size }; },
      listElements: (n) => [...elements.values()].slice(0, n || 50),
      getElement: (slug) => elements.get(String(slug)) || null,
      recordMotion: (s) => { const i = motions.findIndex((m) => m.url === s.url); if (i >= 0) motions.splice(i, 1); motions.unshift(s); return s; },
      searchMotion: (f) => {
        let items = [...motions];
        if (f.library) items = items.filter((m) => JSON.stringify(m).toLowerCase().includes(String(f.library).toLowerCase()));
        if (f.easing) items = items.filter((m) => JSON.stringify(m.easingVocab || []).toLowerCase().includes(String(f.easing).toLowerCase()));
        if (f.scrollModel) items = items.filter((m) => String((m.stack && m.stack.scrollModel) || "").toLowerCase() === String(f.scrollModel).toLowerCase());
        return { total: items.length, items: items.slice(0, 10), empty: motions.length === 0 };
      },
      newWinners: async () => { throw awardErr("UNSUPPORTED_OPERATION", "new_winners needs a persistent index + award client; wire the server default"); },
      rebuild: async () => { throw awardErr("UNSUPPORTED_OPERATION", "rebuild needs a persistent index + award client"); },
      resume: async () => { throw awardErr("UNSUPPORTED_OPERATION", "resume needs a persistent index + award client"); },
      refresh: async () => { throw awardErr("UNSUPPORTED_OPERATION", "refresh needs a persistent index + award client"); },
      watchAdd: (w) => { if (watches.some((x) => x.kind === w.kind && x.pattern === w.pattern)) throw awardErr("BAD_ARGS", "duplicate watch"); if (watches.length >= 50) throw awardErr("BAD_ARGS", "too many watches"); const r = { ...w, createdAt: new Date().toISOString(), lastCheckedAt: null, lastSlugs: null }; watches.push(r); return r; },
      watchList: () => watches,
      watchRemove: ({ kind, pattern }) => { const b = watches.length; watches = watches.filter((w) => !(w.kind === kind && w.pattern === String(pattern).toLowerCase())); return { removed: watches.length < b }; },
      checkWatches: () => [],
    };
  }
  function awardMode(v, allowed, name) { if (v === undefined) bad(name + ' is required'); if (!allowed.includes(v)) bad(name + ' must be one of ' + allowed.join('|')); return v; }
  function awardLimit(v, def, max) { if (v === undefined) return def; if (typeof v !== 'number' || !Number.isFinite(v)) bad('limit must be a number'); return Math.max(1, Math.min(Math.floor(v), max)); }
  function awardStrArr(v, name, max) { if (v === undefined) return undefined; if (!Array.isArray(v)) bad(name + ' must be an array of strings'); if (v.length > max) bad(name + ' holds max ' + max + ' entries'); for (const e of v) if (typeof e !== 'string' || !e.trim()) bad(name + ' must hold non-empty strings'); return v.map((e) => e.trim()); }
  async function awardDetailFor(slug, { withStatic = false } = {}) {
    const norm = awardNormalizeSlug(slug);
    const cached = awardIndex.getSite(norm);
    if (!awardClient) return { slug: norm, summary: cached, detail: null, detailStatus: cached ? 'cached' : 'unavailable', liveError: 'award client not wired' };
    try {
      const { html } = await awardClient.getAwardHtml('/sites/' + norm);
      const detail = awardParseDetail(html, norm);
      const cachedTags = (cached && cached.tags) || [];
      // Tags vs Technologies consistency (#5): listing tags (WebGL, 3D, …)
      // exist even when the page has no Technologies section. Backfill from
      // tags and LABEL it inferred — never present it as parsed section data.
      if ((!detail.technologies || !detail.technologies.length) && cachedTags.length) {
        detail.technologies = [...new Set(cachedTags.map((t) => String(t)))].slice(0, 12);
        detail.technologiesInferred = true;
        detail.technologyEvidence = "inferred from listing tags; page has no Technologies section";
      }
      const summary = { slug: norm, title: detail.title || (cached && cached.title) || norm, createdAt: (cached && cached.createdAt) || 0, tags: (cached && cached.tags) || [], thumbnailPath: (cached && cached.thumbnailPath) || "", liveUrl: detail.liveUrl || (cached && cached.liveUrl) || null, detailPath: "/sites/" + norm, awards: (detail.awards || []).map((a) => a.title), studio: (cached && cached.studio) || null, source: "awwwards", sourceUrl: detail.sourceUrl };
      try { awardIndex.upsertSites([summary]); } catch { /* memory fallback never fails */ }
      try {
        const media = awardParseElementsSection(html);
        if (media && media.length) awardIndex.upsertElements(media.map((m) => ({ slug: 'site-' + norm + '-' + String(m.title || 'element').toLowerCase().replace(/\W+/g, '-').slice(0, 60), title: m.title || 'Element', author: summary.studio || summary.title, builtWith: [], related: [], mediaPath: m.mediaPath, mediaType: String(m.mediaPath).endsWith('.mp4') ? 'video' : 'image', mediaUrl: awardElementUrl(m.mediaPath), category: 'uncategorized', siteSlug: norm, source: 'site', sourceUrl: summary.sourceUrl })));
      } catch { /* backfill best-effort */ }
      // Static motion cues (opt-in per caller: one extra bounded fetch).
      // Recorded studies stay authoritative; static markup is supplementary.
      let motionStatic = null;
      if (withStatic && summary.liveUrl) {
        try { motionStatic = await awardStaticMotion(summary.liveUrl); } catch { motionStatic = { status: "unavailable", url: summary.liveUrl, reason: "static scan failed" }; }
      }
      return { slug: norm, summary, detail, detailStatus: 'fetched', liveError: null, ...(motionStatic ? { motion_static: motionStatic } : {}) };
    } catch (e) {
      if (e && e.code === 'NOT_FOUND') throw e;
      return { slug: norm, summary: cached, detail: null, detailStatus: cached ? 'cached' : 'unavailable', liveError: String((e && e.message) || e).slice(0, 220) };
    }
  }
  return {
    aura_status: async () => {
      const [status, update] = await Promise.all([catalog.getStatus(), versionNote()]);
      return textResult(update ? { ...status, update } : status);
    },
    aura_search_components: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('components', {
      query: str(a.query, 'query'), tag: cat(a.category), freeOnly: true, theme: theme(a.theme),
      negative_theme: a.negative_theme === undefined ? undefined : theme(a.negative_theme),
      min_views: num(a.min_views, 'min_views'),
      sort: sort(a.sort), limit: num(a.limit, 'limit'), offset: num(a.offset, 'offset'),
      slim: a.slim === undefined ? undefined : bool(a.slim, 'slim'),
      exact_match: a.exact_match === undefined ? undefined : bool(a.exact_match, 'exact_match'),
    })); },
    aura_get_component: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (id === undefined || (typeof id !== 'string' && typeof id !== 'number')) bad('provide id (number) or slug (string)');
      const full = a.full === undefined ? undefined : bool(a.full, 'full');
      if (full !== undefined) bool(full, 'full');
      const got = await catalog.getItem('components', id, full === true ? { full: true } : { chunk: a.chunk === undefined ? 0 : num(a.chunk, 'chunk') });
      const item = { ...got.item };
      if (full !== true && a.chunk === undefined) delete item.code;
      return textResult({ summary: "Component detail", ...got, item, metadata_only: full !== true && a.chunk === undefined, retrieval: full ? "source returned up to the configured code chunk cap; use chunk to continue if code_info.truncated" : "use chunk for source or full:true for the first bounded source chunk" }); },
    aura_search_skills: async (a) => { a = a || {}; const r = await catalog.searchCatalog('skills', {
      query: str(a.query, 'query'), sort: sort(a.sort), limit: num(a.limit, 'limit'), offset: num(a.offset, 'offset'),
      slim: a.slim === undefined ? undefined : bool(a.slim, 'slim'),
      exact_match: a.exact_match === undefined ? undefined : bool(a.exact_match, 'exact_match'),
    });
      r.items = (r.items || []).map((it) => {
        const validation = skillFrontmatter(it.content_snippet || it.content_excerpt || "");
        return { ...it, loadable: validation.valid, skill_validation: validation };
      });
      return textResult(r); },
    aura_get_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) bad('id (string) is required');
      if (a.full !== undefined) bool(a.full, 'full');
      const got = await catalog.getItem('skills', a.id, a.full === true ? { full: true } : { chunk: a.chunk === undefined ? 0 : num(a.chunk, 'chunk') });
      const item = { ...got.item, skill_validation: skillFrontmatter(got.item.content || "") };
      if (a.full !== true && a.chunk === undefined) { item.content_excerpt = String(item.content || "").slice(0, 300); delete item.content; }
      return textResult({ summary: "Skill detail", ...got, item, metadata_only: a.full !== true && a.chunk === undefined, retrieval: a.full ? "content returned up to the configured content chunk cap; use chunk to continue if content_info.truncated" : "use chunk for content or full:true for the first bounded content chunk" }); },
    aura_search_assets: async (a) => { a = a || {}; const co = a.commercial_ok === undefined ? undefined : bool(a.commercial_ok, 'commercial_ok');
      const r = await catalog.searchCatalog('assets', { query: str(a.query, 'query'), mediaType: a.mediaType === undefined ? undefined : (a.mediaType === 'image' || a.mediaType === 'video' ? a.mediaType : bad('mediaType must be image|video')), freeOnly: true, sort: sort(a.sort), limit: num(a.limit, 'limit'), offset: num(a.offset, 'offset'), slim: a.slim === undefined ? undefined : bool(a.slim, 'slim'), exact_match: a.exact_match === undefined ? undefined : bool(a.exact_match, 'exact_match') });
      // Gap 5: commercial_ok filter (all-rights-reserved per Aura Terms S4).
      // commercial_ok:true returns [] with explanation, never silence.
      if (co === true) return textResult({ ...r, items: [], commercial_ok: false, commercial_note: 'All Aura catalogue assets are all-rights-reserved per Aura Terms S4. Preview/personal use via page_url; commercial reuse needs Aura permission.' });
      return textResult(r); },
    aura_search_design_systems: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('design_systems', {
      query: str(a.query, 'query'), sort: sort(a.sort), limit: num(a.limit, 'limit'), offset: num(a.offset, 'offset'),
      slim: a.slim === undefined ? undefined : bool(a.slim, 'slim'),
      exact_match: a.exact_match === undefined ? undefined : bool(a.exact_match, 'exact_match'),
    })); },
    aura_get_design_system: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (typeof id !== 'string' || !id) bad('provide id or slug (string)');
      if (a.full !== undefined) bool(a.full, 'full');
      const got = await catalog.getItem('design_systems', id, a.full === true ? { full: true } : { chunk: a.chunk === undefined ? 0 : num(a.chunk, 'chunk') });
      const item = { ...got.item };
      if (a.full !== true && a.chunk === undefined) { delete item.content; delete item.preview_html; }
      return textResult({ summary: "Design system detail", ...got, item, metadata_only: a.full !== true && a.chunk === undefined, retrieval: a.full ? "bodies returned up to configured per-field chunk caps; use chunk to continue where *_info.truncated" : "use chunk for content/preview or full:true for the first bounded chunks" }); },
    aura_search_all: async (a) => { a = a || {}; const query = str(a.query, 'query'), limit = num(a.limit, 'limit') || 5;
      const slim = a.slim === undefined ? undefined : bool(a.slim, 'slim');
      const themeV = a.theme === undefined ? undefined : theme(a.theme);
      const negV = a.negative_theme === undefined ? undefined : theme(a.negative_theme);
      const minV = num(a.min_views, 'min_views');
      const exactV = a.exact_match === undefined ? undefined : bool(a.exact_match, 'exact_match');
      const r = await Promise.all([
        catalog.searchCatalog('components', { query, freeOnly: true, limit, slim, theme: themeV, negative_theme: negV, min_views: minV, exact_match: exactV }),
        catalog.searchCatalog('skills', { query, limit, slim, min_views: minV, exact_match: exactV }),
        catalog.searchCatalog('assets', { query, freeOnly: true, limit, slim, min_views: minV, exact_match: exactV }),
        catalog.searchCatalog('design_systems', { query, limit, slim, min_views: minV, exact_match: exactV }),
      ]);
      return textResult({ query: query || null, components: r[0], skills: r[1], assets: r[2], design_systems: r[3] }); },
    aura_recommend: async (a) => { a = a || {}; if (typeof a.goal !== 'string' || !a.goal.trim()) bad('goal (string) is required');
      // Gap 1: recommend hard-filters theme (not just reranks) — starter kits must not
      // mix light rows into a dark ask. min_views gates noise; both are explicit params.
      const themeV = a.theme === undefined ? undefined : theme(a.theme);
      const negative_themeV = a.negative_theme === undefined ? undefined : theme(a.negative_theme);
      const min_views = num(a.min_views, 'min_views');
      const slim = a.slim === undefined ? undefined : bool(a.slim, 'slim');
      const r = await Promise.all([
        catalog.searchCatalog('components', { query: a.goal, freeOnly: true, limit: 3, theme: themeV, negative_theme: negative_themeV, min_views, slim }),
        catalog.searchCatalog('skills', { query: a.goal, limit: 3, slim }),
        catalog.searchCatalog('assets', { query: a.goal, freeOnly: true, limit: 3, slim }),
        catalog.searchCatalog('design_systems', { query: a.goal, limit: 3, slim }),
      ]);
      // P0 auto-retry (bounded: max 1 retry + 1 picks call, no loops): an honest-empty
      // components surface (no_match) retries once via suggested_queries[0] with the
      // same filters, then falls back to human-grade editorial picks so the kit fills.
      if (r[0] && r[0].no_match === true && (!Array.isArray(r[0].items) || !r[0].items.length)) {
        const sq = Array.isArray(r[0].suggested_queries) ? r[0].suggested_queries.filter((q) => typeof q === 'string' && q.trim()) : [];
        let filled = false;
        if (sq.length) {
          try {
            const retry = await catalog.searchCatalog('components', { query: sq[0], freeOnly: true, limit: 3, theme: themeV, negative_theme: negative_themeV, min_views, slim });
            if (retry && Array.isArray(retry.items) && retry.items.length) {
              retry.retried = true;
              retry.retried_from = sq[0];
              r[0] = retry;
              filled = true;
            }
          } catch { /* keep the original honest-empty */ }
        }
        if (!filled && (!Array.isArray(r[0].items) || !r[0].items.length)) {
          try {
            const picks = typeof catalog.editorialPicks === 'function' ? await catalog.editorialPicks(3) : [];
            if (Array.isArray(picks) && picks.length) {
              r[0] = { kind: 'components', total: picks.length, items: picks, editorial_fallback: true, editorial_note: 'Goal matched nothing — showing human-grade free picks instead.' };
            }
          } catch { /* keep the original honest-empty */ }
        }
      }
      r[0].items = (r[0].items || []).slice(0, 3);
      const pick = (x) => ((x && x.items) || []).slice(0, 3).map((i) => ({ title: i.title, page_url: i.page_url }));
      return textResult({ goal: a.goal, freeOnly: true,
        rationale: 'Top 3 free catalogue hits per surface, ranked by Aura views. Open the page_url previews, then fetch full source or content for finalists.',
        commercial_note: 'Assets (and component art) are all-rights-reserved per Aura Terms §4: fine to prototype, get Aura permission before commercial ship.',
        components: r[0], skills: r[1], assets: r[2], design_systems: r[3],
        starter_kit: { components: pick(r[0]), skills: pick(r[1]), assets: pick(r[2]), design_systems: pick(r[3]) } }); },
    aura_install_component: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (id === undefined || (typeof id !== 'string' && typeof id !== 'number')) bad('provide id (number) or slug (string)');
      const got = await catalog.getItem('components', id);
      // Pro refusal enforced centrally in catalog.getItem (fail-closed).
      const compInstall = installGuide('components', got.item);
      return textResult({ item: got.item, install: compInstall, docs_stamp: docsStampFor(compInstall.deps) }); },
    aura_install_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) bad('id (string) is required');
      const got = await catalog.getItem('skills', a.id);
      return textResult({ item: got.item, install: installGuide('skills', got.item), docs_stamp: { status: 'unchecked', needs_check: ['SKILL.md is a vendored snapshot — re-check source_url for updates'], note: 'No library pins in skill installs.' } }); },
    aura_use_design_system: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (typeof id !== 'string' || !id) bad('provide id or slug (string)');
      const got = await catalog.getItem('design_systems', id);
      const dsInstall = installGuide('design_systems', got.item);
      return textResult({ item: got.item, install: dsInstall, tokens: tokenHints(got.item.content || '', got.item.preview_html || ''), docs_stamp: docsStampFor(dsInstall.deps) }); },
    aura_categories: async () => { const cats = await catalog.categoryCounts();
      const s = (cats || []).reduce((n, c) => n + (typeof c.free === 'number' ? c.free : 0), 0);
      return textResult({ categories: cats, overlap_note: 'Counts overlap: components carry multiple tags, so per-category free counts sum to ' + s + ' (> 2495 free total). They triage depth, not a partition.' }); },
    aura_prompt: async (a) => { a = a || {}; return textResult(buildPrompt({ goal: typeof a.goal === 'string' ? a.goal : undefined, theme: a.theme, surfaces: a.surfaces, system: a.system, answers: a.answers })); },
    aura_plan_design: async (a) => { a = a || {};
      const brief = str(a.brief, 'brief');
      if (!brief || !brief.trim() || brief.length > 600) bad('brief must contain 1-600 characters');
      for (const key of ['project_type', 'audience', 'brand_notes', 'preferred_stack']) {
        if (a[key] !== undefined && (typeof a[key] !== 'string' || a[key].length > (key === 'brand_notes' ? 600 : key === 'audience' ? 300 : key === 'project_type' || key === 'preferred_stack' ? 120 : 600))) bad(key + ' must be a bounded string');
      }
      for (const [key, cap] of [['goals', 5], ['content_outline', 8], ['references', 5], ['constraints', 8]]) {
        if (a[key] !== undefined && (!Array.isArray(a[key]) || a[key].length > cap || a[key].some((v) => typeof v !== 'string' || v.length > 240))) bad(key + ' must be an array of at most ' + cap + ' strings (240 characters each)');
      }
      return textResult(planDesign(a)); },
    aura_motion_plan: async (a) => { a = a || {};
      for (const [key, cap] of [['purpose', 240], ['trigger', 120], ['target', 160], ['interaction', 120], ['stack', 120], ['constraints', 360]]) {
        if (a[key] !== undefined && (typeof a[key] !== 'string' || a[key].length > cap)) bad(key + ' must be a string of at most ' + cap + ' characters');
      }
      if (a.properties !== undefined && (!Array.isArray(a.properties) || a.properties.length > 5 || a.properties.some((x) => typeof x !== 'string' || x.length > 40))) bad('properties must contain at most 5 strings (40 characters each)');
      if (a.observation !== undefined) {
        if (!a.observation || typeof a.observation !== 'object' || Array.isArray(a.observation)) bad('observation must be an object');
        const observationKeys = new Set(['source', 'viewport', 'trigger', 'target', 'changes', 'limitations']);
        if (Object.keys(a.observation).some((key) => !observationKeys.has(key))) bad('observation contains an unsupported field');
        for (const [key, cap] of [['source', 300], ['viewport', 80], ['trigger', 120], ['target', 160]]) {
          if (a.observation[key] !== undefined && (typeof a.observation[key] !== 'string' || a.observation[key].length > cap)) bad('observation.' + key + ' must be a bounded string');
        }
        for (const [key, cap] of [['changes', 160], ['limitations', 200]]) {
          const values = a.observation[key];
          if (values !== undefined && (!Array.isArray(values) || values.length > 5 || values.some((x) => typeof x !== 'string' || x.length > cap))) bad('observation.' + key + ' must contain at most 5 bounded strings');
        }
      }
      return textResult(planMotion(a)); },
    aura_research_search: async (a) => { a = a || {};
      const query = str(a.query, 'query');
      if (!query || !query.trim() || query.length > 300) bad('query must contain 1-300 characters');
      const limit = a.limit === undefined ? 3 : num(a.limit, 'limit');
      if (!Number.isInteger(limit) || limit < 1 || limit > 5) bad('limit must be an integer from 1 to 5');
      return textResult(searchResearch(query, limit)); },
    aura_research_read: async (a) => { a = a || {};
      const id = str(a.id, 'id');
      if (!id || id.length > 100) bad('id must contain 1-100 characters');
      const card = readResearch(id);
      if (!card) { const e = new Error('research claim not found: ' + id); e.code = 'NOT_FOUND'; throw e; }
      return textResult(card); },
    aura_diff: async (a) => { a = a || {};
      const refs = normRefs(a.components, 'components');
      if (!refs || refs.length < 2 || refs.length > 4) bad('components must contain 2-4 id/slug references');
      const results = await catalog.bundleItems('components', refs, 4);
      return textResult({ summary: "Known-fact comparison of " + results.filter((r) => r.ok).length + " free components", goal: str(a.goal, 'goal') || null, items: results.map((r) => r.ok ? { ok: true, ...diffFacts(r.item) } : r), limitations: { bundle_size: "unknown", runtime_performance: "unknown", visual_quality: "unknown", compatibility: "unknown unless present in source metadata" } }); },
    aura_docs_plan: async (a) => { a = a || {}; return textResult(buildDocsPlan({ library: typeof a.library === 'string' ? a.library : undefined, need: typeof a.need === 'string' ? a.need : undefined })); },
    aura_docs_check: async (a) => { a = a || {}; return textResult(buildDocsCheck({ library: typeof a.library === 'string' ? a.library : undefined, code_excerpt: typeof a.code_excerpt === 'string' ? a.code_excerpt : undefined, docs_note: str(a.docs_note, 'docs_note') })); },
    aura_icon: async (a) => { a = a || {}; if (!icons || typeof icons.getIcon !== 'function') { const e = new Error('icons backend not wired'); throw e; }
      const name = typeof a.name === 'string' ? a.name : bad('name (string) is required — e.g. {name:"bolt"}');
      const source = a.source === undefined ? undefined : (a.source === 'auto' || a.source === 'fontawesome' || a.source === 'pixel' ? a.source : bad('source must be auto|fontawesome|pixel'));
      const style = a.style === undefined ? undefined : (a.style === 'auto' || a.style === 'solid' || a.style === 'regular' || a.style === 'brands' ? a.style : bad('style must be auto|solid|regular|brands'));
      return textResult(await icons.getIcon({ name, source, style })); },
    aura_version: async () => { if (!version || typeof version.getVersion !== 'function') { const e = new Error('version backend not wired'); throw e; }
      return textResult(await version.getVersion()); },
    aura_bundle: async (a) => { a = a || {}; const ids = normRefs(a.ids, 'ids') || normRefs(a.slugs, 'slugs');
      if (!ids || !ids.length) bad('provide ids (array of 1-8 numbers/strings) or slugs (array of strings)');
      const full = a.full === undefined ? false : bool(a.full, 'full');
      const results = await catalog.bundleItems('components', ids, 8, { full });
      const sourceTruncated = full && results.some((r) => r.ok && r.item?.code_info?.truncated === true);
      return textResult({ summary: results.length + " component record(s)", kind: 'components', results, truncated: sourceTruncated, next_cursor: null, retrieval: full ? "source included up to per-component chunk caps; when truncated is true, inspect code_info and call aura_get_component with chunk to continue" : "metadata only; call aura_get_component with chunk or full:true for source" }); },
    aura_related: async (a) => { a = a || {}; const k = a.kind;
      if (k !== 'components' && k !== 'skills' && k !== 'design_systems') bad('kind must be components|skills|design_systems');
      const id = a.id; if (typeof id !== 'string' && typeof id !== 'number') bad('id is required');
      return textResult(await catalog.relatedItems(k, id, 3)); },
    aura_install_asset: async (a) => { a = a || {}; if (typeof a.id !== 'number') bad('id (number) is required');
      const got = await catalog.getItem('assets', a.id);
      const it = got.item; const fx = (it.facets || {});
      return textResult({ item: it, install: { kind: 'assets', title: it.title, page_url: it.page_url, license: fx.license || 'all-rights-reserved (Aura Terms §4)', terms_url: 'https://www.aura.build/terms', download: fx.download || null, preview: fx.preview || null, files: [{ path: 'assets/' + it.id + '-' + String(it.title || 'asset').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.jpg', contains: 'downloaded original' }], steps: ['Check the license on the Aura asset page before commercial use — this server reports unknown, never assumes free-to-sell.', 'Download the download URL into the suggested path.', 'Use the preview URL for <img> srcset while drafting.'] }, docs_stamp: { status: 'unchecked', needs_check: ['license per page_url — terms can change'], note: 'No library pins in asset installs.' } }); },
    aura_bulk_fetch: async (a) => { a = a || {}; const kind = a.kind;
      if (kind !== 'components' && kind !== 'design_systems' && kind !== 'assets') bad('kind must be components|design_systems|assets');
      const ids = normRefs(a.ids, 'ids');
      if (!ids || !ids.length) bad('provide ids (array of 1-8)');
      return textResult({ kind, results: await catalog.bundleItems(kind, ids) }); },
    aura_scaffold_page: async (a) => { a = a || {}; if (typeof a.goal !== 'string' || !a.goal.trim()) bad('goal (string) is required');
      const sysRef = (typeof a.system === 'string' && a.system) ? a.system : null;
      const compRefs = normRefs(a.components, 'components') || [];
      const full = a.full === undefined ? false : bool(a.full, 'full');
      const fullOpt = { full };
      const [sys, bundle] = await Promise.all([
        sysRef ? catalog.getItem('design_systems', sysRef, fullOpt).catch(() => null) : catalog.searchCatalog('design_systems', { query: a.goal, limit: 1 }).then((r) => (r.items[0] ? { item: r.items[0] } : null)),
        compRefs.length ? catalog.bundleItems('components', compRefs, 8, fullOpt).then((rs) => ({ items: rs.filter((x) => x.ok).map((x) => x.item), dropped: rs.filter((x) => !x.ok).length })) : catalog.searchCatalog('components', { query: a.goal, freeOnly: true, limit: 3 }).then((r) => ({ items: r.items, dropped: 0 })),
      ]);
      const comps = bundle.items;
      // Pro guard: explicit-id bundles can name Pro rows — free flows never ship them.
      const freeComps = (comps || []).filter((c) => c && c.premium === false);
      const proFiltered = (comps || []).length - freeComps.length;
      const sysItem = sys && sys.item ? sys.item : null;
      const toks = sysItem ? tokenHints(sysItem.content || '') : { tokens: {}, css: '' };
      const { guides, combined_deps: deps, files } = combineScaffold(sysItem, freeComps);
      const compactSystem = sysItem ? { ...sysItem } : null;
      const compactComponents = freeComps.map((c) => ({ ...c }));
      if (!full) {
        if (compactSystem) { delete compactSystem.content; delete compactSystem.preview_html; }
        for (const c of compactComponents) delete c.code;
      }
      return textResult({ summary: "Page build plan for " + freeComps.length + " free component(s)", goal: a.goal, order: ['1 tokens.css', '2 system preview_html', '3 component markup in listed order'], tokens_css: toks.css || '', tokens_source_truncated: !!(full && sysItem?.content_info?.truncated), system: compactSystem, ...(sysItem ? {} : { system_note: 'no design system matched this goal — tokens.css is empty; fetch one via aura_search_design_systems or proceed with component defaults' }), components: compactComponents, guides, combined_deps: deps, files, docs_stamp: docsStampFor(deps), metadata_only: !full, retrieval: full ? "source included up to per-item chunk caps; check *_info.truncated and use detail chunk retrieval to continue" : "fetch referenced item with aura_get_component/aura_get_design_system for source", ...(bundle.dropped ? { dropped_refs: bundle.dropped, dropped_note: 'Some requested refs resolved to missing or Pro (paid) components and were omitted — see per-id errors via aura_bundle.' } : {}), ...(proFiltered ? { pro_filtered_out: proFiltered, pro_note: 'Pro (paid) components were refused — free-only scaffold ships free rows.' } : {}), license_note: 'Markup and any pulled assets are all-rights-reserved per Aura Terms §4 — fine to prototype, check each page_url before commercial ship.' }); },
    aura_award_search: async (a) => { a = a || {}; const mode = awardMode(a.mode, ['sites', 'categories', 'elements', 'motion'], 'mode');
      const limit = awardLimit(a.limit, 5, 25); const offset = Math.max(0, a.offset ?? 0); const full = a.full === undefined ? false : bool(a.full, 'full');
      if (mode === 'categories') {
        let tax = awardIndex.getTaxonomy();
        let source = 'local-index';
        if ((!tax.filters.length && !tax.colors.length) && awardClient) {
          try { const { html } = await awardClient.getAwardHtml('/websites/'); const parsed = awardParseCategories(html); awardIndex.setTaxonomy(parsed); tax = awardIndex.getTaxonomy(); source = 'live'; }
          catch (e) { return textResult({ mode, colors: [], filters: [], source: 'unavailable', liveError: String((e && e.message) || e).slice(0, 220), note: 'taxonomy unavailable; rebuild the index or retry later' }); }
        }
        // Paginated: colors are few (return all); filters page with limit/offset.
        const allFilters = tax.filters || [];
        return textResult({ mode, colors: tax.colors || [], filters: allFilters.slice(offset, offset + limit), filtersTotal: allFilters.length, limit, offset, source, updatedAt: tax.updatedAt || null, note: allFilters.length > limit ? 'filters paged — raise offset for more' : undefined });
      }
      if (mode === 'motion') {
        const r = awardIndex.searchMotion({ library: str(a.library, 'library'), easing: str(a.easing, 'easing'), scrollModel: a.scrollModel === undefined ? undefined : String(a.scrollModel), limit });
        if (r.empty) return textResult({ mode, total: 0, items: [], emptyCorpus: true, note: 'no motion studies recorded yet — run aura_motion_study {mode:inspect|record} first' });
        return textResult({ mode, total: r.total, items: r.items, emptyCorpus: false });
      }
      if (mode === 'elements') {
        const q = str(a.query, 'query') || ''; const cat = str(a.category, 'category');
        let pool = awardIndex.listElements(500);
        if (!pool.length && awardClient && q) {
          // Honest empty: element gallery needs per-item fetches; point at winners backfill instead of scraping blindly.
          return textResult({ mode, total: 0, items: [], note: 'element corpus is empty; fetch site elements via aura_award_inspect {mode:site_elements} or record new_winners to backfill' });
        }
        let items = pool;
        if (cat) items = items.filter((e) => String(e.category || '').toLowerCase() === cat.toLowerCase() || String(e.title || '').toLowerCase().includes(cat.toLowerCase()));
        if (q) {
          const toks = awardTokens(q);
          items = items.map((e) => { const hay = (String(e.title || '') + ' ' + String(e.author || '') + ' ' + String(e.category || '')).toLowerCase(); let s = 0; for (const t of toks) if (hay.includes(t)) s++; return { e, s }; }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || String(x.e.title).localeCompare(String(y.e.title))).map((x) => x.e);
        } else items = [...items].sort((x, y) => String(x.title).localeCompare(String(y.title)));
        const page = items.slice(offset, offset + limit).map((e) => ({ slug: e.slug, title: e.title, author: e.author || null, category: e.category || null, mediaUrl: e.mediaUrl || (e.mediaPath ? awardElementUrl(e.mediaPath) : null), mediaType: e.mediaType || null, siteSlug: e.siteSlug || null, sourceUrl: e.sourceUrl || null, evidence: { source: 'awwwards' } }));
        return textResult({ mode, query: q || null, total: items.length, limit, offset, items: page, ...(page.length ? {} : { suggestions: awardSuggestQueries(q || 'hero', awardIndex.getTaxonomy()) }) });
      }
      // sites
      const query = str(a.query, 'query') || ''; const slugQ = a.slug === undefined ? undefined : awardNormalizeSlug(a.slug);
      const tech = str(a.technology, 'technology'); const color = str(a.color, 'color'); const awardF = a.award; const studio = str(a.studio, 'studio');
      if (awardF !== undefined && !['sotd', 'developer', 'honorable'].includes(awardF)) bad('award must be sotd|developer|honorable');
      if (color !== undefined && !/^#?[0-9a-fA-F]{6}$/.test(color.trim())) bad('color must be a hex like #FF5733');
      let pool = awardIndex.listSites(2000);
      let liveError = null, liveRefreshed = false;
      if (!pool.length && awardClient) {
        try {
          const { html } = await awardClient.getAwardHtml(awardFilterUrl({ color: color ? '#' + String(color).replace('#', '') : undefined, tags: a.tags, technology: tech, award: awardF }));
          const parsed = awardParseListing(html);
          if (parsed.length) { awardIndex.upsertSites(parsed); pool = awardIndex.listSites(2000); liveRefreshed = true; }
        } catch (e) { liveError = String((e && e.message) || e).slice(0, 220); }
      }
      let filtered = pool;
      if (slugQ) filtered = filtered.filter((s) => s.slug === slugQ);
      if (tech) filtered = filtered.filter((s) => (s.tags || []).map((t) => String(t).toLowerCase()).includes(tech.toLowerCase()) || JSON.stringify(s).toLowerCase().includes(tech.toLowerCase()));
      if (studio) filtered = filtered.filter((s) => String(s.studio || '').toLowerCase().includes(studio.toLowerCase()));
      if (Array.isArray(a.tags) && a.tags.length) {
        const want = a.tags.map((t) => String(t).toLowerCase());
        filtered = filtered.filter((s) => want.some((w) => (s.tags || []).map((t) => String(t).toLowerCase()).includes(w)));
      }
      const { tokens, scored } = awardScoreSites(filtered, query || slugQ || '', { technology: tech, color });
      const ranked = query ? scored.filter((x) => x.score > 0).map((x) => ({ s: x.site, score: x.score, reasons: x.reasons })) : scored.map((x) => ({ s: x.site, score: x.score, reasons: x.reasons }));
      const total = ranked.length;
      const page = ranked.slice(offset, offset + limit);
      // Full-detail enrichment runs concurrently (the award client spaces
      // requests 1/s) but is capped: enriching 25 rows would take ~25s.
      const FULL_CAP = 5;
      const enrich = full ? page.slice(0, FULL_CAP) : [];
      const enriched = await Promise.all(enrich.map(async (r) => {
        try { const d = await awardDetailFor(r.s.slug); return awardFullSite(d.summary || r.s, d.detail, { score: r.score, reasons: r.reasons }); }
        catch { return awardCompactSite(r.s, { score: r.score, reasons: r.reasons }); }
      }));
      const items = page.map((r, i) => (full && i < enriched.length ? enriched[i] : awardCompactSite(r.s, { score: r.score, reasons: r.reasons })));
      const out = { mode, query: query || null, tokens, total, limit, offset, items, source: liveRefreshed ? 'live' : 'local-index', ...(liveError ? { liveError } : {}),
        ...(full && page.length > FULL_CAP ? { full_enrichment_capped: FULL_CAP, full_note: 'only the first ' + FULL_CAP + ' hits carry full detail (polite-fetch bound); the rest are compact' } : {}),
        corpusNote: liveRefreshed ? 'local index was empty; seeded from one polite live listing fetch (rebuild the index for depth)' : 'ranked from the local index; rebuild/refresh the index when stale' };
      if (!items.length && !liveError) { out.suggestions = awardSuggestQueries(query || 'portfolio', awardIndex.getTaxonomy()); out.note = 'zero-match (not a failure): try a suggestion'; }
      if (!items.length && liveError) out.note = 'upstream fetch failed; local index also empty — retry later, do not treat as zero-match';
      return textResult(out); },
    aura_award_inspect: async (a) => { a = a || {}; const mode = awardMode(a.mode, ['site_details', 'site_elements', 'element', 'compare_sites'], 'mode');
      if (mode === 'element') {
        const slug = awardNormalizeSlug(a.elementSlug || bad('elementSlug (string) is required'));
        let rec = awardIndex.getElement(slug);
        if (!rec && awardClient) {
          try { const { html } = await awardClient.getAwardHtml('/inspiration/' + slug); const parsed = awardParseElementPage(html); if (parsed) { awardIndex.upsertElements([{ ...parsed }]); rec = awardIndex.getElement(slug) || parsed; } } catch (e) { if (e && e.code === 'NOT_FOUND') throw e; }
        }
        if (!rec) { const e = new Error('element not found: ' + slug); e.code = 'NOT_FOUND'; throw e; }
        return textResult({ mode, element: rec });
      }
      if (mode === 'compare_sites') {
        const slugs = awardStrArr(a.slugs, 'slugs', 3) || bad('slugs (array of 2-3) is required');
        if (slugs.length < 2) bad('compare_sites needs 2-3 slugs');
        const normed = slugs.map((s) => awardNormalizeSlug(s));
        // Concurrent detail fetch (polite 1/s via the client); NOT_FOUND on
        // any ref still throws, other failures stay per-ref unavailable.
        const settled = await Promise.all(normed.map(async (s) => {
          try { return { ok: true, d: await awardDetailFor(s) }; }
          catch (e) { return { ok: false, slug: s, err: e }; }
        }));
        for (const r of settled) if (!r.ok && r.err && r.err.code === 'NOT_FOUND') throw r.err;
        const entries = settled.map((r) => {
          const s = r.ok ? r.d.slug : r.slug;
          let motion = null;
          try { const mr = awardIndex.searchMotion({ limit: 25 }); motion = (mr.items || []).find((m) => String(m.url || '').toLowerCase().includes(s)) || null; } catch { motion = null; }
          return { slug: s, detail: r.ok ? r.d.detail : null, motion };
        });
        const cmp = awardCompareSites(entries);
        return textResult({ mode, compared: cmp.per, shared: { technology: cmp.sharedTech, technologyFamilies: cmp.sharedTechFamilies, elements: cmp.sharedElements, elementKeywords: cmp.sharedElementKeywords, palette: cmp.sharedPalette, luminanceBands: cmp.sharedBands }, directionHints: cmp.directionHints, gaps: cmp.per.flatMap((p) => p.gaps.map((g) => p.slug + ': ' + g)), note: 'missing fields are unknown evidence, not negative proof' });
      }
      const slug = awardNormalizeSlug(a.slug || bad('slug (string) is required'));
      const d = await awardDetailFor(slug, { withStatic: true });
      if (!d.summary && !d.detail) { const e = new Error('site not found: ' + slug); e.code = 'NOT_FOUND'; throw e; }
      if (mode === 'site_details') {
        let motion = null;
        try { const mr = awardIndex.searchMotion({ limit: 25 }); motion = (mr.items || []).find((m) => String(m.url || '').toLowerCase().includes(slug)) || null; } catch { motion = null; }
        return textResult({ mode, slug, summary: d.summary ? awardCompactSite(d.summary, null) : null, detail: d.detail, ideas: awardSiteIdeas(d.detail), ideas_contract: '0-6 ideas by held evidence (1 on thin evidence is valid); every idea is status:suggested with an observed basis, never stated fact', motion: motion || null, motion_static: d.motion_static || null, evidence: { detail: d.detail ? d.detailStatus : 'unavailable', motion: motion ? 'cached' : 'unavailable', motion_static: d.motion_static ? d.motion_static.status : 'unavailable', ...(d.liveError ? { liveError: d.liveError } : {}) } });
      }
      // site_elements
      let elements = [];
      if (d.detail && d.detail.elements) {
        const media = awardParseElementsSection((await (async () => { try { const r = await awardClient.getAwardHtml('/sites/' + slug); return r.html; } catch { return ''; } })())) || [];
        elements = (media.length ? media : d.detail.elements.map((t) => ({ title: t, mediaPath: null }))).map((m) => ({ title: m.title, mediaUrl: m.mediaPath ? awardElementUrl(m.mediaPath) : null, mediaType: m.mediaPath ? (String(m.mediaPath).endsWith('.mp4') ? 'video' : 'image') : null, siteSlug: slug, sourceUrl: awardSiteUrl(slug), evidence: { source: 'awwwards' } }));
      } else {
        const pool = awardIndex.listElements(500).filter((e) => e.siteSlug === slug);
        elements = pool.map((e) => ({ title: e.title, mediaUrl: e.mediaUrl || (e.mediaPath ? awardElementUrl(e.mediaPath) : null), mediaType: e.mediaType, siteSlug: slug, sourceUrl: e.sourceUrl || awardSiteUrl(slug), evidence: { source: 'awwwards' } }));
      }
      return textResult({ mode, slug, sourceUrl: awardSiteUrl(slug), elements, ...(elements.length ? {} : { note: 'no Elements section on this page (legitimate empty) or detail unavailable' }) }); },
    aura_design_blueprint: async (a) => { a = a || {}; const goal = typeof a.goal === 'string' ? a.goal.trim() : bad('goal (string) is required');
      if (!goal) bad('goal (string) is required');
      const refs = awardStrArr(a.references, 'references', 5) || bad('references (array of 2-5 slugs) is required');
      if (refs.length < 2 || refs.length > 5) bad('references must hold 2-5 slugs — got ' + refs.length);
      const normed = refs.map((s) => awardNormalizeSlug(s));
      const technology = str(a.technology, 'technology'); const visualDirection = str(a.visualDirection, 'visualDirection'); const responsive = str(a.responsive, 'responsive');
      const constraints = Array.isArray(a.constraints) ? a.constraints.filter((c) => typeof c === 'string').map((c) => c.slice(0, 200)).slice(0, 8) : [];
      const includeStructure = a.includeStructure === undefined ? false : bool(a.includeStructure, 'includeStructure');
      const details = (await Promise.all(normed.map(async (s) => {
        try { return await awardDetailFor(s, { withStatic: true }); }
        catch (e) {
          if (e && e.code === 'NOT_FOUND') throw e;
          return { slug: s, summary: awardIndex.getSite(s), detail: null, detailStatus: 'unavailable', liveError: String((e && e.message) || e).slice(0, 160) };
        }
      })));
      // Aura catalogue matches (real rows only; failures stay unavailable).
      // One query PER proposed section so every section gets a candidate —
      // theme words from the goal ride along (dark/light re-rank server-side).
      const auraMatches = []; let auraUnavailable = null; let sysSlugForScaffold = null;
      const SECTIONS = AWARD_SECTIONS;
      try {
        if (!catalog || typeof catalog.searchCatalog !== 'function') throw new Error('catalogue not wired');
        // Test the combined text, then extract from the same combined text.
        // (Testing goal+visualDirection but matching goal alone null-dereferenced
        // whenever the theme word appeared only in visualDirection.)
        const themeMatch = (goal + ' ' + (visualDirection || '')).match(/\b(dark|light)\b/i);
        const themeWord = themeMatch ? themeMatch[1].toLowerCase() : undefined;
        const seen = new Set();
        const queries = [];
        for (const sec of SECTIONS) {
          const refWords = [];
          for (const d of details) {
            const toks = awardTokens(((d.detail && d.detail.title) || '') + ' ' + ((d.detail && (d.detail.elements || []).join(' ')) || '')).slice(0, 2);
            if (toks.length) refWords.push(toks[0]);
          }
          const q = [...new Set([sec, ...refWords.slice(0, 1), themeWord].filter(Boolean))].join(' ');
          queries.push({ section: sec, q });
        }
        // Section queries run concurrently (catalogue coalesces + caches);
        // results re-assemble in section order with duplicate ids collapsed.
        const sectionResults = await Promise.all(queries.map(async ({ section, q }) => {
          try {
            const r = await catalog.searchCatalog('components', { query: q, freeOnly: true, limit: 2, ...(themeWord ? { theme: themeWord } : {}) });
            return { section, q, items: (r.items || []).slice(0, 1), fallback: r && r.isFallback ? (r.fallback || 'fallback') : null };
          } catch { return { section, q, items: [], fallback: null }; }
        }));
        const fbBySection = {};
        for (const { section, fallback } of sectionResults) if (fallback && !(section in fbBySection)) fbBySection[section] = fallback;
        for (const { section, q, items } of sectionResults) {
          if (auraMatches.length >= 12) break;
          for (const it of items) {
            if (!it || it.premium !== false) continue;
            const key = String(it.id || it.slug);
            if (seen.has(key)) continue;
            seen.add(key);
            auraMatches.push({ section, componentId: it.id ?? it.slug, componentTitle: it.title, pageUrl: it.page_url, why: 'catalogue match for "' + q + '"', matchEvidence: { fallback: fbBySection[section] || null } });
            break;
          }
        }
        try {
          const sys = await catalog.searchCatalog('design_systems', { query: goal, limit: 1 });
          if (sys.items && sys.items[0]) { auraMatches.unshift({ section: 'tokens', componentId: sys.items[0].slug || sys.items[0].id, componentTitle: sys.items[0].title, pageUrl: sys.items[0].page_url, why: 'design-system tokens first' }); sysSlugForScaffold = sys.items[0].slug || sys.items[0].id; }
        } catch { /* optional */ }
        const covered = new Set(auraMatches.map((m) => m.section));
        const uncovered = SECTIONS.filter((s) => !covered.has(s));
        if (uncovered.length) auraUnavailable = (auraUnavailable ? auraUnavailable + '; ' : '') + 'no free catalogue match for sections: ' + uncovered.join(', ') + ' — build these from tokens + closest matched section';
        // Weak-consensus fallback: fewer than 3 component matches is not an
        // actionable brief. Fill from human-grade editorial picks, LABELED as
        // such (editorial:true) — never silently presented as query matches.
        const compCount = auraMatches.filter((m) => m.section !== 'tokens').length;
        if (compCount < 3 && catalog && typeof catalog.editorialPicks === 'function') {
          try {
            const picks = await catalog.editorialPicks(3);
            for (const p of (picks || [])) {
              if (auraMatches.length >= 12) break;
              if (!p || p.premium !== false) continue;
              const key = String(p.id || p.slug);
              if (seen.has(key)) continue;
              seen.add(key);
              auraMatches.push({ section: 'general', componentId: p.id ?? p.slug, componentTitle: p.title, pageUrl: p.page_url, why: 'editorial fallback: goal matched nothing directly — human-grade free pick', editorial: true });
            }
            if ((picks || []).length) auraUnavailable = (auraUnavailable ? auraUnavailable + '; ' : '') + 'section queries matched thinly — editorial free picks fill the kit (marked editorial:true)';
          } catch { /* brief stays thin but honest */ }
        }
      } catch (e) { auraUnavailable = String((e && e.message) || e).slice(0, 200); }
      let structureNotes = null;
      if (includeStructure) {
        if (!awardBrowser) structureNotes = 'structure not captured: browser unavailable (install Chrome or set AURA_CHROME_PATH)';
        else {
          const parts = await Promise.all(normed.slice(0, 3).map(async (s) => {
            const d = details.find((x) => x.slug === s);
            const live = d && d.detail && d.detail.liveUrl;
            if (!live) return s + ': no live URL in evidence';
            try { const st = await awardBrowser.structure(live, { viewport: 'desktop' }); return s + ': ' + st.bands.length + ' bands over ' + st.totalHeight + 'px (live-dom)'; }
            catch (e) { return s + ': structure unavailable (' + String((e && e.message) || e).slice(0, 120) + ')'; }
          }));
          structureNotes = parts.join('; ');
        }
      }
      let motionNotes = null;
      const gaps = [];
      for (const d of details) {
        if (!d.detail) gaps.push(d.slug + ': reference detail unavailable' + (d.liveError ? ' (' + d.liveError + ')' : ''));
      }
      const staticCues = [];
      for (const d of details) {
        const line = awardStaticSummary(d.slug, d.motion_static);
        if (line) staticCues.push(line);
      }
      let motionRecorded = false;
      try {
        const mr = awardIndex.searchMotion({ limit: 25 });
        const hits = (mr.items || []).filter((m) => normed.some((s) => String(m.url || '').toLowerCase().includes(s)));
        if (hits.length) { motionRecorded = true; motionNotes = 'Recorded motion for ' + hits.map((h) => h.url).join(', ') + ': prefer ' + hits.map((h) => (h.stack && h.stack.libs || []).join('+') || 'css').join('; '); }
        else {
          if (staticCues.length) motionNotes = 'Static markup cues (NOT runtime observation — record a study for trigger counts/easing): ' + staticCues.join(' | ');
          gaps.push('motion: no recorded studies for these refs — run aura_motion_study {mode:inspect} on their live URLs, or follow the hand-written <500ms + prefers-reduced-motion guidance');
        }
      } catch { /* ignore */ }
      if (!includeStructure) gaps.push('structure: not requested (pass includeStructure:true for measured band evidence)');
      if (auraUnavailable) gaps.push('catalogue: ' + auraUnavailable);
      // Requested palette synthesis: hexes named in the goal/direction become
      // PROPOSED tokens (never presented as observed ref evidence), mapped
      // against the refs' observed luminance bands.
      const requestedPalette = [...new Set([...String(goal + ' ' + (visualDirection || '')).matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)].map((m) => { const h = m[1]; return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h).toUpperCase(); }))].slice(0, 6);
      const built = awardBuildBlueprint({ goal, refs: normed, details, auraMatches, structureNotes, motionNotes, motionRecorded, constraints, technology, visualDirection, responsive, requestedPalette, gaps });
      // next_calls: immediately executable follow-ups built ONLY from real
      // ids/urls gathered above — the agent acts without another search round.
      const compMatches = auraMatches.filter((m) => m.section !== 'tokens' && !m.editorial).slice(0, 3);
      const nextCalls = compMatches.map((m) => ({ tool: 'aura_get_component', arguments: { id: m.componentId }, why: 'read full markup for the ' + m.section + ' pick before pasting' }));
      const scaffoldComps = auraMatches.filter((m) => m.section !== 'tokens').slice(0, 8).map((m) => String(m.componentId));
      if (scaffoldComps.length) nextCalls.push({ tool: 'aura_scaffold_page', arguments: { goal, ...(sysSlugForScaffold ? { system: sysSlugForScaffold } : {}), components: scaffoldComps }, why: 'one-turn page build from the matched kit (tokens first, then markup)' });
      for (const d of details) {
        if (d.detail && d.detail.liveUrl) nextCalls.push({ tool: 'aura_motion_study', arguments: { mode: 'inspect', url: d.detail.liveUrl }, why: 'record real motion evidence for ' + d.slug + ' before animating' });
        if (nextCalls.length >= 6) break;
      }
      return textResult({ goal, references: normed, markdown: built.markdown, spec: built.spec, auraEvidence: auraMatches.length ? { matched: auraMatches.length, sectionsCovered: [...new Set(auraMatches.map((m) => m.section))] } : { matched: 0, unavailable: auraUnavailable || 'catalogue lookup failed or matched nothing' }, next_calls: nextCalls, license_note: 'Reference design belongs to its creators (see sourceUrl per ref); Aura matches are all-rights-reserved per Aura Terms §4 — adapt patterns, never copy source.' }); },
    aura_visual_audit: async (a) => { a = a || {}; const mode = awardMode(a.mode, ['capture', 'structure', 'responsive', 'compare'], 'mode');
      const viewport = a.viewport === undefined ? 'desktop' : awardMode(a.viewport, ['desktop', 'mobile'], 'viewport');
      const waitStrategy = a.waitStrategy === undefined ? 'load' : awardMode(a.waitStrategy, ['load', 'networkidle'], 'waitStrategy');
      const settleMs = a.settleMs === undefined ? 1500 : num(a.settleMs, 'settleMs');
      if (typeof settleMs !== 'number' || settleMs < 0 || settleMs > 8000) bad('settleMs must be 0-8000');
      const allowLocal = a.allowLocal === undefined ? false : bool(a.allowLocal, 'allowLocal');
      // Local-file audit (P0-2): a file:// build path or plain local path is
      // readable WITHOUT a browser when allowLocal:true — parsed as labeled
      // static-html estimates (source:local-file). Screenshots still need http.
      const readLocalSource = async (raw, label) => {
        if (!allowLocal) { const e = new Error(label + ' is a local path: pass allowLocal:true to audit local builds (structure mode reads the file directly; capture needs a served http URL)'); e.code = 'UNSUPPORTED_OPERATION'; throw e; }
        let fs, path;
        try {
          const g = globalThis.process && globalThis.process.getBuiltinModule ? globalThis.process.getBuiltinModule : null;
          if (typeof g !== "function") throw new Error("needs Node 22+");
          fs = g.call(globalThis.process, "node:fs"); path = g.call(globalThis.process, "node:path");
        } catch { const e = new Error('local file audit needs Node 22+'); e.code = 'UNSUPPORTED_OPERATION'; throw e; }
        let file = String(raw);
        if (/^file:\/\//i.test(file)) { try { file = new URL(file).pathname; } catch { bad(label + ' is not a readable file URL'); } if (/^\/[A-Za-z]:\//.test(file)) file = file.slice(1); }
        if (/[\0]/.test(file) || file.length > 1000) bad(label + ' is not a readable local file');
        let html;
        try { html = fs.readFileSync(file, "utf8"); }
        catch { const e = new Error(label + ' not found or unreadable: ' + String(file).slice(0, 160)); e.code = 'NOT_FOUND'; throw e; }
        if (html.length > 1500000) html = html.slice(0, 1500000);
        const bands = cdpBandsFromHtml(html, raw);
        return { ...bands, source: 'local-file', note: 'local file estimate — tags/landmarks only, no measured layout; serve over http + allowLocal:true for live-dom bands' };
      };
      const isLocalInput = (raw) => typeof raw === 'string' && (/^file:\/\//i.test(raw) || /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('/') || /^[^/:?#]+\.html?([?#]|$)/i.test(raw));
      const fetchStatic = async (target) => {
        // Shared guarded fetch: manual redirects with per-hop URL
        // classification + DNS guard, streaming bounded read. The old
        // redirect:'follow' fetch could land on a blocked host after a
        // server-side redirect; this one re-validates every hop.
        const got = await awardFetchGuardedHtml(target, { fetchImpl: globalThis.fetch, allowLocal, label: 'audited page' });
        if (!got.ok) {
          if (got.status === 404) { const e = new Error('page not found: ' + target); e.code = 'NOT_FOUND'; throw e; }
          throw awardErr('UPSTREAM_ERROR', 'static fetch failed for ' + target + ': ' + String(got.reason).slice(0, 200));
        }
        return got.html;
      };
      const structureOf = async (rawTarget, label, requestedViewport = viewport) => {
        if (isLocalInput(rawTarget)) return readLocalSource(rawTarget, label || 'url');
        const target = rawTarget;
        if (awardBrowser) {
          try { return await awardBrowser.structure(target, { viewport: requestedViewport, allowLocal }); }
          catch (e) {
            // Any live-dom failure degrades to labeled static estimates —
            // the audit stays usable, and the downgrade is disclosed.
            if (e && (e.code === 'BROWSER_UNAVAILABLE' || e.code === 'CAPTURE_TIMEOUT' || e.code === 'UPSTREAM_ERROR')) {
              try {
                const html = await fetchStatic(target);
                return { ...cdpBandsFromHtml(html, target), fallbackFrom: 'live-dom', fallbackWhy: String((e && e.message) || e).slice(0, 200) };
              } catch (fe) {
                const both = awardErr('UPSTREAM_ERROR', 'live-dom failed (' + String((e && e.message) || e).slice(0, 160) + ') AND static fetch failed (' + String((fe && fe.message) || fe).slice(0, 160) + ') — is the dev server running? For http://127.0.0.1 targets serve the build first (e.g. npx serve) with allowLocal:true; for files pass the path directly with allowLocal:true.');
                throw both;
              }
            }
            throw e;
          }
        }
        const html = await fetchStatic(target);
        return cdpBandsFromHtml(html, target);
      };
      if (mode === 'capture') {
        if (typeof a.url === 'string' && isLocalInput(a.url) && !/^https?:\/\//i.test(a.url)) bad('capture needs an http(s) URL — screenshots require a browser navigating a served page. Serve the build (e.g. npx serve) and pass its http://127.0.0.1:PORT URL with allowLocal:true.');
        const target = awardValidateHttpUrl(a.url || bad('url (string) is required'), { allowLocal });
        if (!awardBrowser) throw awardErr('BROWSER_UNAVAILABLE', 'capture needs Chrome: install it or set AURA_CHROME_PATH. Fallback: aura_visual_audit {mode:structure} estimates sections from static HTML without a browser.');
        try { return textResult(await awardBrowser.capture(target, { viewport, waitStrategy, settleMs, allowLocal })); }
        catch (e) {
          if (e && (e.code === 'BROWSER_UNAVAILABLE' || e.code === 'UNSUPPORTED_OPERATION')) throw e;
          throw awardErr('UPSTREAM_ERROR', 'capture failed: ' + String((e && e.message) || e).slice(0, 220) + ' — retry, or use mode:structure for a static estimate');
        }
      }
      if (mode === 'structure') {
        const raw = a.url || bad('url (string) is required');
        const target = isLocalInput(raw) ? raw : awardValidateHttpUrl(raw, { allowLocal });
        return textResult({ mode, ...(await structureOf(target, 'url')) });
      }
      if (mode === 'responsive') {
        const raw = a.url || bad('url (string) is required');
        const target = isLocalInput(raw) ? raw : awardValidateHttpUrl(raw, { allowLocal });
        const requested = a.viewports === undefined ? [320, 360, 390, 768, 1024, 1280, 1440] : a.viewports;
        if (!Array.isArray(requested) || requested.length < 1 || requested.length > 7
          || requested.some((w) => !Number.isInteger(w) || w < 320 || w > 1920)) {
          bad('viewports must contain 1-7 integer widths from 320 to 1920');
        }
        const widths = [...new Set(requested)];
        const results = [];
        const findings = [];
        let pages;
        if (isLocalInput(target)) {
          const estimate = await readLocalSource(target, 'url');
          pages = widths.map((width) => ({ width, source: estimate.source, responsive: null }));
        } else if (awardBrowser && typeof awardBrowser.responsiveAudit === 'function') {
          try {
            pages = (await awardBrowser.responsiveAudit(target, { viewports: widths, allowLocal })).results;
          } catch (e) {
            if (!e || !['BROWSER_UNAVAILABLE', 'CAPTURE_TIMEOUT', 'UPSTREAM_ERROR'].includes(e.code)) throw e;
            const estimate = isLocalInput(target)
              ? await readLocalSource(target, 'url')
              : cdpBandsFromHtml(await fetchStatic(target), target);
            pages = widths.map((width) => ({ width, source: estimate.source, responsive: null }));
          }
        } else if (!awardBrowser) {
          const estimate = isLocalInput(target)
            ? await readLocalSource(target, 'url')
            : cdpBandsFromHtml(await fetchStatic(target), target);
          pages = widths.map((width) => ({ width, source: estimate.source, responsive: null }));
        } else {
          pages = [];
          for (const width of widths) pages.push(await structureOf(target, 'url', width));
        }
        let findingCount = 0;
        const truncatedViewports = [];
        for (let index = 0; index < widths.length; index++) {
          const width = widths[index];
          const page = pages[index] || { source: 'unavailable' };
          const m = page.responsive;
          const measured = page.source === 'live-dom' && m && Number.isFinite(m.viewportWidth) && Number.isFinite(m.scrollWidth);
          results.push({
            width,
            source: page.source,
            ...(measured ? {
              measurements: {
                viewportWidth: m.viewportWidth,
                scrollWidth: m.scrollWidth,
                documentHeight: m.documentHeight,
                focusableCount: m.focusableCount,
                prefersReducedMotion: m.reducedMotion,
              },
            } : { measurements: { status: 'unavailable', reason: 'Static HTML does not expose layout geometry or computed styles.' } }),
          });
          if (measured && m.horizontalOverflow) {
            findingCount += 1 + (Array.isArray(m.offenders) ? m.offenders.length : 0);
            findings.push({
              severity: 'high', kind: 'horizontal-overflow', viewport: width,
              element: 'document', evidence: 'document scroll width ' + m.scrollWidth + 'px exceeds viewport width ' + m.viewportWidth + 'px.',
              impact: 'Page content may require horizontal scrolling or be clipped.',
              suggestedCorrection: 'Find the wide child and constrain its intrinsic/minimum width or allow intentional local scrolling.',
              confidence: 'measured',
            });
            for (const item of (Array.isArray(m.offenders) ? m.offenders : []).slice(0, 2)) {
              findings.push({
                severity: 'info', kind: 'offscreen-element-candidate', viewport: width, element: item.selector,
                evidence: 'bounding box spans ' + item.left + 'px to ' + item.right + 'px at ' + m.viewportWidth + 'px viewport width.',
                impact: 'This element extends outside the viewport bounds; it may be intentional or inside a local scroller and is not asserted as the document-overflow cause.',
                suggestedCorrection: 'Inspect its overflow/scrolling ancestors and confirm whether the offscreen position is intentional.',
                confidence: 'measured-bounds-not-causality',
              });
            }
            if ((m.offenders || []).length > 2) truncatedViewports.push(width);
          }
        }
        return textResult({
          mode, url: target, widths, results, findings, findingCount,
          findingsTruncated: findingCount > findings.length,
          omittedFindingCount: Math.max(0, findingCount - findings.length),
          truncatedViewports,
          limitations: [
            'DOM geometry detects horizontal overflow and off-screen bounds only; it does not judge visual hierarchy or screenshot similarity.',
            'Off-screen elements are candidates, not proven causes; some may be deliberate or inside local scrollers.',
            'Focusability count is a structural proxy, not keyboard-order or focus-visibility verification.',
            'Reduced-motion preference is reported, but this audit does not prove every animation responds to it.',
            'Static HTML fallback cannot measure layout; no defects are inferred from markup alone.',
            'Screenshots are not captured by default; use mode:capture at a selected viewport for a saved artifact.',
          ],
        });
      }
      const rawRef = a.referenceUrl || bad('referenceUrl (string) is required');
      const rawBuild = a.buildUrl || bad('buildUrl (string) is required');
      const normRef = isLocalInput(rawRef) ? rawRef : awardValidateHttpUrl(rawRef, { allowLocal });
      const normBuild = isLocalInput(rawBuild) ? rawBuild : awardValidateHttpUrl(rawBuild, { allowLocal });
      const [rs, bs] = await Promise.all([structureOf(normRef, 'referenceUrl'), structureOf(normBuild, 'buildUrl')]);
      const mismatches = [];
      if (rs.bands.length !== bs.bands.length) mismatches.push({ kind: 'section-count', detail: 'reference has ' + rs.bands.length + ' bands, build has ' + bs.bands.length });
      const seq = (x) => x.bands.map((b) => b.tag + ':' + (b.label || '')).join(' > ');
      if (seq(rs) !== seq(bs)) mismatches.push({ kind: 'section-order', detail: 'band tag sequence differs', reference: seq(rs).slice(0, 300), build: seq(bs).slice(0, 300) });
      if (rs.totalHeight && bs.totalHeight) {
        const ratio = bs.totalHeight / Math.max(1, rs.totalHeight);
        if (ratio < 0.7 || ratio > 1.4) mismatches.push({ kind: 'page-height', detail: 'build height ' + bs.totalHeight + 'px vs reference ' + rs.totalHeight + 'px (ratio ' + ratio.toFixed(2) + ')' });
      }
      const pal = (x) => new Set(x.bands.map((b) => String(b.background || '').toLowerCase()).filter(Boolean));
      const rp = pal(rs), bp = pal(bs);
      const onlyRef = [...rp].filter((c) => ![...bp].some((d) => d === c));
      if (onlyRef.length >= 2) mismatches.push({ kind: 'palette', detail: onlyRef.length + ' reference backgrounds absent in build: ' + onlyRef.slice(0, 4).join(', ') });
      return textResult({ mode, reference: rs, build: bs, mismatches, manualJudgment: ['imagery tone and spacing rhythm need human eyes', 'motion/interaction parity is not covered here — see aura_motion_study'], metrics: { refBands: rs.bands.length, buildBands: bs.bands.length }, sources: [rs.source, bs.source], ...((rs.source !== 'live-dom' || bs.source !== 'live-dom') ? { estimateNote: 'one or both sides are layout estimates (no measured offsets) — counts/order still comparable, heights are not' } : {}) }); },
    aura_motion_study: async (a) => { a = a || {}; const mode = awardMode(a.mode, ['inspect', 'record', 'search'], 'mode');
      if (mode === 'search') {
        const r = awardIndex.searchMotion({ library: str(a.library, 'library'), easing: str(a.easing, 'easing'), scrollModel: a.scrollModel === undefined ? undefined : String(a.scrollModel), limit: awardLimit(a.frames, 10, 25) });
        if (r.empty) return textResult({ mode, total: 0, items: [], emptyCorpus: true, note: 'no motion studies stored yet' });
        return textResult({ mode, total: r.total, items: r.items, emptyCorpus: false });
      }
      const allowLocal = a.allowLocal === undefined ? false : bool(a.allowLocal, 'allowLocal');
      const viewport = a.viewport === undefined ? 'desktop' : awardMode(a.viewport, ['desktop', 'mobile'], 'viewport');
      const target = awardValidateHttpUrl(a.url || bad('url (string) is required'), { allowLocal });
      if (!awardBrowser) throw awardErr('BROWSER_UNAVAILABLE', 'motion ' + mode + ' needs Chrome: install it or set AURA_CHROME_PATH. Fallback motion plan (generic, NOT observed): entrances <500ms ease-out; scroll reveals via IntersectionObserver; hover 1.03 + shadow; easing ease-out/cubic-bezier(.22,1,.36,1); prefers-reduced-motion disables parallax/scrub. aura_motion_study {mode:search} still queries stored studies.');
      if (mode === 'inspect') {
        const study = await awardBrowser.motionInspect(target, { viewport, allowLocal });
        try { awardIndex.recordMotion(study); } catch { /* memory fallback never fails */ }
        return textResult({ mode, study });
      }
      const frames = a.frames === undefined ? 8 : num(a.frames, 'frames');
      if (typeof frames !== 'number' || frames < 2 || frames > 16) bad('frames must be 2-16');
      const durationMs = a.durationMs === undefined ? 12000 : num(a.durationMs, 'durationMs');
      if (typeof durationMs !== 'number' || durationMs < 4000 || durationMs > 30000) bad('durationMs must be 4000-30000');
      const rec = await awardBrowser.recordFrames(target, { frames: Math.floor(frames), viewport, allowLocal, durationMs: Math.floor(durationMs) });
      if (rec.study) { try { awardIndex.recordMotion(rec.study); } catch { /* ignore */ } }
      let video = null, videoAvailable = false, videoHint = null;
      try {
        const enc = await awardBrowser.encodeWebm(rec.frames, {});
        video = enc.video; videoAvailable = !!enc.available; videoHint = enc.hint || null;
      } catch (e) { videoHint = String((e && e.message) || e).slice(0, 160); }
      if (!videoAvailable && !videoHint) videoHint = 'ffmpeg not found; install ffmpeg or set AURA_FFMPEG_PATH for .webm output — frame JPEGs retained';
      return textResult({ mode, url: target, study: rec.study, frames: rec.frames, frameCount: rec.frameCount, video, video_available: videoAvailable, ...(videoHint ? { videoHint } : {}), ...(rec.retentionNote ? { retentionNote: rec.retentionNote } : {}) }); },
    aura_award_index: async (a) => { a = a || {}; const action = awardMode(a.action, ['status', 'rebuild', 'resume', 'refresh', 'new_winners', 'watch_add', 'watch_list', 'watch_remove'], 'action');
      if (action === 'status') return textResult({ action, ...awardIndex.getStatus() });
      if (action === 'watch_list') return textResult({ action, watches: awardIndex.watchList() });
      if (action === 'watch_add') {
        const kind = awardMode(a.kind, ['studio', 'tag', 'url'], 'kind');
        if (typeof a.pattern !== 'string' || !a.pattern.trim()) bad('pattern (string) is required');
        return textResult({ action, watch: awardIndex.watchAdd({ kind, pattern: a.pattern, award: a.award }) });
      }
      if (action === 'watch_remove') {
        const kind = awardMode(a.kind, ['studio', 'tag', 'url'], 'kind');
        if (typeof a.pattern !== 'string' || !a.pattern.trim()) bad('pattern (string) is required');
        return textResult({ action, ...awardIndex.watchRemove({ kind, pattern: a.pattern }) });
      }
      if (action === 'new_winners') {
        if (!awardClient) throw awardErr('UNSUPPORTED_OPERATION', 'new_winners needs an award client (server wiring)');
        const r = await awardIndex.newWinners({ client: awardClient, award: a.award || 'sotd' });
        let deltas = []; let seeded = [];
        try {
          if (awardIndex.checkWatchesDetailed) { const w = awardIndex.checkWatchesDetailed(); deltas = w.deltas || []; seeded = w.seeded || []; }
          else deltas = awardIndex.checkWatches ? awardIndex.checkWatches() : [];
        } catch { deltas = []; seeded = []; }
        return textResult({ action, ...r, watchDeltas: deltas, ...(seeded.length ? { watchBaselineSeeded: seeded, watchBaselineNote: 'first check for these watches seeded their baseline silently — future deltas report newly indexed matches only' } : {}) });
      }
      if (!awardClient) throw awardErr('UNSUPPORTED_OPERATION', action + ' needs an award client (server wiring)');
      const maxPages = a.maxPages === undefined ? 5 : num(a.maxPages, 'maxPages');
      if (typeof maxPages !== 'number' || maxPages < 1 || maxPages > 20) bad('maxPages must be 1-20 (bounded crawl per call; resume for more)');
      // Bounded crawl: the index layer owns the plan; maxPages caps fetches
      // THIS call so a plan advances across calls instead of re-crawling the
      // same prefix. No tag slicing here — the stored plan defines the pages.
      const args = { client: awardClient, maxPages: Math.floor(maxPages) };
      const r = action === 'refresh' ? await awardIndex.refresh(args) : action === 'resume' ? await awardIndex.resume(args) : await awardIndex.rebuild(args);
      return textResult({ action, ...r, note: r.note || 'page budget reached; call resume to continue the same plan' }); },
  };
};
