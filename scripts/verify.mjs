// Full verification: all 28 tools live + error paths, against dist/server.js.
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
check('status counts', st && st.counts.components_free >= 2495 && st.counts.skills >= 187 && st.counts.assets >= 30000, JSON.stringify(st && st.counts).slice(0, 200));
check('status freshness 4 surfaces', st && st.freshness && ['components', 'skills', 'assets', 'design_systems'].every((k) => Object.prototype.hasOwnProperty.call(st.freshness, k)), JSON.stringify(st && st.freshness).slice(0, 200));
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
const slim = J(await tool('aura_search_components', { query: 'hero', limit: 2 }));
check('slim lists omit code, keep excerpt+fetch', slim && slim.items.length > 0 && !('code' in slim.items[0]) && slim.items[0].code_excerpt && slim.items[0].full_fetch, JSON.stringify(slim.items[0]).slice(0, 200));
const full = J(await tool('aura_search_components', { query: 'hero', limit: 1, slim: false }));
check('slim:false restores full code', full && typeof full.items[0].code === 'string', JSON.stringify(full).slice(0, 200));
const non = J(await tool('aura_search_components', { query: 'xqztqvpzzzqqq', limit: 2 }));
check('honest empty nonsense', non && non.total === 0 && non.no_match === true && Array.isArray(non.suggested_queries) && non.suggested_queries.length > 0 && non.isFallback !== true, JSON.stringify(non).slice(0, 200));
const exm = J(await tool('aura_search_components', { query: 'xqztqvpzzzqqq', limit: 2, exact_match: true }));
check('exact_match skips fallbacks', exm && exm.total === 0 && Array.isArray(exm.suggested_queries) && exm.suggested_queries.length > 0, JSON.stringify(exm).slice(0, 200));
const rec2 = J(await tool('aura_recommend', { goal: 'hero landing page' }));
check('recommend capped + commercial note', rec2 && rec2.components.items.length <= 3 && rec2.commercial_note.includes('Terms'), JSON.stringify(rec2).slice(0, 200));
const recR = J(await tool('aura_recommend', { goal: 'pricing dark saas' }));
check('recommend auto-retry/editorial fill', recR && recR.starter_kit && recR.starter_kit.components.length > 0 && (recR.components.items.length > 0 || recR.components.retried_from || recR.components.editorial_fallback), JSON.stringify(recR && recR.components).slice(0, 300));
const scaf = J(await tool('aura_scaffold_page', { goal: 'dark SaaS pricing' }));
check('scaffold license note', scaf && scaf.license_note.includes('Terms') && scaf.order.length === 3, JSON.stringify(scaf).slice(0, 200));
const scafId = J(await tool('aura_scaffold_page', { goal: 'dark SaaS pricing', components: [{ id: '732' }] }));
check('scaffold [{id}] refs', scafId && Array.isArray(scafId.components) && scafId.components.length > 0, JSON.stringify(scafId).slice(0, 200));
const gcFull = J(await tool('aura_get_component', { id: compId, full: true }));
check('get component full:true', gcFull && gcFull.item && typeof gcFull.item.code === 'string' && gcFull.item.code.length === gc.item.code_info.full_length && !/\u2026\[truncated\]$/.test(gcFull.item.code), String(gcFull && gcFull.item && gcFull.item.code && gcFull.item.code.length));
const allTheme = J(await tool('aura_search_all', { query: 'hero', limit: 2, theme: 'dark' }));
check('search_all theme smoke', allTheme && allTheme.components && (allTheme.components.theme_hint === 'dark' || (Array.isArray(allTheme.components.items) && allTheme.components.items.length > 0)), JSON.stringify(allTheme && allTheme.components).slice(0, 200));
const cats = J(await tool('aura_categories', {}));
check('13 categories with counts', cats && cats.categories && cats.categories.length === 13 && cats.categories.every((c) => typeof c.free === 'number'), JSON.stringify(cats).slice(0, 200));
const pr1 = J(await tool('aura_prompt', { goal: 'dark SaaS pricing' }));
check('prompt Pass1 draft + questions', pr1 && pr1.phase === 'draft' && pr1.questions.length === 6 && pr1.next_call.tool === 'aura_prompt', JSON.stringify(pr1).slice(0, 200));
const pr2 = J(await tool('aura_prompt', { goal: 'dark SaaS pricing', answers: { theme: 'dark', sections: ['hero', 'pricing'], system: 'auto-pick', assets: 'no' } }));
check('prompt Pass2 final copy-paste', pr2 && pr2.phase === 'final' && pr2.final_prompt.includes('dark SaaS pricing') && pr2.plan_order.length === 3, JSON.stringify(pr2).slice(0, 200));
const nf = await tool('aura_get_component', { id: 999999999 });
check('not-found -> -32004', nf.error && nf.error.code === -32004, JSON.stringify(nf).slice(0, 200));
const ba = await tool('aura_get_skill', {});
check('bad args -> -32602', ba.error && ba.error.code === -32602, JSON.stringify(ba).slice(0, 200));
const un = await tool('nope_tool', {});
check('unknown tool -> -32601', un.error && un.error.code === -32601, JSON.stringify(un).slice(0, 200));
const li = await call('tools/list', {});
check('tools/list exposes 28', li && li.result && Array.isArray(li.result.tools) && li.result.tools.length === 28 && li.result.tools.some((t) => t.name === 'aura_icon'), String(li && li.result && li.result.tools && li.result.tools.length));
const ig = J(await tool('aura_inspo_recommend', { brief: 'dark SaaS pricing' }));
check('inspo macro gate', ig && ig.need_macro === true && ig.inspo_call.tool === 'inspo.recommend', JSON.stringify(ig).slice(0, 200));
const dp = J(await tool('aura_docs_plan', { library: 'lenis', need: 'GSAP ticker integration' }));
check('docs plan trusted', dp && dp.trusted === true && dp.context7.id === '/darkroomengineering/lenis', JSON.stringify(dp).slice(0, 200));
const ic = J(await tool('aura_icon', { name: 'bolt' }));
check('icon live fetch + credit', ic && typeof ic.svg === 'string' && ic.svg.includes('<svg') && ic.credit.length > 0, JSON.stringify(ic).slice(0, 200));
const icBad = await tool('aura_icon', {});
check('icon missing name -> -32602', icBad.error && icBad.error.code === -32602, JSON.stringify(icBad).slice(0, 200));
const vv = J(await tool('aura_version', {}));
check('version verdict shape', vv && typeof vv.running === 'string' && typeof vv.update_available === 'boolean' && typeof vv.notice === 'string', JSON.stringify(vv).slice(0, 200));
const st2 = J(await tool('aura_status', {}));
check('status carries update verdict', st2 && st2.update && typeof st2.update.update_available === 'boolean', JSON.stringify(st2 && st2.update).slice(0, 200));
console.log('VERIFY pass=' + pass + ' fail=' + fail + ' ms=' + (Date.now() - t0));
child.kill();
setTimeout(() => process.exit(fail ? 1 : 0), 500);
