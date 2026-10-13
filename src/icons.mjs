// Module: icons — live icon fetch (Font Awesome Free + HackerNoon pixel
// library) over jsDelivr. One interface: getIcon({name, source, style}).
// URLs verified live 2026-10-10; licenses verified against the repos'
// own license pages (FA Free: CC BY 4.0 icons; pixel .svg/.png: CC BY 4.0).

const ICON_TTL_MS = 24 * 60 * 60 * 1000; // icons are static — remember 24h
const ICON_MAX_KEYS = 500;
const ICON_MAX_BYTES = 50 * 1024;
const ICON_FA_BASE = "https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6/svgs";
const ICON_FA_CSS = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css";
const ICON_PX_BASE = "https://cdn.jsdelivr.net/gh/hackernoon/pixel-icon-library@main/icons/SVG";
const ICON_PX_CSS = "https://cdn.jsdelivr.net/npm/@hackernoon/pixel-icon-library@latest/fonts/iconfont.css";
const ICON_FA_STYLES = ["solid", "regular", "brands"];
const ICON_SOURCES = ["auto", "fontawesome", "pixel"];
const ICON_STYLES = ["auto", "solid", "regular", "brands"];

function iconBad(msg) { const e = new Error(msg); e.code = "BAD_ARGS"; throw e; }
function iconMissing(msg) { const e = new Error(msg); e.code = "NOT_FOUND"; throw e; }

export const ICON_CREDITS = {
  fontawesome: {
    license: "CC BY 4.0 (icons) — https://fontawesome.com/license/free",
    credit: "Icon by Font Awesome Free (CC BY 4.0) — https://fontawesome.com",
  },
  pixel: {
    license: "CC BY 4.0 — https://github.com/hackernoon/pixel-icon-library#license-free--starter--pro",
    credit: "Icon by HackerNoon Pixel Icon Library (CC BY 4.0) — https://pixeliconlibrary.com (give credit + link, note changes)",
  },
};

export function iconCredit(source) {
  const c = ICON_CREDITS[source];
  if (!c) iconBad("source must be fontawesome|pixel");
  return { ...c };
}

// Candidate URLs in fallback order. Pixel solid variants use a -solid suffix
// (see iconfont.css hn-*-solid classes); FA uses per-style directories.
function iconCandidates(name, source, style) {
  const out = [];
  const faStyles = style === "auto" ? ICON_FA_STYLES : [style];
  const pxCats = style === "auto" ? ["regular", "solid", "brands"] : [style];
  if (source === "auto" || source === "fontawesome") {
    for (const s of faStyles) out.push({ source: "fontawesome", style: s, url: ICON_FA_BASE + "/" + s + "/" + name + ".svg" });
  }
  if (source === "auto" || source === "pixel") {
    for (const c of pxCats) {
      out.push({ source: "pixel", style: c, url: ICON_PX_BASE + "/" + c + "/" + name + ".svg" });
      out.push({ source: "pixel", style: c, url: ICON_PX_BASE + "/" + c + "/" + name + "-solid.svg" });
    }
  }
  return out;
}

export function createIcons({ fetcher, now = () => Date.now() }) {
  if (!fetcher || typeof fetcher.getText !== "function") throw new Error("fetcher.getText is required");
  const cache = new Map();

  async function getIcon(q = {}) {
    const raw = typeof q.name === "string" ? q.name.trim().toLowerCase() : "";
    if (!raw) iconBad("name (string) is required — e.g. {name:'bolt'}");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) iconBad("name must be kebab-case like 'bolt' or 'arrow-down'");
    const source = q.source === undefined ? "auto" : q.source;
    const style = q.style === undefined ? "auto" : q.style;
    if (!ICON_SOURCES.includes(source)) iconBad("source must be one of " + ICON_SOURCES.join("|"));
    if (!ICON_STYLES.includes(style)) iconBad("style must be one of " + ICON_STYLES.join("|"));

    const key = [source, style, raw].join("|");
    const hit = cache.get(key);
    if (hit && now() - hit.t < ICON_TTL_MS) return { ...hit.v, cached: true };
    if (hit) cache.delete(key);

    const tried = [];
    let lastFetchErr = null;
    for (const c of iconCandidates(raw, source, style)) {
      let body = null;
      try {
        body = await fetcher.getText(c.url, {});
      } catch (e) {
        // Network-level failure is not a miss: remember it, keep walking the
        // chain in case only one host is down, and rethrow at the end if
        // nothing else explains the failure (never disguise an outage as
        // "not found").
        lastFetchErr = e instanceof Error ? e : new Error(String(e));
        tried.push({ url: c.url, ok: false, why: "fetch-error" });
        continue;
      }
      if (body === null || body === undefined) { tried.push({ url: c.url, ok: false, why: "404" }); continue; }
      const text = String(body).replace(/^\s*<\?xml[^?]*\?>\s*/, "");
      if (!text.trim().startsWith("<svg")) { tried.push({ url: c.url, ok: false, why: "not-svg" }); continue; }
      if (text.length > ICON_MAX_BYTES) { tried.push({ url: c.url, ok: false, why: "oversize" }); continue; }
      const lic = ICON_CREDITS[c.source];
      const out = {
        name: raw, source: c.source, style: c.style, svg: text, bytes: text.length,
        source_url: c.url, license: lic.license, credit: lic.credit,
        alt: c.source === "pixel"
          ? { iconfont_css: ICON_PX_CSS, class: "hn hn-" + raw, use: '<link rel="stylesheet" href="' + ICON_PX_CSS + '"> + <i class="hn hn-' + raw + '"></i>' }
          : { css: ICON_FA_CSS, class: "fa-" + c.style + " fa-" + raw, use: '<link rel="stylesheet" href="' + ICON_FA_CSS + '"> + <i class="fa-' + c.style + " fa-" + raw + '"></i>' },
        tried: tried.map((t) => t.url),
        cached: false,
      };
      cache.set(key, { t: now(), v: out });
      while (cache.size > ICON_MAX_KEYS) cache.delete(cache.keys().next().value);
      return out;
    }
    if (lastFetchErr && tried.every((t) => t.why === "fetch-error")) throw lastFetchErr;
    iconMissing("icon not found: '" + raw + "' (" + source + "/" + style + ") — checked " + tried.length + " URLs; check spelling (FA names use dashes, e.g. 'arrow-down')");
  }

  return { getIcon };
}
