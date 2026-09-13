// Module: guide — small interface (installGuide, tokenHints, detectNeeds)
// turning raw catalogue rows into paste-ready help: setup steps, file map,
// dependency list, token starter. Derived from row fields, no extra fetches.

const CDN = {
  tailwind: 'https://cdn.tailwindcss.com',
  iconify: 'https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js',
};

export function detectNeeds(code, tags) {
  const c = String(code || '').toLowerCase();
  const t = new Set((tags || []).map((x) => String(x).toLowerCase()));
  const needsTailwind = c.includes('class=') || t.has('tailwind');
  const needsIcons = c.includes('iconify') || c.includes('svg');
  const needsKeyframes = c.includes('keyframes') || c.includes('animation:');
  const fonts = new Set();
  for (const m of c.matchAll(/font-([a-z0-9-]+)/g)) fonts.add(m[1]);
  return { needsTailwind, needsIcons, needsKeyframes, fonts: [...fonts].slice(0, 6) };
};

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
    steps.push('Paste the markup where the section belongs and update the CTA link (it ships as #).');
    if (url) steps.push('Preview first: ' + url);
    files.push({ path: 'components/' + (row.slug || row.id) + '.html', contains: 'section markup plus its style block' });
    if (needs.fonts.length) files.push({ path: 'styles/fonts.css', contains: 'font families referenced: ' + needs.fonts.join(', ') });
    return { kind, title: row.title, page_url: url, free: row.premium === false, steps, deps, files, needs };
  }
  if (kind === 'skills') {
    steps.push('Read the SKILL.md content from aura_get_skill first: it names its own triggers and pitfalls.');
    steps.push('Save it as SKILL.md inside your agent skills folder so the agent can load it.');
    if (row.source_url) steps.push('Upstream source: ' + row.source_url);
    return { kind, title: row.title, page_url: url, steps, deps, files: [{ path: 'skills/' + row.id + '/SKILL.md', contains: 'full skill content' }] };
  }
  if (kind === 'design_systems') {
    steps.push('Copy the DESIGN.md content into your repo as DESIGN.md and treat it as the source of truth.');
    steps.push('Apply the color, type, and spacing tokens before copying any component markup.');
    return { kind, title: row.title, page_url: url, steps, deps, files: [{ path: 'DESIGN.md', contains: 'tokens and rules' }] };
  }
  steps.push('Use the image_800w URL for previews and image_original for production.');
  return { kind, title: row.title, page_url: url, steps, deps, files };
};

export function tokenHints(content) {
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
    background: get('background'),
    surface: get('surface'),
    text: get('text-primary') || get('text_primary'),
  };
  const rows = Object.entries(tokens).filter((e) => e[1]).map((e) => '  --aura-' + e[0] + ': ' + e[1] + ';');
  const css = rows.length ? ':root{' + '\n' + rows.join('\n') + '\n}' : '';
  return { tokens, css };
};
