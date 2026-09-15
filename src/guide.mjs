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
    return { kind, title: row.title, page_url: url, free: row.premium === false, steps, deps, files, needs, css_scope: scope, code_truncated: isTrunc };
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
  return { tokens, css, preview_mode: mode, mode_warning: warn };
};
