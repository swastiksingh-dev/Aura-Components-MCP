// Module: tools — thin adapters. Each tool validates args at the seam,
// calls one catalog/guide method, wraps textResult. No retries/caching here.

import { textResult } from './protocol.mjs';
import { installGuide, tokenHints } from './guide.mjs';

const KINDS = ['components', 'skills', 'assets', 'design_systems'];
const SORTS = ['popular', 'recent', 'trending', 'updated'];
const CATS = ['hero','section','button','card','background','header','logo','feature','pricing','testimonial','footer','form','heading'];

function bad(msg) { const e = new Error(msg); e.code = 'BAD_ARGS'; throw e; }
function str(v, name) { if (v !== undefined && typeof v !== 'string') bad(name + ' must be a string'); return v; }
function num(v, name) { if (v !== undefined && typeof v !== 'number') bad(name + ' must be a number'); return v; }
function bool(v, name) { if (v !== undefined && typeof v !== 'boolean') bad(name + ' must be a boolean'); return v; }
function sort(v) { if (v !== undefined && !SORTS.includes(v)) bad('sort must be one of ' + SORTS.join('|')); return v; }
function cat(v) { if (v !== undefined && !CATS.includes(v)) bad('category must be one of ' + CATS.join('|')); return v; }

export const TOOL_DEFS = [
  { name: 'aura_status', description: 'Catalogue health plus free counts (components, skills, assets, design systems). Free only, no login. Start here.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aura_search_components', description: 'Search free Aura UI components (2,495). Text over title and description, optional category tag, sorts.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: CATS }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_get_component', description: 'Full free component detail with HTML/Tailwind source, preview image, page URL. Numeric id or slug.', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_search_skills', description: 'Search free Aura agent skills (187). Metadata only; use aura_get_skill for the full SKILL.md content.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_get_skill', description: 'Full free agent-skill content (SKILL.md body) plus source_url and page URL. Skill id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_search_assets', description: 'Search free Aura assets (images and video). Keywords, media_type image or video.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, mediaType: { type: 'string', enum: ['image', 'video'] }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_search_design_systems', description: 'Search free Aura DESIGN.md systems (725). Metadata only; use aura_get_design_system for content.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, sort: { type: 'string', enum: SORTS }, limit: { type: 'number' }, offset: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_get_design_system', description: 'Full free DESIGN.md content plus preview_html, tokens, and page URL. System id or slug.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_search_all', description: 'One call across components, skills, assets, and design systems in parallel. Free only.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_recommend', description: 'Starter kit for a goal: top free components, skills, design systems, and assets with page URLs and rationale.', inputSchema: { type: 'object', properties: { goal: { type: 'string' } }, required: ['goal'], additionalProperties: false } },
  { name: 'aura_install_component', description: 'Paste-ready setup for a free component: dependency list, setup steps, file map, fonts. Goes beyond the official Aura MCP, which only reads project source.', inputSchema: { type: 'object', properties: { id: {}, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_install_skill', description: 'Save-and-load plan for a free skill: where to put SKILL.md per client plus upstream source.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false } },
  { name: 'aura_use_design_system', description: 'Apply a free DESIGN.md system: token starter CSS plus copy order (tokens first, then markup).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, slug: { type: 'string' } }, additionalProperties: false } },
  { name: 'aura_trending', description: 'What is new and popular across the free catalogue: top components, skills, assets, design systems in one call.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, additionalProperties: false } },
  { name: 'aura_categories', description: 'The 13 component categories with live free counts. Pick one, then search within it.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

export function createHandlers(catalog) {
  const free = { freeOnly: true };
  return {
    aura_status: async () => textResult(await catalog.getStatus()),
    aura_search_components: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('components', {
      query: str(a.query, 'query'), tag: cat(a.category), freeOnly: true,
      sort: sort(a.sort), limit: num(a.limit, 'limit'), offset: num(a.offset, 'offset'),
    })); },
    aura_get_component: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (id === undefined || (typeof id !== 'string' && typeof id !== 'number')) bad('provide id (number) or slug (string)');
      return textResult(await catalog.getItem('components', id)); },
    aura_search_skills: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('skills', {
      query: str(a.query, 'query'), sort: sort(a.sort), limit: num(a.limit, 'limit'), offset: num(a.offset, 'offset'),
    })); },
    aura_get_skill: async (a) => { a = a || {}; if (typeof a.id !== 'string' || !a.id) bad('id (string) is required');
      return textResult(await catalog.getItem('skills', a.id)); },
    aura_search_assets: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('assets', {
      query: str(a.query, 'query'),
      mediaType: a.mediaType === undefined ? undefined : (a.mediaType === 'image' || a.mediaType === 'video' ? a.mediaType : bad('mediaType must be image|video')),
      freeOnly: true, sort: sort(a.sort), limit: num(a.limit, 'limit'), offset: num(a.offset, 'offset'),
    })); },
    aura_search_design_systems: async (a) => { a = a || {}; return textResult(await catalog.searchCatalog('design_systems', {
      query: str(a.query, 'query'), sort: sort(a.sort), limit: num(a.limit, 'limit'), offset: num(a.offset, 'offset'),
    })); },
    aura_get_design_system: async (a) => { a = a || {}; const id = a.id !== undefined ? a.id : a.slug;
      if (typeof id !== 'string' || !id) bad('provide id or slug (string)');
      return textResult(await catalog.getItem('design_systems', id)); },
    aura_search_all: async (a) => { a = a || {}; const query = str(a.query, 'query'), limit = num(a.limit, 'limit') || 5;
      const r = await Promise.all([
        catalog.searchCatalog('components', { query, freeOnly: true, limit }),
        catalog.searchCatalog('skills', { query, limit }),
        catalog.searchCatalog('assets', { query, freeOnly: true, limit }),
        catalog.searchCatalog('design_systems', { query, limit }),
      ]);
      return textResult({ query: query || null, components: r[0], skills: r[1], assets: r[2], design_systems: r[3] }); },
    aura_recommend: async (a) => { a = a || {}; if (typeof a.goal !== 'string' || !a.goal.trim()) bad('goal (string) is required');
      const r = await Promise.all([
        catalog.searchCatalog('components', { query: a.goal, freeOnly: true, limit: 5 }),
        catalog.searchCatalog('skills', { query: a.goal, limit: 5 }),
        catalog.searchCatalog('assets', { query: a.goal, freeOnly: true, limit: 3 }),
        catalog.searchCatalog('design_systems', { query: a.goal, limit: 3 }),
      ]);
      const pick = (x) => (x.items || []).slice(0, 3).map((i) => ({ title: i.title, page_url: i.page_url }));
      return textResult({ goal: a.goal, freeOnly: true,
        rationale: 'Top free catalogue hits per surface, ranked by Aura views. Open the page_url previews, then fetch full source or content for finalists.',
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
      return textResult({ item: got.item, install: installGuide('design_systems', got.item), tokens: tokenHints(got.item.content || '') }); },
    aura_trending: async (a) => { a = a || {}; const limit = num(a.limit, 'limit') || 5;
      const r = await Promise.all([
        catalog.searchCatalog('components', { freeOnly: true, sort: 'trending', limit }),
        catalog.searchCatalog('skills', { sort: 'trending', limit }),
        catalog.searchCatalog('assets', { freeOnly: true, sort: 'trending', limit }),
        catalog.searchCatalog('design_systems', { sort: 'trending', limit }),
      ]);
      return textResult({ window: 'last 7 days by views', components: r[0], skills: r[1], assets: r[2], design_systems: r[3] }); },
    aura_categories: async () => textResult({ categories: await catalog.categoryCounts() }),
  };
};
