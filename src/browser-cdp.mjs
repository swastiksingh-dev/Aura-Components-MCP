// Module: browser-cdp — optional native Chrome DevTools Protocol adapter.
// Zero npm deps: finds system Chrome/Chromium, launches an isolated profile,
// drives it over global WebSocket CDP (navigate, viewport, evaluate,
// screenshot), cleans up. Missing browser => BROWSER_UNAVAILABLE, never fake.
import { awardErr, awardValidateHttpUrl } from './awards.mjs';

export const CDP_VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } };
export const CDP_CAPTURE_TIMEOUT_MS = 45000;
export const CDP_NAV_TIMEOUT_MS = 30000;
export const CDP_MAX_SETTLE_MS = 8000;
export const CDP_MAX_FRAMES = 16;
export const CDP_MAX_RECORD_MS = 30000;

function cdpBuiltins() {
  const g = globalThis.process && globalThis.process.getBuiltinModule ? globalThis.process.getBuiltinModule : null;
  if (typeof g !== "function") throw awardErr("UNSUPPORTED_OPERATION", "browser capture needs Node 22+");
  return {
    fs: g.call(globalThis.process, "node:fs"),
    path: g.call(globalThis.process, "node:path"),
    os: g.call(globalThis.process, "node:os"),
    cp: g.call(globalThis.process, "node:child_process"),
    crypto: g.call(globalThis.process, "node:crypto"),
  };
}
function cdpBad(m) { return awardErr("BAD_ARGS", m); }
function cdpUnavailable(detail) {
  const e = awardErr("BROWSER_UNAVAILABLE", "no Chrome/Chromium found. Install Chrome or set AURA_CHROME_PATH to its executable. " + (detail || ""));
  return e;
}
// Normalize ANY CDP setup failure (socket refused, attach hang, first-frame
// timeout) to BROWSER_UNAVAILABLE with operation-specific fallback guidance.
// A hung Target.* handshake must never surface as a raw upstream timeout.
function cdpSetupFailed(op, err) {
  const why = String((err && err.message) || err).slice(0, 180);
  const fallback = op === "structure"
    ? " Fallback: aura_visual_audit {mode:structure} retries automatically over static HTML (source:static-html, no measured offsets)."
    : op === "motion"
      ? " Fallback: aura_motion_study {mode:search} still works over stored studies; otherwise write <500ms entrances + prefers-reduced-motion by hand."
      : " Fallback: aura_visual_audit {mode:structure} can still estimate sections from static HTML; screenshots need a working browser.";
  const e = awardErr("BROWSER_UNAVAILABLE", "browser control failed during " + op + " (" + why + "). Check that Chrome is installed and no firewall blocks 127.0.0.1 remote debugging." + fallback);
  return e;
}
export function cdpResolveViewport(name) {
  if (name === undefined || name === null) return CDP_VIEWPORTS.desktop;
  if (!CDP_VIEWPORTS[name]) throw cdpBad("viewport must be desktop|mobile");
  return CDP_VIEWPORTS[name];
}
// Self-contained page snippets (no closures; run via Runtime.evaluate).
export const CDP_SCAN_JS = `(() => { const doc = document; const out = { title: doc.title, totalHeight: Math.round(doc.documentElement.scrollHeight), candidates: [] }; const bodyW = (doc.body.getBoundingClientRect().width || 1); const push = (tag, label, bg, top, height, textStart) => out.candidates.push({ tag, label, bg, top: Math.round(top), height: Math.round(height), textStart }); push("body", "body", getComputedStyle(doc.body).backgroundColor, 0, out.totalHeight, ""); const seen = new Set(); const visit = (el, depth) => { if (depth > 6 || out.candidates.length >= 300 || seen.has(el)) return; seen.add(el); try { const r = el.getBoundingClientRect(); if (el !== doc.body && r.width >= 0.6 * bodyW && r.height >= 120) { const bg = getComputedStyle(el).backgroundColor || ""; const m = /rgba?\\(([^)]+)\\)/.exec(bg); let a = 0; if (m) { const parts = m[1].replace(/\\//g, " ").trim().split(/[\\s,]+/).filter(Boolean); const raw = parts.length >= 4 ? parts[3] : "1"; a = raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw); if (Number.isNaN(a)) a = 0; } else if (/^(oklch|oklab|lab|lch|hwb|color)\\(/.test(bg.trim())) a = 1; if (a > 0) push(el.tagName.toLowerCase(), (el.id ? "#" + el.id : "") + (el.classList.length ? "." + el.classList[0] : ""), bg, r.top + window.scrollY, r.height, (el.textContent || "").trim().slice(0, 60)); } } catch {} for (const ch of el.children) visit(ch, depth + 1); }; visit(doc.body, 0); return out; })()`;
export const CDP_MOTION_JS = `(() => { const g = window; const libs = []; const add = (s) => { if (!libs.includes(s)) libs.push(s); }; try { if (g.gsap || g.TweenMax) add("gsap"); if (g.ScrollTrigger && g.ScrollTrigger.getAll) add("scrolltrigger"); if (g.Lenis || (document.documentElement.classList && document.documentElement.classList.contains("lenis"))) add("lenis"); if (document.querySelector("[data-scroll-container]")) add("locomotive"); if (document.querySelector("[data-aos]")) add("aos"); if (g.Swiper || document.querySelector(".swiper")) add("swiper"); } catch {} const render = []; try { const cs = [...document.querySelectorAll("canvas")]; if (g.THREE) render.push("three"); if (g.PIXI) render.push("pixi"); if (cs.length && !render.length) render.push("webgl"); } catch {} let st = { count: 0, scrub: 0, pin: 0, sample: [] }; try { if (g.ScrollTrigger && g.ScrollTrigger.getAll) { const all = g.ScrollTrigger.getAll(); st.count = all.length; for (const s of all.slice(0, 20)) { const v = (s.vars || {}); if (v.scrub) st.scrub++; if (v.pin) st.pin++; st.sample.push({ start: v.start != null ? String(v.start) : null, end: v.end != null ? String(v.end) : null, scrub: !!v.scrub, pin: !!v.pin, duration: null, ease: null }); } } } catch {} const tweens = { durations: [], eases: [] }; try { const kids = (g.gsap && g.gsap.globalTimeline && g.gsap.globalTimeline.getChildren(true, true, true)) || []; for (const k of kids.slice(0, 100)) { try { const d = typeof k.duration === "function" ? k.duration() : k.vars && k.vars.duration; if (typeof d === "number") tweens.durations.push(d); if (k.vars && k.vars.ease) tweens.eases.push(String(k.vars.ease)); } catch {} } } catch {} let css = []; try { const anims = (document.getAnimations && document.getAnimations()) || []; for (const a of anims.slice(0, 200)) { try { const t = a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming(); if (t && t.easing && String(t.easing).includes("bezier")) css.push(String(t.easing)); if (t && typeof t.duration === "number") tweens.durations.push(t.duration / 1000); } catch {} } } catch {} return { libs, render, scrollTrigger: st, tweens, cssBeziers: css }; })()`;

// Pure band reducer (mirrors upstream sweep; tested with fixture DOM).
export function cdpCollapseBands(cands, totalHeight, maxBands = 40) {
  const usable = (cands || []).map((c) => ({ ...c, top: Math.round(c.top || 0), height: Math.round(c.height || 0) })).filter((c) => c.height > 0);
  const STEP = 8;
  const bgAt = (y) => {
    let best = null;
    for (const c of usable) if (c.top <= y && y < c.top + c.height && (!best || c.height < best.height)) best = c;
    return best;
  };
  const runs = [];
  let y = 0, cur = null;
  while (y < totalHeight) {
    const c = bgAt(y);
    if (cur && c && c.bg === cur.cand.bg) { /* continue */ }
    else {
      if (cur) runs.push({ cand: cur.cand, top: cur.top, height: y - cur.top });
      cur = c ? { cand: c, top: y } : null;
    }
    y += STEP;
  }
  if (cur) runs.push({ cand: cur.cand, top: cur.top, height: totalHeight - cur.top });
  const merged = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.sealed && prev.cand.bg === r.cand.bg) prev.height = r.top + r.height - prev.top;
    else if (r.height < 40 && prev) { prev.height = r.top + r.height - prev.top; prev.sealed = true; }
    else merged.push({ ...r });
  }
  while (merged.length > maxBands && merged.length > 1) {
    let idx = 1;
    for (let i = 1; i < merged.length; i++) if (merged[i].height < merged[idx].height) idx = i;
    merged[idx - 1].height += merged[idx].height;
    merged.splice(idx, 1);
  }
  return merged.map((r, i) => ({ index: i, tag: r.cand.tag, label: r.cand.label, background: r.cand.bg, offsetTop: Math.round(r.top), height: Math.round(r.height), textStart: r.cand.textStart || "" }));
}
// Static-HTML fallback bands (no layout): honest estimated source label.
export function cdpBandsFromHtml(html, url) {
  const src = String(html || "");
  const bands = [];
  const re = /<(section|header|footer|nav|main|div|article)[^>]*>/gi;
  let m, i = 0;
  while ((m = re.exec(src)) && bands.length < 40) {
    const tag = m[1].toLowerCase();
    const chunk = src.slice(m.index, m.index + 2000);
    const h = (chunk.match(/<h[1-3][^>]*>([^<]{1,80})/i) || [])[1];
    const bg = (m[0].match(/background(?:-color)?:\s*([^;"']{1,30})/i) || [])[1] || null;
    const hasImg = /<img|<video/i.test(chunk);
    bands.push({ index: i++, tag, label: tag, background: bg, offsetTop: null, height: null, textStart: h ? String(h).trim().slice(0, 60) : "", media: hasImg });
  }
  return { url, title: (src.match(/<title>([^<]{1,120})<\/title>/i) || [])[1] || url, totalHeight: null, bands, source: "static-html", note: "offsets/heights unavailable without layout; use capture/structure via browser for measured bands" };
}

// CDP connection: id-keyed commands over a WebSocket-like transport.
// Messages without an id are domain events (Page.loadEventFired, ...)
// dispatched to onEvent subscribers.
export function createCdpConn(socket) {
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  const route = (raw) => {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : raw.data); } catch { return; }
    if (msg && msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(awardErr("UPSTREAM_ERROR", "CDP " + (msg.error.message || "error")));
      else resolve(msg.result);
    } else if (msg && typeof msg.method === "string" && listeners.has(msg.method)) {
      for (const cb of listeners.get(msg.method)) { try { cb(msg.params || {}); } catch { /* listener never breaks routing */ } }
    }
  };
  // Always install (never guard on a read: setter-only transports report
  // onmessage as undefined on read, which previously left responses unrouted
  // so EVERY command timed out even against a healthy browser).
  try { socket.onmessage = (evt) => route(typeof evt === "string" ? evt : evt.data); } catch { /* send-only test doubles */ }
  return {
    pendingCount: () => pending.size,
    onEvent: (method, cb) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(cb);
      return () => { try { listeners.get(method).delete(cb); } catch { /* ignore */ } };
    },
    command(method, params = {}, timeoutMs = 10000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(awardErr("CAPTURE_TIMEOUT", "CDP " + method + " timed out")); }, timeoutMs);
        pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (e) { clearTimeout(timer); pending.delete(id); reject(e); }
      });
    },
    // Test seam: deliver an inbound message (out-of-order safe).
    deliver(msg) {
      if (msg && msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(awardErr("UPSTREAM_ERROR", "CDP error"));
        else resolve(msg.result);
      } else if (msg && typeof msg.method === "string" && listeners.has(msg.method)) {
        for (const cb of listeners.get(msg.method)) { try { cb(msg.params || {}); } catch { /* ignore */ } }
      }
    },
  };
}

export function findChromeExecutable({ envPath, exists = null, platform = null } = {}) {
  const { fs } = cdpBuiltins();
  const has = exists || ((p) => { try { return fs.existsSync(p); } catch { return false; } });
  const env = globalThis.process && globalThis.process.env ? globalThis.process.env : {};
  const plat = platform || (globalThis.process ? globalThis.process.platform : "linux");
  const candidates = [];
  const configured = envPath || env.AURA_CHROME_PATH;
  if (configured) candidates.push(configured);
  if (plat === "win32") {
    candidates.push("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files\\Chromium\\Application\\chrome.exe");
    const pf = env["PROGRAMFILES"] || "C:\\Program Files";
    candidates.push(pf + "\\Google\\Chrome\\Application\\chrome.exe");
  } else if (plat === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium");
  }
  for (const c of candidates) if (c && has(c)) return c;
  // PATH lookup (which/where) as last resort.
  try {
    const { cp } = cdpBuiltins();
    const cmd = plat === "win32" ? "where chrome" : "which google-chrome chromium chromium-browser chrome";
    const out = cp.spawnSync(plat === "win32" ? "where" : "which", plat === "win32" ? ["chrome"] : ["google-chrome", "chromium", "chromium-browser", "chrome"], { encoding: "utf8", timeout: 5000 });
    const first = String((out && out.stdout) || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && has(first)) return first;
  } catch { /* ignore */ }
  return null;
}
export function findFfmpeg({ envPath } = {}) {
  const env = globalThis.process && globalThis.process.env ? globalThis.process.env : {};
  const configured = envPath || env.AURA_FFMPEG_PATH;
  if (configured) return configured;
  try {
    const { cp } = cdpBuiltins();
    const out = cp.spawnSync(globalThis.process && globalThis.process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8", timeout: 5000 });
    const first = String((out && out.stdout) || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first || null;
  } catch { return null; }
}

export function createBrowserAdapter({ chromePath = null, fetchImpl = null, socketImpl = null, spawnImpl = null, now = () => Date.now() } = {}) {
  const { fs, path, os, cp } = cdpBuiltins();
  const fetchFn = fetchImpl || globalThis.fetch;
  const WS = socketImpl || globalThis.WebSocket;
  const spawn = (spawnImpl && spawnImpl.spawn) || cp.spawn;

  function executable() {
    const { fs: fss } = cdpBuiltins();
    if (chromePath) {
      try { if (fss.existsSync(chromePath)) return chromePath; } catch { /* fall through */ }
      throw cdpUnavailable("configured chrome not found: " + chromePath);
    }
    return findChromeExecutable({});
  }
  async function launchIsolated(port) {
    const exe = executable();
    if (!exe) throw cdpUnavailable("");
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "aura-cdp-"));
    const args = ["--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--user-data-dir=" + profile, "--remote-debugging-port=" + port, "--remote-allow-origins=*", "about:blank"];
    const child = (() => {
      try { return spawn(exe, args, { stdio: "ignore", windowsHide: true, detached: false }); }
      catch (e) { throw cdpUnavailable("launch failed: " + String((e && e.message) || e).slice(0, 160)); }
    })();
    // A bad executable surfaces as an async ENOENT 'error' event, not a
    // throw: record it so the port poll below fails fast with an honest code.
    let spawnErr = null;
    try { child.once("error", (e) => { spawnErr = e; }); } catch { /* ignore */ }
    const cleanup = () => { try { child.kill(); } catch { /* ignore */ } try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } };
    // Wait for /json/version (up to 15s).
    const deadline = Date.now() + 15000;
    let err = null;
    while (Date.now() < deadline) {
      if (spawnErr) { cleanup(); throw cdpUnavailable("launch failed: " + String((spawnErr && spawnErr.message) || spawnErr).slice(0, 160)); }
      try {
        const res = await fetchFn("http://127.0.0.1:" + port + "/json/version", { signal: AbortSignal.timeout(2000) });
        if (res && res.ok) {
          const j = await res.json();
          return { child, profile, cleanup, wsUrl: j.webSocketDebuggerUrl };
        }
      } catch (e) { err = e; }
      await new Promise((r) => setTimeout(r, 300));
      if (child.exitCode !== null && child.exitCode !== undefined) break;
    }
    cleanup();
    throw awardErr("BROWSER_UNAVAILABLE", "Chrome did not open a debug port (" + String((err && err.message) || "launch failed").slice(0, 160) + ")");
  }
  // Attach to a real page target via /json/list (stable across Chrome
  // builds). Target.createTarget over the browser endpoint hangs on several
  // headless=new builds, so it is only a last-resort fallback here.
  async function pageWsUrl(port) {
    const listUrl = "http://127.0.0.1:" + port + "/json/list";
    const read = async () => {
      const res = await fetchFn(listUrl, { signal: AbortSignal.timeout(3000) });
      if (!res || !res.ok) throw new Error("target list HTTP " + (res && res.status));
      return res.json();
    };
    let targets = await read();
    let page = (targets || []).find((t) => t && t.type === "page" && t.webSocketDebuggerUrl);
    if (!page) {
      try { await fetchFn("http://127.0.0.1:" + port + "/json/new?about:blank", { method: "PUT", signal: AbortSignal.timeout(5000) }); } catch { /* fall through to error below */ }
      targets = await read();
      page = (targets || []).find((t) => t && t.type === "page" && t.webSocketDebuggerUrl);
    }
    if (!page) throw new Error("no page target in " + listUrl);
    return page.webSocketDebuggerUrl;
  }
  // Bounded load wait: resolves on Page.loadEventFired, on network-idle
  // (no Page.lifecycleEvent for 2s after load when asked), or on timeout —
  // never hangs the tool call.
  function waitForSettled(conn, send, waitStrategy) {
    return new Promise((resolve) => {
      const cap = setTimeout(resolve, waitStrategy === "networkidle" ? 12000 : 15000);
      let lastActivity = Date.now();
      const idleTimer = waitStrategy === "networkidle" ? setInterval(() => {
        if (Date.now() - lastActivity > 2000) { clearInterval(idleTimer); clearTimeout(cap); resolve(); }
      }, 500) : null;
      const off = conn.onEvent("Page.loadEventFired", () => {
        lastActivity = Date.now();
        if (waitStrategy !== "networkidle") { if (idleTimer) clearInterval(idleTimer); clearTimeout(cap); off(); resolve(); }
      });
      conn.onEvent("Page.lifecycleEvent", () => { lastActivity = Date.now(); });
    });
  }
  async function withPage({ viewport, fn, timeoutMs = CDP_CAPTURE_TIMEOUT_MS, op = "capture" }) {
    const vp = cdpResolveViewport(viewport);
    const port = 19222 + Math.floor(Math.random() * 2000);
    const { child, cleanup } = await launchIsolated(port);
    const stopTimer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } }, timeoutMs + 15000);
    try {
      if (!WS) throw cdpUnavailable("WebSocket unavailable in this Node build.");
      let wsUrl;
      try { wsUrl = await pageWsUrl(port); }
      catch (e) { throw cdpSetupFailed(op, e); }
      const ws = new WS(wsUrl, []);
      try {
        await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error("CDP socket connect timed out")), 10000);
          ws.onopen = () => { clearTimeout(t); resolve(); };
          ws.onerror = () => { clearTimeout(t); reject(new Error("CDP socket error")); };
        });
      } catch (e) { try { ws.close(); } catch { /* ignore */ } throw cdpSetupFailed(op, e); }
      const conn = createCdpConn({ send: (s) => ws.send(s), set onmessage(v) { ws.onmessage = (e) => v(e.data); } });
      const send = (method, params, t) => conn.command(method, params, t);
      try {
        await send("Page.enable", {}, 8000);
        await send("Emulation.setDeviceMetricsOverride", { width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor || 1, mobile: !!vp.isMobile }, 8000);
      } catch (e) { try { ws.close(); } catch { /* ignore */ } throw cdpSetupFailed(op, e); }
      const out = await fn({ send, conn });
      try { ws.close(); } catch { /* ignore */ }
      return out;
    } finally { clearTimeout(stopTimer); cleanup(); }
  }
  return {
    status() {
      let exe = null;
      try { exe = executable(); } catch { exe = null; }
      return { available: !!exe, executable: exe, ffmpeg: findFfmpeg({}), viewports: Object.keys(CDP_VIEWPORTS) };
    },
    async capture(url, { viewport = "desktop", waitStrategy = "load", settleMs = 1500, allowLocal = false, saveDir = null } = {}) {
      const target = awardValidateHttpUrl(url, { allowLocal });
      if (!["load", "networkidle"].includes(waitStrategy)) throw cdpBad("waitStrategy must be load|networkidle");
      const settle = Math.max(0, Math.min(settleMs ?? 1500, CDP_MAX_SETTLE_MS));
      const exe = executable();
      if (!exe) throw cdpUnavailable("");
      const startedAt = new Date(now()).toISOString();
      const shot = await withPage({
        viewport, op: "capture",
        async fn({ send, conn }) {
          const settled = waitForSettled(conn, send, waitStrategy);
          await send("Page.navigate", { url: target }, CDP_NAV_TIMEOUT_MS);
          await settled;
          await new Promise((r) => setTimeout(r, settle));
          // Pre-scroll for lazy sections (bounded).
          try { await send("Runtime.evaluate", { expression: "(async()=>{for(let y=0;y<Math.min(document.documentElement.scrollHeight,10800);y+=450){scrollTo(0,y);await new Promise(r=>setTimeout(r,40));}scrollTo(0,0);await new Promise(r=>setTimeout(r,150));})()", awaitPromise: true }, 8000); } catch { /* best-effort */ }
          const meta = await send("Runtime.evaluate", { expression: "({title:document.title,w:innerWidth,h:innerHeight,total:Math.round(document.documentElement.scrollHeight)})", returnByValue: true }, 8000).catch(() => ({ result: { value: {} } }));
          const snap = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, 15000);
          return { meta: (meta && meta.result && meta.result.value) || {}, png: snap.data };
        },
      });
      const dir = saveDir || path.join(os.tmpdir(), "aura-captures");
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      const name = "capture-" + String(now()) + ".png";
      const file = path.join(dir, name);
      try { fs.writeFileSync(file, Buffer.from(shot.png, "base64")); } catch { /* return inline only */ }
      return { url: target, viewport, viewportPx: cdpResolveViewport(viewport), capturedAt: startedAt, artifactPath: file, bytes: Buffer.from(shot.png, "base64").length, page: shot.meta, limitations: ["lazy-loaded sections below the fold may still be placeholders", "blocked third-party resources are not retried"], source: "live-browser" };
    },
    async structure(url, { viewport = "desktop", allowLocal = false } = {}) {
      const target = awardValidateHttpUrl(url, { allowLocal });
      const exe = executable();
      if (!exe) throw cdpUnavailable("");
      const bands = await withPage({
        viewport, op: "structure",
        async fn({ send, conn }) {
          const settled = waitForSettled(conn, send, "load");
          await send("Page.navigate", { url: target }, CDP_NAV_TIMEOUT_MS);
          await settled;
          const res = await send("Runtime.evaluate", { expression: CDP_SCAN_JS, returnByValue: true }, 10000);
          return (res && res.result && res.result.value) || { title: target, totalHeight: 0, candidates: [] };
        },
      });
      const collapsed = cdpCollapseBands(bands.candidates || [], bands.totalHeight || 0);
      return { url: target, title: bands.title || target, totalHeight: bands.totalHeight || 0, bands: collapsed, viewport, viewportPx: cdpResolveViewport(viewport), source: "live-dom" };
    },
    async motionInspect(url, { viewport = "desktop", allowLocal = false } = {}) {
      const target = awardValidateHttpUrl(url, { allowLocal });
      const exe = executable();
      if (!exe) throw cdpUnavailable("");
      const scan = await withPage({
        viewport, op: "motion",
        async fn({ send, conn }) {
          const settled = waitForSettled(conn, send, "load");
          await send("Page.navigate", { url: target }, CDP_NAV_TIMEOUT_MS);
          await settled;
          await new Promise((r) => setTimeout(r, 1500));
          const res = await send("Runtime.evaluate", { expression: CDP_MOTION_JS, returnByValue: true }, 10000);
          return (res && res.result && res.result.value) || { libs: [], render: [], scrollTrigger: { count: 0 }, tweens: { durations: [], eases: [] }, cssBeziers: [] };
        },
      });
      return reduceCdpScan(target, scan, now(), viewport);
    },
    // Bounded motion record: one session, N screenshots across a scroll tour.
    // Returns frame files + inspect evidence; webm only when ffmpeg exists.
    async recordFrames(url, { frames = 8, viewport = "desktop", allowLocal = false, saveDir = null, durationMs = 12000 } = {}) {
      const target = awardValidateHttpUrl(url, { allowLocal });
      const n = Math.max(2, Math.min(frames || 8, CDP_MAX_FRAMES));
      const budget = Math.max(4000, Math.min(durationMs || 12000, CDP_MAX_RECORD_MS));
      const exe = executable();
      if (!exe) throw cdpUnavailable("");
      const dir = saveDir || fs.mkdtempSync(path.join(os.tmpdir(), "aura-motion-"));
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
      const startedAt = new Date(now()).toISOString();
      const stepMs = Math.floor(budget / (n + 2));
      const out = await withPage({
        viewport, timeoutMs: budget + 30000, op: "motion",
        async fn({ send, conn }) {
          const settled = waitForSettled(conn, send, "load");
          await send("Page.navigate", { url: target }, CDP_NAV_TIMEOUT_MS);
          await settled;
          await new Promise((r) => setTimeout(r, Math.min(4000, stepMs)));
          const files = [];
          for (let i = 0; i < n; i++) {
            try {
              await send("Runtime.evaluate", { expression: "scrollTo(0, Math.round(document.documentElement.scrollHeight * " + (i / Math.max(1, n - 1)) + "))", returnByValue: true }, 5000);
            } catch { /* ignore */ }
            await new Promise((r) => setTimeout(r, Math.min(stepMs, 3000)));
            try {
              const snap = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 }, 10000);
              const file = path.join(dir, "frame-" + String(i).padStart(2, "0") + ".jpg");
              fs.writeFileSync(file, Buffer.from(snap.data, "base64"));
              files.push(file);
            } catch { /* partial capture: keep what we have */ }
          }
          let inspect = null;
          try {
            const res = await send("Runtime.evaluate", { expression: CDP_MOTION_JS, returnByValue: true }, 10000);
            inspect = (res && res.result && res.result.value) || null;
          } catch { inspect = null; }
          return { files, inspect };
        },
      });
      const study = out.inspect ? reduceCdpScan(target, out.inspect, now(), viewport) : null;
      return { url: target, viewport, startedAt, frames: out.files, frameCount: out.files.length, study, dir };
    },
    async encodeWebm(frameFiles, { ffmpegPath = null } = {}) {
      const bin = ffmpegPath || findFfmpeg({});
      if (!bin) return { video: null, available: false, hint: "ffmpeg not found; install ffmpeg or set AURA_FFMPEG_PATH for .webm output" };
      if (!Array.isArray(frameFiles) || !frameFiles.length) throw cdpBad("no frames to encode");
      const dir = path.dirname(frameFiles[0]);
      const video = path.join(dir, "motion.webm");
      const args = ["-y", "-framerate", "2", "-i", path.join(dir, "frame-%02d.jpg"), "-c:v", "libvpx", "-pix_fmt", "yuv420p", video];
      const res = cp.spawnSync(bin, args, { timeout: 60000, windowsHide: true });
      if (res && res.status === 0 && fs.existsSync(video)) return { video, available: true, bytes: fs.statSync(video).size };
      return { video: null, available: false, hint: "ffmpeg encode failed (" + String(res && res.status) + "); frame JPEGs retained" };
    },
  };
}
export function reduceCdpScan(url, scan, t, viewport) {
  const libs = Array.isArray(scan.libs) ? scan.libs : [];
  const render = Array.isArray(scan.render) ? scan.render : [];
  const st = scan.scrollTrigger || { count: 0, scrub: 0, pin: 0, sample: [] };
  const durations = ((scan.tweens && scan.tweens.durations) || []).filter((d) => typeof d === "number");
  const eases = ((scan.tweens && scan.tweens.eases) || []).concat(scan.cssBeziers || []).filter(Boolean);
  const agg = new Map();
  for (const raw of eases) {
    if (raw === "none" || raw === "linear") continue;
    const e = agg.get(raw) || { token: raw, uses: 0 };
    e.uses++;
    agg.set(raw, e);
  }
  const ms = durations.map((d) => d * 1000).sort((a, b) => a - b);
  const q = (p) => { if (!ms.length) return null; const i = p * (ms.length - 1); const lo = Math.floor(i), hi = Math.ceil(i); return Math.round(ms[lo] + (ms[hi] - ms[lo]) * (i - lo)); };
  return {
    url, viewport: viewport || "desktop",
    stack: { libs, render, scrollModel: libs.includes("lenis") ? "lenis" : libs.includes("locomotive") ? "locomotive" : libs.length ? "native" : "unknown" },
    scroll: { triggerCount: st.count || 0, scrubCount: st.scrub || 0, pinCount: st.pin || 0, scrubRatio: st.count ? (st.scrub || 0) / st.count : 0, sample: (st.sample || []).slice(0, 20) },
    easingVocab: [...agg.values()].sort((a, b) => b.uses - a.uses).slice(0, 15),
    durationVocab: ms.length ? { p25: q(0.25), median: q(0.5), p75: q(0.75) } : null,
    capturedAt: t, toolVersion: "aura/1.7.1", source: "live-browser",
  };
}
