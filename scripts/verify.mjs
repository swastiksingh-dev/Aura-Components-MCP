// Full verification: all 15 tools live + error paths, against dist/server.js.
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn(process.execPath, [join(root, 'dist', 'server.js')], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
let id = 0;
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try {
      const m = JSON.parse(line);
      if (m.id !== undefined && m.id !== null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    } catch { /* ignore */ }
  }
});
const call = (method, params) => new Promise((resolve) => {
  const myId = ++id;
  pending.set(myId, resolve);
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
});
const tool = (name, args) => call('tools/call', { name, arguments: args });
const text = (m) => { try { return m.result.content[0].text; } catch { return JSON.stringify(m); } };
const J = (m) => { try { return JSON.parse(text(m)); } catch { return null; } };
let pass = 0, fail = 0;
const check = (label, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? ' :: ' + String(extra).slice(0, 300) : '')); }
};
await call('initialize', {});
const t0 = Date.now();
const st = J(await tool('aura_status', {}));
check('status counts', st && st.counts.components_free === 2495 && st.counts.skills === 187, JSON.stringify(st).slice(0, 200));
const sc = J(await tool('aura_search_components', { query: 'pricing', limit: 3 }));
check('search components free-only', sc && sc.items.length > 0 && sc.items.every((i) => i.premium === false), JSON.stringify(sc).slice(0, 200));
const compId = sc.items[0].id;
const gc = J(await tool('aura_get_component', { id: compId }));
check('get component code', gc && gc.item && typeof gc.item.code === 'string' && gc.item.code.length > 500, JSON.stringify(gc).slice(0, 200));
const gi = J(await tool('aura_install_component', { id: compId }));
check('install component guide', gi && gi.install && gi.install.steps.length >= 2 && gi.install.files.length >= 1, JSON.stringify(gi).slice(0, 300));
const sk = J(await tool('aura_search_skills', { query: 'gsap', limit: 3 }));
check('search skills gsap', sk && sk.items.length > 0 && /gsap/i.test(sk.items[0].title), JSON.stringify(sk).slice(0, 200));
const gs = J(await tool('aura_get_skill', { id: sk.items[0].id }));
check('get skill content', gs && gs.item && typeof gs.item.content === 'string' && gs.item.content.length > 500, JSON.stringify(gs).slice(0, 200));
const si = J(await tool('aura_install_skill', { id: sk.items[0].id }));
check('install skill plan', si && si.install && si.install.files[0].path.includes('SKILL.md'), JSON.stringify(si).slice(0, 200));
const sa = J(await tool('aura_search_assets', { query: 'wine', limit: 2 }));
check('search assets', sa && sa.items.length > 0 && sa.items[0].image_800w, JSON.stringify(sa).slice(0, 200));
const sd = J(await tool('aura_search_design_systems', { query: 'infrastructure', limit: 2 }));
check('search design systems', sd && sd.items.length > 0, JSON.stringify(sd).slice(0, 200));
const gd = J(await tool('aura_get_design_system', { slug: sd.items[0].slug }));
check('get design system', gd && gd.item && typeof gd.item.content === 'string', JSON.stringify(gd).slice(0, 200));
const ud = J(await tool('aura_use_design_system', { slug: sd.items[0].slug }));
check('use design system tokens', ud && ud.tokens && ud.install && ud.install.files[0].path === 'DESIGN.md', JSON.stringify(ud).slice(0, 300));
const all = J(await tool('aura_search_all', { query: 'hero', limit: 2 }));
check('search all 4 surfaces', all && all.components && all.skills && all.assets && all.design_systems, Object.keys(all || {}).join(','));
const rec = J(await tool('aura_recommend', { goal: 'hero landing page' }));
check('recommend starter kit', rec && rec.starter_kit && rec.starter_kit.components.length > 0, JSON.stringify(rec).slice(0, 200));
const tr = J(await tool('aura_trending', { limit: 2 }));
check('trending 4 surfaces', tr && tr.components && tr.skills && tr.window.includes('90 days'), Object.keys(tr || {}).join(','));
const cats = J(await tool('aura_categories', {}));
check('13 categories with counts', cats && cats.categories && cats.categories.length === 13 && cats.categories.every((c) => typeof c.free === 'number'), JSON.stringify(cats).slice(0, 200));
const nf = await tool('aura_get_component', { id: 999999999 });
check('not-found -> -32004', nf.error && nf.error.code === -32004, JSON.stringify(nf).slice(0, 200));
const ba = await tool('aura_get_skill', {});
check('bad args -> -32602', ba.error && ba.error.code === -32602, JSON.stringify(ba).slice(0, 200));
const un = await tool('nope_tool', {});
check('unknown tool -> -32601', un.error && un.error.code === -32601, JSON.stringify(un).slice(0, 200));
console.log('VERIFY pass=' + pass + ' fail=' + fail + ' ms=' + (Date.now() - t0));
child.kill();
setTimeout(() => process.exit(fail ? 1 : 0), 500);
