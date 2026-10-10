// Module: guide — small interface (installGuide, tokenHints, detectNeeds)
// turning raw catalogue rows into paste-ready help: setup steps, file map,
// dependency list, token starter. Derived from row fields, no extra fetches.

const CDN = {
  tailwind: 'https://cdn.tailwindcss.com',
  iconify: 'https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js',
};

// Font allowlist: real families only. Tailwind weight/size utilities (medium, semibold,
// normal, light-as-weight, size-*) are NOT families — old regex leaked them into fonts[].
const KNOWN_FONTS = ['inter', 'geist', 'manrope', 'sora', 'space-grotesk', 'space-mono', 'poppins', 'montserrat', 'playfair-display', 'instrument-serif', 'dm-sans', 'dm-serif-display', 'jetbrains-mono', 'ibm-plex-mono', 'ibm-plex-serif', 'plus-jakarta-sans', 'bricolage-grotesque', 'newsreader', 'fraunces', 'lora', 'merriweather', 'libre-baskerville', 'cormorant-garamond', 'gfs-didot', 'bodoni-moda', 'cardo', 'marcellus', 'gloock', 'aboreto', 'syne', 'urbanist', 'sora', 'anton', 'bebas-neue', 'archivo-black', 'league-gothic', 'fredoka', 'chewy', 'foldit', 'oi', 'honk', 'nabla', 'quicksand', 'nunito', 'work-sans', 'oswald', 'lora', 'roboto', 'open-sans', 'figtree', 'outfit', 'lexend', 'gloria-hallelujah', 'caveat'];
const FONT_RE = /font-(?:family-)?\[?['"]?([a-z][a-z0-9-]*)/g;

export function detectNeeds(code, tags) {
  const c = String(code || '').toLowerCase();
  const t = new Set((tags || []).map((x) => String(x).toLowerCase()));
  const needsTailwind = c.includes('class=') || t.has('tailwind');
  // Probes must work on a 2k prefix too: icon svgs usually appear in the first screen of markup.
  // svg alone under-matches in lists (no code fetched) — but must not over-claim either:
  // 'svg' counts only with an icon-ish neighbor (iconify, <svg, lucide, heroicons, feather).
  const needsIcons = c.includes('iconify') || c.includes('<svg') || c.includes('lucide') || c.includes('heroicon') || c.includes('data-lucide');
  const needsKeyframes = c.includes('keyframes') || c.includes('animation:');
  const fonts = new Set();
  for (const m of c.matchAll(FONT_RE)) {
    const fam = m[1].replace(/['"\]]/g, '');
    if (KNOWN_FONTS.includes(fam)) fonts.add(fam);
  }
  // font-family: 'X', Y declarations (not utility classes)
  for (const m of c.matchAll(/font-family\s*:\s*([^;}]{1,80})/g)) {
    for (const part of m[1].split(',')) {
      const fam = part.trim().replace(/['"]/g, '').toLowerCase().replace(/\s+/g, '-');
      if (KNOWN_FONTS.includes(fam)) fonts.add(fam);
    }
  }
  return { needsTailwind, needsIcons, needsKeyframes, fonts: [...fonts].slice(0, 6) };
};

// Facets: cheap derived signals so search lists answer "dark? heavy? pro?" without a get.
// theme: dark|light|mixed|unknown from background field + code palette probes.
// weight: code_chars bucket (s/m/l) so agents can prefer light embeds.
export function facets(kind, row, opts) {
  const f = {};
  if (kind === 'components') {
    const bg = String(row.background || '').toLowerCase();
    const tags = (row.tags || []).map((x) => String(x).toLowerCase());
    const code = String(row.code || '').toLowerCase();
    const tagDark = tags.includes('dark');
    const tagLight = tags.includes('light');
    const darkHits = (code.match(/#0{3,6}\b|#1[0-9a-f]{5}\b|bg-black|bg-neutral-9|bg-zinc-9|bg-slate-9|text-white|slate-300/g) || []).length;
    const lightHits = (code.match(/bg-white|bg-neutral-50|bg-slate-50|bg-gray-50|text-black|text-neutral-9/g) || []).length;
    const bgDark = bg.includes('000') && !bg.includes('fff');
    const bgLight = bg.includes('fff') && !bg.includes('000');
    f.theme = bgDark || tagDark ? 'dark' : (bgLight || tagLight ? 'light' : (code ? (darkHits > lightHits * 2 ? 'dark' : (lightHits > darkHits * 2 ? 'light' : (darkHits || lightHits ? 'mixed' : 'unknown'))) : (tags.includes('saas') || tags.includes('minimal') ? 'light' : 'unknown')));
    const n = (opts && opts.fullLength) || String(row.code || '').length;
    f.weight = n > 20000 ? 'l' : (n > 8000 ? 'm' : 's');
    f.code_chars = n;
    const needs = detectNeeds(row.code || '', row.tags || []);
    f.needsTailwind = needs.needsTailwind;
    f.needsIcons = needs.needsIcons;
    f.fonts = needs.fonts;
    f.license = 'all-rights-reserved (Aura Terms §4) — check page_url before commercial reuse';
  }
  // ISS14 lives here too: license is top-level on every asset row, not buried.
  // ISS13: rewrite hotlinked demo images to stable asset references where possible.
  // i.pravatar.cc + bare demo URLs 404 in production; flag them in the install plan.
  if (kind === 'components' && typeof row.code === 'string') {
    const hot = [...row.code.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]).filter((u) => /pravatar|placehold|dummyimage|unsplash\/photos\/..\/download|example\.com/i.test(u));
    if (hot.length) row = { ...row, _hotlinked: [...new Set(hot)].slice(0, 5) };
  }
  if (kind === 'assets' || row.image_800w || row.image_original || row.video_url) {
    // Resolved 2026-09-13 from primary source https://www.aura.build/terms §4-5:
    // catalogue content is the exclusive property of DESIGNCODE IO PTE. LTD.;
    // no per-asset license column exists, so commercial reuse needs Aura's permission.
    f.license = 'all-rights-reserved (Aura Terms §4: DESIGNCODE IO PTE. LTD.) — personal/preview use via page_url; commercial reuse needs Aura permission (support@designcode.io)';
    // Gap 5: machine-readable license gate. commercial_ok:false always (no per-asset
    // column exists to prove otherwise) — agents filter without parsing prose.
    f.commercial_ok = false;
    f.terms_url = 'https://www.aura.build/terms';
    f.download = row.image_original || row.image_1600w || row.image_800w || row.video_url || null;
    f.preview = row.image_800w || row.video_poster_url || null;
  }
  if (kind === 'design_systems') {
    // ISS4: lists never fetch preview_html (24KB/row). has_preview:true is authoritative
    // only on detail; on lists report 'unknown-list' so agents fetch instead of trusting false.
    f.has_preview = row.preview_html !== undefined ? Boolean(row.preview_html) : 'unknown-list';
  }
  return f;
}

export function installGuide(kind, row) {
  const steps = [];
  const files = [];
  const deps = [];
  const url = row.page_url || '';
  if (kind === 'components') {
    const needs = detectNeeds(row.code || '', row.tags || []);
    if (needs.needsTailwind) {
      deps.push({ name: 'tailwindcss', via: 'CDN or project setup', cdn: CDN.tailwind });
      steps.push('Add the Tailwind CDN script to head for a quick preview, or paste the markup into a Tailwind project.');
    }
    if (needs.needsIcons) {
      deps.push({ name: 'iconify-icon', via: 'CDN', cdn: CDN.iconify });
      steps.push('Add the iconify-icon CDN script so the icon tags render.');
    }
    if (needs.needsKeyframes) steps.push('Keep the embedded style block with the markup: that is where the keyframes live.');
    // ISS11+12: pagination + CSS scoping. Code ships truncated at codeChars; the scope
    // prefix below prevents .button/.inner/.point collisions in multi-component scaffolds.
    const scope = 'aura-' + String(row.slug || row.id).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const fullLen = String(row.code || '').length;
    const isTrunc = /…\[truncated\]$/.test(String(row.code || ''));
    if (isTrunc) {
      files.push({ path: 'components/' + (row.slug || row.id) + '.part1.html', contains: 'markup part 1 of N — fetch aura_get_component again and concatenate code chunks' });
      steps.push('Code is paginated (' + fullLen + ' chars shown of more): install part files in order, or re-fetch for the full body.');
    } else {
      files.push({ path: 'components/' + (row.slug || row.id) + '.html', contains: 'section markup plus its style block' });
    }
    steps.push('Scope global CSS before pasting: prefix bare selectors (.button, .inner, .point) with .' + scope + ' to avoid collisions in multi-component pages.');
    steps.push('Paste the markup where the section belongs and update the CTA link (it ships as #).');
    if (url) steps.push('Preview first: ' + url);
    if (row._hotlinked && row._hotlinked.length) steps.push('Replace demo images before shipping (' + row._hotlinked.slice(0, 3).join(', ') + '): hotlinked placeholders 404 in production — swap for aura_search_assets results.');
    if (needs.fonts.length) files.push({ path: 'styles/fonts.css', contains: 'font families referenced: ' + needs.fonts.join(', ') });
    // Chunk concat helper: truncated installs carry the exact re-fetch plan so no
    // agent is left guessing how part files map to chunks.
    const ci = row.code_info || null;
    const concat = isTrunc ? {
      tool: 'aura_get_component',
      id: row.slug || row.id,
      chunks: (ci && ci.chunks) || 'unknown — call once with chunk:0 and read code_info.chunks',
      how: 'call aura_get_component with chunk:0..chunks-1 and concatenate code in order; part files above map 1:1 to chunks',
    } : null;
    const css_scope_how = 'in the pasted <style>, rewrite every bare class selector as .' + scope + ' <selector> (e.g. .button -> .' + scope + ' .button); leave Tailwind utilities, :root vars, and @keyframes names untouched';
    return { kind, title: row.title, page_url: url, free: row.premium === false, steps, deps, files, needs, css_scope: scope, css_scope_how, code_truncated: isTrunc, ...(concat ? { concat } : {}) };
  }
  if (kind === 'skills') {
    steps.push('Read the SKILL.md content from aura_get_skill first: it names its own triggers and pitfalls.');
    steps.push('Save it as SKILL.md inside your agent skills folder so the agent can load it.');
    if (row.source_url) steps.push('Upstream source: ' + row.source_url);
    return { kind, title: row.title, page_url: url, steps, deps, files: [{ path: 'skills/' + row.id + '/SKILL.md', contains: 'full skill content' }] };
  }
  if (kind === 'design_systems') {
    // ISS6: derive preview deps from preview_html so agents don't ship static pages.
    const ph = String(row.preview_html || '');
    const pl = ph.toLowerCase();
    const has = (...ss) => ss.some((s) => pl.includes(s));
    if (has('cdn.tailwindcss.com', 'tailwind')) deps.push({ name: 'tailwindcss', via: 'CDN (in preview_html)', cdn: CDN.tailwind });
    if (has('iconify', '<svg', 'lucide', 'data-lucide')) deps.push({ name: 'iconify-icon', via: 'CDN (in preview_html)', cdn: CDN.iconify });
    if (has('gsap')) deps.push({ name: 'gsap', via: 'CDN (in preview_html)', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js' });
    if (has('scrolltrigger')) deps.push({ name: 'gsap-ScrollTrigger', via: 'CDN (in preview_html)', cdn: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js' });
    const fonts = new Set();
    for (const m of pl.matchAll(/family=([a-z+]+)/g)) fonts.add(m[1].replace(/\+/g, '-'));
    if (fonts.size) deps.push({ name: 'google-fonts:' + [...fonts].slice(0, 4).join(','), via: 'link (in preview_html)' });
    steps.push('Copy the DESIGN.md content into your repo as DESIGN.md and treat it as the source of truth.');
    steps.push('Apply the color, type, and spacing tokens before copying any component markup.');
    if (deps.length) steps.push('Install preview deps first (' + deps.map((d) => d.name).join(', ') + ') — the preview_html needs them.');
    return { kind, title: row.title, page_url: url, steps, deps, files: [{ path: 'DESIGN.md', contains: 'tokens and rules' }] };
  }
  steps.push('Use the image_800w URL for previews and image_original for production.');
  return { kind, title: row.title, page_url: url, steps, deps, files };
};

// Scaffold merge: one ordered page from a system + component rows. Owns the
// dep-dedupe and file-collection rules so the scaffold handler stays a thin
// adapter (fetch + freeOnly policy) and tests cross this seam, not the wire.
export function combineScaffold(sysItem, comps) {
  const guides = (comps || []).map((c) => installGuide('components', c));
  const deps = []; const seen = new Set();
  for (const g of guides) for (const d of (g.deps || [])) if (!seen.has(d.name)) { seen.add(d.name); deps.push(d); }
  const files = [{ path: 'styles/tokens.css', contains: 'tokens.css from use_design_system' }];
  if (sysItem) files.push({ path: 'DESIGN.md', contains: 'system rules' });
  for (const g of guides) for (const f of (g.files || [])) files.push(f);
  return { guides, combined_deps: deps, files };
}

// ISS5: full token surface — colors + typography + spacing + radius — so scaffolded
// pages don't lose the system. Also detects preview dark/light mode so agents don't
// apply light-cream tokens to a dark preview body.
export function previewMode(previewHtml) {
  const h = String(previewHtml || '').toLowerCase();
  if (/bg-black|bg-neutral-950|bg-zinc-950|bg-slate-950|bg-\[#0/.test(h)) return 'dark';
  if (/bg-white|bg-neutral-50|bg-slate-50/.test(h)) return 'light';
  return 'unknown';
}

export function tokenHints(content, previewHtml) {
  const Q = String.fromCharCode(39);
  const lines = String(content || '').split(Q + 'n' === Q + 'n' ? '\n' : '\n');
  const get = (key) => {
    const line = lines.find((l) => { const t = l.trim().toLowerCase(); return t === key + ':' || t.startsWith(key + ': ') || t.startsWith(key + ' :') || t.startsWith(key + ':\"') || t.startsWith(key + ":'"); });
    if (!line) return null;
    const t = line.trim();
    const ci = t.toLowerCase().indexOf(key);
    let v = t.slice(ci + key.length).trim();
    if (v.startsWith(':')) v = v.slice(1).trim();
    while (v.startsWith(Q) || v.startsWith('"')) v = v.slice(1);
    while (v.endsWith(Q) || v.endsWith('"')) v = v.slice(0, -1);
    return v.trim() || null;
  };
  const tokens = {
    primary: get('primary'),
    secondary: get('secondary'),
    accent: get('accent'),
    background: get('background'),
    surface: get('surface'),
    text_primary: get('text-primary') || get('text_primary'),
    text_secondary: get('text-secondary') || get('text_secondary'),
    border: get('border'),
    display_font: get('display_lg_fontfamily') || get('display-font'),
    body_font: get('body_md_fontfamily') || get('body-font'),
    mono_font: get('label_md_fontfamily') || get('mono-font'),
    section_padding: get('section-padding') || get('section_padding'),
    card_padding: get('card-padding') || get('card_padding'),
    card_radius: get('card') === null ? get('card_radius') : null,
    control_radius: get('control'),
    pill_radius: get('pill'),
  };
  const pick = (obj, keys) => { const o = {}; for (const k of keys) if (obj[k]) o[k] = obj[k]; return o; };
  const colors = pick(tokens, ['primary', 'secondary', 'accent', 'background', 'surface', 'text_primary', 'text_secondary', 'border']);
  const rows = [];
  for (const [k, v] of Object.entries(colors)) rows.push('  --aura-' + k.replace(/_/g, '-') + ': ' + v + ';');
  if (tokens.body_font) rows.push('  --aura-font-body: ' + tokens.body_font + ';');
  if (tokens.display_font) rows.push('  --aura-font-display: ' + tokens.display_font + ';');
  if (tokens.mono_font) rows.push('  --aura-font-mono: ' + tokens.mono_font + ';');
  if (tokens.section_padding) rows.push('  --aura-section-padding: ' + tokens.section_padding + ';');
  if (tokens.card_padding) rows.push('  --aura-card-padding: ' + tokens.card_padding + ';');
  if (tokens.card_radius) rows.push('  --aura-radius-card: ' + tokens.card_radius + ';');
  if (tokens.control_radius) rows.push('  --aura-radius-control: ' + tokens.control_radius + ';');
  if (tokens.pill_radius) rows.push('  --aura-radius-pill: ' + tokens.pill_radius + ';');
  const css = rows.length ? ':root{' + '\n' + rows.join('\n') + '\n}' : '';
  const mode = previewMode(previewHtml);
  const warn = (mode === 'dark' && tokens.background && !/000|0f1115|111827|1a1a1a|09090b/i.test(tokens.background))
    ? 'tokens say light background ' + tokens.background + ' but preview_html renders dark — follow the preview body, not the tokens, or ask which mode is wanted'
    : ((mode === 'light' && tokens.background && /000000|0f1115/i.test(tokens.background))
      ? 'tokens say dark background but preview renders light — follow the preview body'
      : null);
  return { tokens, css, ...(mode === 'unknown' ? {} : { preview_mode: mode }), mode_warning: warn };
}

// Module: prompt — deep module, small interface (buildPrompt) over all
// need-based prompt rules. Pure, no fetch: same seam for tool + tests + docs.
// Pass 1 (no answers): draft + questions[<=4] + next_call. Agent MUST ask the
// user via native question UI before Pass 2. Pass 2 (with answers): final.
const PROMPT_SOURCES = [
  'https://www.aura.build/learn/tips-for-prompting',
  'https://www.aura.build/learn/introduction',
  'https://www.aura.build/design-systems',
];
const PROMPT_CREDIT = 'Built by swastiksingh-dev — catalogue by Aura (aura.build)';
const PROMPT_ORDER = ['1 tokens.css', '2 system preview_html', '3 component markup in listed order'];

function promptThemeHint(goal, explicit) {
  if (explicit === 'dark' || explicit === 'light') return explicit;
  const t = String(goal || '').toLowerCase();
  if (/\bdark\b|\bmidnight\b|\bnoir\b|\bcinematic\b/.test(t) && !/\blight\b|\bbright\b|\bairy\b/.test(t)) return 'dark';
  if (/\blight\b|\bbright\b|\bairy\b/.test(t)) return 'light';
  return null;
}

function draftPromptText(goal, theme) {
  const th = theme ? theme + ' theme' : 'theme to confirm with user';
  return 'Build: ' + goal + ' (' + th + '). Use Tailwind CSS with container mx-auto px-4, hex palette, numeric color scale 50-900, 8px radius, 768px hamburger breakpoint, hover scale 1.05 + shadow. Typography: Inter 40-60 / 28-36 / 14-16, weights 640/560/460. Motion <500ms + prefers-reduced-motion. Tokens first (DESIGN.md), then markup. Confirm theme/sections/system with user before scaffolding.';
}

function finalPromptText(goal, a) {
  const theme = a.theme || 'confirm with user';
  const sections = (a.sections && a.sections.length ? a.sections.join(', ') : 'hero + 2 sections');
  const system = a.system || 'auto-pick via aura_search_design_systems';
  const assets = a.assets || 'only if needed via aura_search_assets';
  return 'GOAL: ' + goal + '\n'
    + 'THEME: ' + theme + ' (tokens first, follow preview body on mismatch)\n'
    + 'SECTIONS: ' + sections + '\n'
    + 'DESIGN SYSTEM: ' + system + ' — copy DESIGN.md as source of truth, apply color/type/spacing before markup\n'
    + 'ASSETS: ' + assets + '\n'
    + 'RULES: Tailwind container mx-auto px-4; hex palette 50-900; radius 8px; breakpoints 1024+/768-1023/<768, 44px touch targets; hover scale 1.05 + shadow; Inter 40-48 H1 / 16 body; motion <500ms + prefers-reduced-motion; vanilla HTML/Tailwind/JS, no proprietary runtime\n'
    + 'ORDER: 1 tokens.css, 2 system preview_html, 3 component markup\n'
    + 'CALLS: aura_recommend -> aura_get_* finalists -> aura_use_design_system -> aura_scaffold_page';
}

export function buildPrompt(input = {}) {
  const goal = typeof input.goal === 'string' ? input.goal.trim() : '';
  if (!goal) { const e = new Error('goal (string) is required'); e.code = 'BAD_ARGS'; throw e; }
  const themeIn = input.theme === 'dark' || input.theme === 'light' ? input.theme : undefined;
  if (input.theme !== undefined && themeIn === undefined) { const e = new Error('theme must be dark|light'); e.code = 'BAD_ARGS'; throw e; }
  const theme = promptThemeHint(goal, themeIn);
  const system = typeof input.system === 'string' && input.system.trim() ? input.system.trim() : null;
  const surfaces = Array.isArray(input.surfaces) ? input.surfaces.filter((s) => typeof s === 'string').slice(0, 4) : [];
  const answers = input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers) ? input.answers : null;

  if (!answers) {
    const questions = [
      { key: 'theme', question: 'Which theme — dark or light?', options: ['dark', 'light'] },
      { key: 'sections', question: 'Which sections (e.g. hero, pricing, testimonial, footer)?', options: [] },
      { key: 'system', question: 'Which DESIGN system, or auto-pick?', options: system ? [system, 'auto-pick'] : ['auto-pick'] },
      { key: 'assets', question: 'Need images/video?', options: ['no', 'images', 'video'] },
      { key: 'macrostructure', question: 'Which page macrostructure (e.g. bento-grid, marquee-hero, long-document), or auto-pick from Inspo evidence?', options: ['auto-pick', 'bento-grid', 'marquee-hero', 'long-document', 'photographic', 'stat-led'] },
      { key: 'vibe', question: 'Which mood — calm, serious, luxe, playful, technical?', options: ['calm', 'serious', 'luxe', 'playful', 'technical', 'warm'] },
    ];
    return {
      phase: 'draft',
      goal,
      theme_hint: theme,
      draft_prompt: draftPromptText(goal, theme),
      questions,
      missing: ['theme', 'sections', 'system', 'assets', 'macrostructure', 'vibe'],
      next_call: { tool: 'aura_prompt', arguments: { goal, answers: { theme: theme || 'dark', sections: [], system: system || 'auto-pick', assets: 'no', macrostructure: 'auto-pick', vibe: 'calm' } } },
      plan_order: PROMPT_ORDER,
      sources: PROMPT_SOURCES,
      credit: PROMPT_CREDIT,
      inspo_axes: { mode_maps_to: 'theme', macrostructures: INSPO_MACROS.slice(0, 6), note: 'Run inspo.recommend first for evidence, then aura_inspo_recommend to map it onto Aura calls. Mode folds into theme.' },
      note: 'Ask the user these questions via native question UI, then call aura_prompt again with goal + answers. Never skip confirmation.',
    };
  }

  const a = {
    theme: answers.theme === 'dark' || answers.theme === 'light' ? answers.theme : (theme || 'dark'),
    sections: Array.isArray(answers.sections) ? answers.sections.filter((s) => typeof s === 'string').slice(0, 6) : [],
    system: typeof answers.system === 'string' && answers.system.trim() ? answers.system.trim() : (system || 'auto-pick'),
    assets: typeof answers.assets === 'string' ? answers.assets : 'no',
    macrostructure: typeof answers.macrostructure === 'string' && answers.macrostructure.trim() ? answers.macrostructure.trim() : 'auto-pick',
    vibe: typeof answers.vibe === 'string' && answers.vibe.trim() ? answers.vibe.trim() : 'calm',
  };
  return {
    phase: 'final',
    goal,
    answers: a,
    final_prompt: finalPromptText(goal, a),
    plan_order: PROMPT_ORDER,
    suggested_calls: [
      { tool: 'inspo.recommend', arguments: { brief: goal, mode: a.theme, vibe: a.vibe, ...(a.macrostructure !== 'auto-pick' ? { macrostructure: a.macrostructure } : {}) } },
      { tool: 'aura_inspo_recommend', arguments: { brief: goal, mode: a.theme, vibe: a.vibe, ...(a.macrostructure !== 'auto-pick' ? { macrostructure: a.macrostructure } : {}) } },
      { tool: 'aura_recommend', arguments: { goal } },
      { tool: 'aura_search_all', arguments: { query: goal, limit: 3 } },
      { tool: 'aura_use_design_system', arguments: a.system !== 'auto-pick' ? { slug: a.system } : { slug: 'auto-pick: search first' } },
      { tool: 'aura_scaffold_page', arguments: { goal, system: a.system } },
    ],
    page_urls: ['https://www.aura.build/design-systems', 'https://www.aura.build/components'],
    sources: PROMPT_SOURCES,
    surfaces: surfaces.length ? surfaces : ['components', 'design_systems', 'assets', 'skills'],
    credit: PROMPT_CREDIT,
  };
};

// Module: inspo-mappers — pure zero-dep translators between Inspo evidence and
// Aura calls. No fetch: the agent pastes slim Inspo evidence in, gets Aura call
// plans out. Same seam for tools + tests + docs (mirrors buildPrompt).
export const INSPO_MACROS = ['bento-grid', 'long-document', 'marquee-hero', 'stat-led', 'conversational-faq', 'manifesto', 'photographic', 'specimen', 'catalogue', 'letter', 'index-first', 'narrative-workflow', 'split-studio', 'feature-stack', 'type-specimen', 'portfolio-grid', 'map-diagram', 'ecosystem-index', 'component-playground'];
export const INSPO_VIBES = ['calm', 'loud', 'playful', 'serious', 'luxe', 'raw', 'soft', 'technical', 'warm', 'cold'];
export const INSPO_MODES = ['light', 'dark'];
export const INSPO_COMP_TYPES = ['hero', 'pricing', 'features', 'cta', 'nav', 'footer', 'testimonial', 'logo-cloud', 'faq', 'stat'];
export const INSPO_STYLES = ['minimalism', 'editorial', 'brutalism', 'glassmorphism', 'swiss', 'maximalism', 'playful', 'dark-mode', 'monochrome', 'vintage', 'futurist'];
export const INSPO_MACRO_TO_CATEGORY = {
  'bento-grid': 'feature', 'long-document': 'section', 'marquee-hero': 'hero',
  'stat-led': 'feature', 'conversational-faq': 'form', 'manifesto': 'heading',
  'photographic': 'background', 'specimen': 'card', 'catalogue': 'card',
  'letter': 'heading', 'index-first': 'header', 'narrative-workflow': 'section',
  'split-studio': 'hero', 'feature-stack': 'feature', 'type-specimen': 'heading',
  'portfolio-grid': 'card', 'map-diagram': 'feature', 'ecosystem-index': 'section',
  'component-playground': 'section',
};
export const INSPO_COMP_TO_CATEGORY = {
  hero: 'hero', pricing: 'pricing', features: 'feature', cta: 'section',
  nav: 'header', footer: 'footer', testimonial: 'testimonial',
  'logo-cloud': 'logo', faq: 'form', stat: 'feature',
};
const INSPO_LICENSE = 'Reference JSX is Inspo-canonical (copy-pasteable, tweak tokens to the brand). Aura markup/assets are all-rights-reserved per Aura Terms §4 — fine to prototype, check each page_url before commercial ship.';
const INSPO_SLIM_KEYS = ['slug', 'palette', 'fonts', 'macro', 'macrostructure', 'mode', 'vibe', 'style', 'type', 'id', 'brief', 'brand_hex', 'background', 'text'];
// Palette priority (locked): brand hex > Inspo evidence > Aura tokens. Aura keeps structure/spacing.
const INSPO_ORDER = ['1 tokens.css', '2 system preview_html', '3 component markup in listed order'];
const INSPO_IMAGE_PLAN = { draft: 'image_800w', prod: 'image_original', srcset: [320, 800, 1600], alt_from: 'title', swap_hotlinked: ['pravatar', 'placehold', 'dummyimage', 'example.com'], weight_cap: 's|m only — full:true on the winner alone' };

function inspoBad(msg) { const e = new Error(msg); e.code = 'BAD_ARGS'; throw e; }
function inspoHex(v, name) {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^#?[0-9a-f]{3}([0-9a-f]{3})?$|^#?[0-9a-f]{6}$/i.test(v.trim())) inspoBad(name + ' must be a hex color like "#c7402f"');
  const h = v.trim().replace(/^#/, '');
  return '#' + (h.length === 3 ? h.split('').map((c) => c + c).join('') : h).toLowerCase();
}
function inspoLum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
export function inspoContrastWarn(bg, text) {
  if (!bg || !text) return null;
  const l1 = inspoLum(bg), l2 = inspoLum(text);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return ratio < 4.5 ? 'contrast ' + ratio.toFixed(2) + ':1 (' + bg + ' on ' + text + ') is below 4.5 — ask the user which side moves' : null;
}
function inspoSlimCheck(ev, name) {
  if (!ev || typeof ev !== 'object' || Array.isArray(ev)) inspoBad(name + ' must be an object with slim keys only: ' + INSPO_SLIM_KEYS.join(','));
  for (const k of Object.keys(ev)) {
    if (!INSPO_SLIM_KEYS.includes(k)) inspoBad(name + '.' + k + ' is not slim — pass slugs+palette+fonts+macro+mode+vibe only, no autopsy/screenshots');
  }
  return ev;
}

export function buildInspoRecommend(input = {}) {
  const brief = typeof input.brief === 'string' ? input.brief.trim() : '';
  if (!brief) inspoBad('brief (string) is required');
  const mode = input.mode === undefined ? undefined : (INSPO_MODES.includes(input.mode) ? input.mode : inspoBad('mode must be light|dark'));
  const vibe = input.vibe === undefined ? undefined : (INSPO_VIBES.includes(input.vibe) ? input.vibe : inspoBad('vibe must be one of ' + INSPO_VIBES.join('|')));
  const macro = input.macrostructure === undefined ? undefined : (INSPO_MACROS.includes(input.macrostructure) ? input.macrostructure : inspoBad('macrostructure must be one of ' + INSPO_MACROS.join('|')));
  const brand = inspoHex(input.brand_hex, 'brand_hex');
  // Strict macro gate (locked): no macro on file means run Inspo first — never scaffold generic.
  if (!macro) {
    return {
      need_macro: true,
      brief, mode: mode || null, vibe: vibe || null, brand_hex: brand || null,
      inspo_call: { tool: 'inspo.recommend', arguments: { brief, ...(mode ? { mode } : {}), ...(vibe ? { vibe } : {}) } },
      note: 'No macrostructure yet — call inspo.recommend first, then call aura_inspo_recommend again with its macrostructure. Never scaffold without a macro.',
      palette_priority: ['brand_hex', 'inspo_evidence', 'aura_tokens'],
      order: INSPO_ORDER,
      license_note: INSPO_LICENSE,
    };
  }
  const category = INSPO_MACRO_TO_CATEGORY[macro];
  return {
    need_macro: false,
    brief, mode: mode || null, vibe: vibe || null, brand_hex: brand || null,
    macrostructure: macro, aura_category: category,
    inspo_call: { tool: 'inspo.recommend', arguments: { brief, macrostructure: macro, ...(mode ? { mode } : {}), ...(vibe ? { vibe } : {}) } },
    aura_calls: [
      { tool: 'aura_search_all', arguments: { query: brief, limit: 3, ...(mode ? { theme: mode } : {}) } },
      { tool: 'aura_recommend', arguments: { goal: brief, ...(mode ? { theme: mode } : {}) } },
      { tool: 'aura_search_components', arguments: { query: brief, category, ...(mode ? { theme: mode } : {}) } },
    ],
    palette_priority: ['brand_hex', 'inspo_evidence', 'aura_tokens'],
    image_plan: INSPO_IMAGE_PLAN,
    order: INSPO_ORDER,
    next: { tool: 'aura_inspo_components', arguments: { evidence: { type: 'hero', macrostructure: macro, ...(mode ? { mode } : {}) }, brief } },
    license_note: INSPO_LICENSE,
  };
}

export function buildInspoComponents(input = {}) {
  const ev = input.evidence && typeof input.evidence === 'object' && !Array.isArray(input.evidence) ? input.evidence : inspoBad('evidence {type, ...} is required');
  if (!INSPO_COMP_TYPES.includes(ev.type)) inspoBad('evidence.type must be one of ' + INSPO_COMP_TYPES.join('|'));
  if (ev.style !== undefined && !INSPO_STYLES.includes(ev.style)) inspoBad('evidence.style must be one of ' + INSPO_STYLES.join('|'));
  if (ev.macrostructure !== undefined && !INSPO_MACROS.includes(ev.macrostructure)) inspoBad('evidence.macrostructure must be one of ' + INSPO_MACROS.join('|'));
  if (ev.mode !== undefined && !INSPO_MODES.includes(ev.mode)) inspoBad('evidence.mode must be light|dark');
  for (const k of Object.keys(ev)) {
    if (!['type', 'style', 'macrostructure', 'mode', 'macro', 'vibe'].includes(k)) inspoBad('evidence.' + k + ' is not slim — type/style/macrostructure/mode only');
  }
  const brief = typeof input.brief === 'string' && input.brief.trim() ? input.brief.trim() : ev.type;
  const category = INSPO_COMP_TO_CATEGORY[ev.type];
  return {
    evidence: { ...ev },
    aura_category: category,
    inspo_call: { tool: 'inspo.find_components', arguments: { ...ev } },
    aura_search: { tool: 'aura_search_components', arguments: { query: brief, category, ...(ev.mode ? { theme: ev.mode } : {}) } },
    scaffold_hint: { order: INSPO_ORDER, weight_cap: 's|m only', tokens_first: true },
    image_plan: INSPO_IMAGE_PLAN,
    license_note: INSPO_LICENSE,
  };
}

export function buildInspoReference(input = {}) {
  const ev = input.evidence && typeof input.evidence === 'object' && !Array.isArray(input.evidence) ? input.evidence : inspoBad('evidence {type, id} is required');
  if (!INSPO_COMP_TYPES.includes(ev.type)) inspoBad('evidence.type must be one of ' + INSPO_COMP_TYPES.join('|'));
  if (typeof ev.id !== 'string' || !ev.id.trim()) inspoBad('evidence.id (string) is required');
  const ac = input.aura_component && typeof input.aura_component === 'object' && !Array.isArray(input.aura_component) ? input.aura_component : inspoBad('aura_component {id|slug} is required');
  const ref = typeof ac.id === 'string' && ac.id ? ac.id : (typeof ac.slug === 'string' && ac.slug ? ac.slug : inspoBad('aura_component needs id or slug'));
  const scope = 'aura-' + String(ref).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return {
    evidence: { type: ev.type, id: ev.id.trim() },
    aura_component: ref,
    inspo_call: { tool: 'inspo.get_reference_jsx', arguments: { type: ev.type, id: ev.id.trim() } },
    aura_call: { tool: 'aura_get_component', arguments: { id: ref } },
    adapt_plan: {
      scope, css_scope_how: 'rewrite bare selectors as .' + scope + ' <selector>; leave Tailwind utilities, :root vars, @keyframes untouched',
      token_swaps: ['--inspo-* -> --aura-* (brand hex wins ties)'],
      files: [{ path: 'styles/tokens.css', contains: 'merged tokens first' }, { path: 'components/' + ref + '.html', contains: 'adapted markup' }],
      steps: ['Fetch both sources', 'Swap Inspo tokens to brand/Aura tokens', 'Scope CSS with .' + scope, 'Replace hotlinked demo images (see image_plan)'],
    },
    image_plan: INSPO_IMAGE_PLAN,
    license_note: INSPO_LICENSE,
  };
}

export function buildInspoSystem(input = {}) {
  const toks = input.inspo_tokens && typeof input.inspo_tokens === 'object' && !Array.isArray(input.inspo_tokens) ? inspoSlimCheck(input.inspo_tokens, 'inspo_tokens') : inspoBad('inspo_tokens {palette, fonts, ...} is required');
  const slug = typeof input.aura_system === 'string' && input.aura_system.trim() ? input.aura_system.trim()
    : (input.aura_system && typeof input.aura_system.slug === 'string' && input.aura_system.slug.trim() ? input.aura_system.slug.trim() : inspoBad('aura_system slug (string) is required'));
  const palette = Array.isArray(toks.palette) ? toks.palette.map((c) => inspoHex(c, 'inspo_tokens.palette[]')) : [];
  const brand = inspoHex(toks.brand_hex, 'inspo_tokens.brand_hex');
  const bg = toks.background ? inspoHex(toks.background, 'inspo_tokens.background') : (brand || palette[0]);
  const tx = toks.text ? inspoHex(toks.text, 'inspo_tokens.text') : null;
  const contrast_warning = bg && tx ? inspoContrastWarn(bg, tx) : null;
  return {
    aura_system: slug,
    palette_priority: ['brand_hex', 'inspo_evidence', 'aura_tokens'],
    optionA_inspo: { palette, fonts: Array.isArray(toks.fonts) ? toks.fonts.slice(0, 4) : [] },
    optionB_aura: { fetch: { tool: 'aura_get_design_system', arguments: { slug } }, note: 'Fetch Aura tokens, then compare side by side.' },
    optionC_blend: { colors_from: brand ? 'brand_hex' : 'inspo palette', structure_from: 'aura DESIGN.md', note: 'Brand/Inspo colors on Aura spacing/type skeleton.' },
    contrast_warning,
    question: { key: 'system_choice', question: 'Inspo palette and Aura tokens disagree — which wins?', options: ['A-inspo', 'B-aura', 'C-blend'] },
    files: [{ path: 'styles/tokens.css', contains: 'merged winning tokens — paste first' }, { path: 'DESIGN.md', contains: 'winning system rules' }],
    order: INSPO_ORDER,
    tokens_first: true,
    license_note: INSPO_LICENSE,
  };
}

export function buildInspoCompare(input = {}) {  const list = Array.isArray(input.evidence) ? input.evidence : inspoBad('evidence must be an array of 2-4 slim site objects');
  if (list.length < 2 || list.length > 4) inspoBad('evidence must hold 2-4 sites — got ' + list.length);
  const sites = list.map((s, i) => {
    const o = inspoSlimCheck(s, 'evidence[' + i + ']');
    if (typeof o.slug !== 'string' || !o.slug.trim()) inspoBad('evidence[' + i + '].slug (string) is required');
    if (o.mode !== undefined && !INSPO_MODES.includes(o.mode)) inspoBad('evidence[' + i + '].mode must be light|dark');
    if (o.macrostructure !== undefined && !INSPO_MACROS.includes(o.macrostructure)) inspoBad('evidence[' + i + '].macrostructure must be one of ' + INSPO_MACROS.join('|'));
    return o;
  });
  const votes = {};
  for (const s of sites) for (const k of ['macrostructure', 'macro', 'mode']) {
    if (s[k]) votes[s[k]] = (votes[s[k]] || 0) + 1;
  }
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const house = { macrostructure: (sites.map((s) => s.macrostructure || s.macro).find(Boolean)) || null, mode: sites.map((s) => s.mode).find(Boolean) || null, agreement: top ? top[0] + ' x' + top[1] + '/' + sites.length : 'none' };
  const macro = house.macrostructure;
  const category = macro && INSPO_MACRO_TO_CATEGORY[macro] ? INSPO_MACRO_TO_CATEGORY[macro] : null;
  return {
    sites: sites.map((s) => s.slug),
    house_style: house,
    inspo_call: { tool: 'inspo.compare', arguments: { slugs: sites.map((s) => s.slug) } },
    closest_aura_systems_query: { tool: 'aura_search_design_systems', arguments: { query: macro || house.agreement, limit: 3 } },
    ranked_components_query: category ? { tool: 'aura_search_components', arguments: { query: macro, category } } : null,
    order: INSPO_ORDER,
    license_note: INSPO_LICENSE,
  };
}

// Module: docs-helpers — pure planners linking Aura output to fresh Context7
// docs. No fetch: the agent calls Context7, Aura shapes the lookup and applies
// the answer. Same seam for tools + tests + docs.
export const DOCS_TRUSTED = {
  tailwind: { label: 'Tailwind CSS', resolve: 'tailwindcss', id: null, cdn: 'https://cdn.tailwindcss.com', aura: ['installGuide tailwindcss dep', 'styles/tokens.css', 'scaffold order'] },
  gsap: { label: 'GSAP + ScrollTrigger', resolve: 'gsap', id: null, cdn: 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js', aura: ['installGuide gsap dep', 'preview_html motion'] },
  lenis: { label: 'Lenis smooth scroll', resolve: 'lenis', id: '/darkroomengineering/lenis', cdn: 'unpkg lenis@1 (confirm exact file via lookup)', aura: ['aura_motion_smooth wiring'] },
  iconify: { label: 'Iconify icons', resolve: 'iconify', id: null, cdn: 'https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js', aura: ['installGuide iconify-icon dep'] },
};
// Markers verified against renames we know happened; version pins below are
// never declared stale — they go to needs_check for a live lookup instead.
const DOCS_STALE_MARKERS = [
  { lib: 'lenis', re: /studio-freight/i, fix: 'Package renamed studio-freight -> lenis. Swap the import/CDN path, keep option names; look unchanged.' },
];
const DOCS_PIN_HINTS = [
  { lib: 'tailwind', re: /cdn\.tailwindcss\.com/i, check: 'Confirm v3 Play CDN vs v4 @tailwindcss/browser build via lookup.' },
  { lib: 'gsap', re: /cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/[\d.]+/i, check: 'Confirm latest 3.x pin via lookup.' },
  { lib: 'lenis', re: /unpkg\.com\/lenis/i, check: 'Confirm latest 1.x file via lookup.' },
  { lib: 'iconify', re: /iconify-icon\/[\d.]+/i, check: 'Confirm latest iconify-icon pin via lookup.' },
];
const DOCS_DEP_TO_LIB = { tailwindcss: 'tailwind', gsap: 'gsap', 'gsap-ScrollTrigger': 'gsap', 'iconify-icon': 'iconify' };

function docsBad(msg) { const e = new Error(msg); e.code = 'BAD_ARGS'; throw e; }

export function docsStampFor(deps) {
  const libs = [];
  for (const d of (deps || [])) {
    const lib = DOCS_DEP_TO_LIB[d && d.name];
    if (lib && !libs.includes(lib)) libs.push(lib);
  }
  return {
    status: 'unchecked',
    needs_check: libs.map((l) => l + ': confirm CDN/version via aura_docs_plan + Context7'),
    note: 'Vendored Aura code is a snapshot — verify pins before shipping.',
  };
}

export function buildDocsPlan(input = {}) {
  const raw = typeof input.library === 'string' ? input.library.trim().toLowerCase() : '';
  if (!raw) docsBad('library (string) is required');
  const need = typeof input.need === 'string' ? input.need.trim() : '';
  if (!need) docsBad('need (string) is required — what question should the docs answer?');
  const t = DOCS_TRUSTED[raw] || null;
  return {
    library: raw,
    trusted: !!t,
    context7: t
      ? { resolve: t.resolve, ...(t.id ? { id: t.id } : {}), query: need, note: t.id ? 'ID verified — query it directly.' : 'Resolve the id first via Context7, then query.' }
      : { resolve: raw, query: need, note: 'Unlisted library — resolve the id first via Context7, then query. Apply guidance is generic.' },
    apply: t
      ? { aura_touchpoints: t.aura, steps: ['Look up via Context7', 'Adapt Aura code to the fresh API (keep the look identical)', 'Update the docs_stamp from unchecked to checked'] }
      : { aura_touchpoints: [], steps: ['Look up via Context7', 'Apply carefully — no Aura mapping exists for this library'] },
    stamp: { status: 'planned', needs_check: [raw + ': ' + need] },
  };
}

export function buildDocsCheck(input = {}) {
  const raw = typeof input.library === 'string' ? input.library.trim().toLowerCase() : '';
  if (!raw) docsBad('library (string) is required');
  const code = typeof input.code_excerpt === 'string' ? input.code_excerpt : docsBad('code_excerpt (string) is required');
  if (!code.trim()) docsBad('code_excerpt must not be empty');
  if (code.length > 20000) docsBad('code_excerpt is ' + code.length + ' chars — paste excerpts under 20000 chars, not full pages');
  const note = typeof input.docs_note === 'string' && input.docs_note.trim() ? input.docs_note.trim() : null;
  const fixes = [];
  for (const m of DOCS_STALE_MARKERS) {
    if (m.re.test(code)) fixes.push({ lib: m.lib, fix: m.fix });
  }
  const needs = [];
  for (const h of DOCS_PIN_HINTS) {
    if (h.re.test(code) && !needs.includes(h.lib + ': ' + h.check)) needs.push(h.lib + ': ' + h.check);
  }
  if (note) needs.push('agent-reported docs change: ' + note.slice(0, 200));
  return {
    library: raw,
    verdict: fixes.length ? 'needs-update' : 'current',
    fixes,
    needs_check: needs,
    rule: 'Fresh docs win on API, but edits must preserve the look — adapt Aura code, never restyle.',
    stamp: { status: fixes.length || note ? 'checked-with-findings' : 'checked', findings: fixes.length + (note ? 1 : 0) },
  };
}
