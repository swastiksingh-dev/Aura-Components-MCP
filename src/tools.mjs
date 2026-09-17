// Module: tools â€” thin adapters. Each tool validates args at the seam,
// calls one catalog/guide method, wraps textResult. No retries/caching here
// (except aura_recommend's single bounded auto-retry + editorial fill).
import { textResult } from './protocol.mjs';
import { installGuide, tokenHints, buildPrompt } from './guide.mjs';
const KINDS = ['components', 'skills', 'assets', 'design_systems'];
const SORTS = ['popular', 'recent', 'trending', 'updated'];
const CATS = ['hero','section','button','card','background','header','logo','feature','pricing','testimonial','footer','form','heading'];
function bad(msg) { const e = new Error(msg); e.code = 'BAD_ARGS'; throw e; }
function str(v, name) { if (v !== undefined && typeof v !== 'string') bad(name + ' must be a string'); return v; }
function num(v, name) { if (v !== undefined && typeof v !== 'number') bad(name + ' must be a number'); return v; }
function bool(v, name) { if (v !== undefined && typeof v !== 'boolean') bad(name + ' must be a boolean'); return v; }
function sort(v) { if (v !== undefined && !SORTS.includes(v)) bad('sort must be one of ' + SORTS.join('|')); return v; }
function theme(v) { if (v !== undefined && v !== 'dark' && v !== 'light') bad('theme must be dark|light'); return v; }
function idList(v, name) { if (v === undefined) return v; if (!Array.isArray(v) || !v.length || v.length > 8 || v.some((x) => typeof x !== 'string' && typeof x !== 'number')) bad(name + ' must be an array of 1-8 ids'); return v; }
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
export const TOOL_DEFS = [
  { name: 'aura_status', description: 'Catalogue health plus free counts (components, skills, assets, design systems). Free only, no login. Start here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_search_components', description: 'Search free Aura UI components (2,495). Text over title and description, optional category tag, theme dark|light filter, negative_theme exclusion, min_views floor, sorts. Slim rows by default (excerpt + fetch pointer, no full code; slim:false for full). exact_match:true skips fallbacks (honest empty).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: CATS }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_component', description: 'Full free component detail with HTML/Tailwind source, preview image, page URL. Numeric id or slug. Chunk param pages large code (see code_info). full:true returns full code (ignores chunk).', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' }, chunk: { type: 'number' }, full: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_skills', description: 'Search free Aura agent skills (187). Metadata only, slim by default; use aura_get_skill for the full SKILL.md content. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_skill', description: 'Full free agent-skill content (SKILL.md body) plus source_url and page URL. Skill id. Chunk param pages large bodies (see content_info).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, chunk: { type: 'number' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_search_assets', description: 'Search free Aura assets (images and video). Keywords, media_type image or video. Slim rows by default. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, mediaType: { type: 'string', enum: ['image', 'video'] }, commercial_ok: { type: 'boolean' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_search_design_systems', description: 'Search free Aura DESIGN.md systems (725). Metadata + snippets, slim by default; use aura_get_design_system for content. exact_match:true skips fallbacks.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' }, slim: { type: 'boolean' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_get_design_system', description: 'Full free DESIGN.md content plus preview_html, tokens, and page URL. System id or slug. Chunk param pages large preview_html (see preview_info).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' }, chunk: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_search_all', description: 'One call across components, skills, assets, and design systems in parallel. Free only. Slim rows by default (excerpts, no blobs). Each surface runs its own fallback pipeline, so mixed outcomes are normal (skills may fall back while components go honestly empty) — read isFallback/no_match per surface, not once globally.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' }, slim: { type: 'boolean' }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, exact_match: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'aura_recommend', description: 'Starter kit for a goal: top 3 free hits per surface with page URLs and rationale. Slim rows + commercial-use note. Empty components auto-retry once via suggested_queries, then editorial picks.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, negative_theme: { type: 'string', enum: ['dark', 'light'] }, min_views: { type: 'number' }, slim: { type: 'boolean' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_install_component', description: 'Paste-ready setup for a free component: dependency list, setup steps, file map, fonts. Goes beyond the official Aura MCP, which only reads project source.', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_install_skill', description: 'Save-and-load plan for a free skill: where to put SKILL.md per client plus upstream source.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_use_design_system', description: 'Apply a free DESIGN.md system: token starter CSS plus copy order (tokens first, then markup).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_bundle', description: 'Bulk-fetch 2-8 component details in one call (ids or slugs). Per-item errors never fail the batch.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: {} }, slugs: { type: 'array', items: { type: 'string' } } }, additionalProperties: false } },
  { name: 'aura_scaffold_page', description: 'One ordered page build: DESIGN.md tokens.css + system preview + component markup in dependency order, combined deps + files[]. Merges install_* + use_* in a single turn. components accepts string|number|{id}|{slug} refs, e.g. ["732","1364"] or [{id:"732"}] or [{slug:"..."}]; full:true returns full bodies.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, system: { type: 'string' }, components: { type: 'array', items: {} }, full: { type: 'boolean' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_related', description: 'More-like-this: 3 related items for a component/skill/design-system by tag + text overlap. Discovery never dead-ends.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'skills', 'design_systems'] }, id: {} }, required: ['kind', 'id'], additionalProperties: false } },
  { name: 'aura_bulk_fetch', description: 'Bulk-fetch 2-8 details in one call for components, design_systems, or assets. Alias-friendly name for aura_bundle. Per-item errors never fail the batch.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['components', 'design_systems', 'assets'] }, ids: { type: 'array', items: {} } }, required: ['kind', 'ids'], additionalProperties: false } },
  { name: 'aura_install_asset', description: 'Legal drop-in plan for an asset: direct download URL, preview URL, license (all-rights-reserved per Aura Terms Â§4 â€” check page before commercial use), suggested file path.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_categories', description: 'The 13 component categories with live free counts. Pick one, then search within it.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_prompt', description: 'Need-based design prompt in 2 passes: Pass 1 (goal only) returns draft + 4 questions + next_call; ask the user via native question UI, then Pass 2 (goal + answers) returns copy-paste final_prompt + plan order + suggested calls. Always confirm with user before scaffolding.', inputSchema: { type: 'object', properties: { goal: { type: 'string' }, theme: { type: 'string', enum: ['dark', 'light'] }, surfaces: { type: 'array', items: { type: 'string' } }, system: { type: 'string' }, answers: { type: 'object' } }, required: ['goal'], additionalProperties: false } },
];
export function createHandlers(catalog) {
  const free = { freeOnly: true };
  return {
    aura_status: async () => textResult(await catalog.getStatus()),
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
      if (full === true) return textResult(await catalog.getItem('components', id, { full: true }));
      const chunk = a.chunk === undefined ? 0 : num(a.chunk, 'chunk');
      return textResult(await catalog.getItem('components', id, { chunk })); },
    aura_search_skills: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('skills', {
      query: str(a.query, 'query'), sort: sort(a.sort), limit: num(a.limit, 'limit'), offset: num(a.offset, 'offset'),
      slim: a.slim === undefined ? undefined : bool(a.slim, 'slim'),
      exact_match: a.exact_match === undefined ? undefined : bool(a.exact_match, 'exact_match'),
    })); },
    aura_get_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) bad('id (string) is required');
      const chunk = a.chunk === undefined ? 0 : num(a.chunk, 'chunk');
      return textResult(await catalog.getItem('skills', a.id, { chunk })); },
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
      const chunk = a.chunk === undefined ? 0 : num(a.chunk, 'chunk');
      return textResult(await catalog.getItem('design_systems', id, { chunk })); },
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
      // Gap 1: recommend hard-filters theme (not just reranks) â€” starter kits must not
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
      if (got.item && got.item.premium !== false) bad('that component is Pro (paid). Search with freeOnly or pick a free one.');
      return textResult({ item: got.item, install: installGuide('components', got.item) }); },
    aura_install_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) bad('id (string) is required');
      const got = await catalog.getItem('skills', a.id);
      return textResult({ item: got.item, install: installGuide('skills', got.item) }); },
    aura_use_design_system: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (typeof id !== 'string' || !id) bad('provide id or slug (string)');
      const got = await catalog.getItem('design_systems', id);
      return textResult({ item: got.item, install: installGuide('design_systems', got.item), tokens: tokenHints(got.item.content || '', got.item.preview_html || '') }); },
    aura_categories: async () => { const cats = await catalog.categoryCounts();
      const s = (cats || []).reduce((n, c) => n + (typeof c.free === 'number' ? c.free : 0), 0);
      return textResult({ categories: cats, overlap_note: 'Counts overlap: components carry multiple tags, so per-category free counts sum to ' + s + ' (> 2495 free total). They triage depth, not a partition.' }); },
    aura_prompt: async (a) => { a = a || {}; return textResult(buildPrompt({ goal: typeof a.goal === 'string' ? a.goal : undefined, theme: a.theme, surfaces: a.surfaces, system: a.system, answers: a.answers })); },
    aura_bundle: async (a) => { a = a || {}; const ids = normRefs(a.ids, 'ids') || normRefs(a.slugs, 'slugs');
      if (!ids || !ids.length) bad('provide ids (array of 1-8 numbers/strings) or slugs (array of strings)');
      return textResult({ kind: 'components', results: await catalog.bundleItems('components', ids) }); },
    aura_related: async (a) => { a = a || {}; const k = a.kind;
      if (k !== 'components' && k !== 'skills' && k !== 'design_systems') bad('kind must be components|skills|design_systems');
      const id = a.id; if (typeof id !== 'string' && typeof id !== 'number') bad('id is required');
      return textResult(await catalog.relatedItems(k, id, 3)); },
    aura_install_asset: async (a) => { a = a || {}; if (typeof a.id !== 'number') bad('id (number) is required');
      const got = await catalog.getItem('assets', a.id);
      const it = got.item; const fx = (it.facets || {});
      return textResult({ item: it, install: { kind: 'assets', title: it.title, page_url: it.page_url, license: fx.license || 'all-rights-reserved (Aura Terms Â§4)', terms_url: 'https://www.aura.build/terms', download: fx.download || null, preview: fx.preview || null, files: [{ path: 'assets/' + it.id + '-' + String(it.title || 'asset').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '.jpg', contains: 'downloaded original' }], steps: ['Check the license on the Aura asset page before commercial use â€” this server reports unknown, never assumes free-to-sell.', 'Download the download URL into the suggested path.', 'Use the preview URL for <img> srcset while drafting.'] } }); },
    aura_bulk_fetch: async (a) => { a = a || {}; const kind = a.kind;
      if (kind !== 'components' && kind !== 'design_systems' && kind !== 'assets') bad('kind must be components|design_systems|assets');
      const ids = normRefs(a.ids, 'ids');
      if (!ids || !ids.length) bad('provide ids (array of 1-8)');
      return textResult({ kind, results: await catalog.bundleItems(kind, ids) }); },
    aura_scaffold_page: async (a) => { a = a || {}; if (typeof a.goal !== 'string' || !a.goal.trim()) bad('goal (string) is required');
      const sysRef = (typeof a.system === 'string' && a.system) ? a.system : null;
      const compRefs = normRefs(a.components, 'components') || [];
      const full = a.full === undefined ? undefined : bool(a.full, 'full');
      const fullOpt = full === undefined ? {} : { full };
      const [sys, comps] = await Promise.all([
        sysRef ? catalog.getItem('design_systems', sysRef, fullOpt).catch(() => null) : catalog.searchCatalog('design_systems', { query: a.goal, limit: 1 }).then((r) => (r.items[0] ? { item: r.items[0] } : null)),
        compRefs.length ? catalog.bundleItems('components', compRefs, 5, fullOpt).then((rs) => rs.filter((x) => x.ok).map((x) => x.item)) : catalog.searchCatalog('components', { query: a.goal, freeOnly: true, limit: 3 }).then((r) => r.items),
      ]);
      const sysItem = sys && sys.item ? sys.item : null;
      const toks = sysItem ? tokenHints(sysItem.content || '') : { tokens: {}, css: '' };
      const guides = (comps || []).map((c) => installGuide('components', c));
      const deps = []; const seen = new Set();
      for (const g of guides) for (const d of (g.deps || [])) if (!seen.has(d.name)) { seen.add(d.name); deps.push(d); }
      const files = [{ path: 'styles/tokens.css', contains: 'tokens.css from use_design_system' }];
      if (sysItem) files.push({ path: 'DESIGN.md', contains: 'system rules' });
      for (const g of guides) for (const f of (g.files || [])) files.push(f);
      return textResult({ goal: a.goal, order: ['1 tokens.css', '2 system preview_html', '3 component markup in listed order'], tokens_css: toks.css || '', system: sysItem, components: comps || [], guides, combined_deps: deps, files, license_note: 'Markup and any pulled assets are all-rights-reserved per Aura Terms §4 — fine to prototype, check each page_url before commercial ship.' }); },
  };
};
