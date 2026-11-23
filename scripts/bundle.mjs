// Module: bundle — deterministic source-to-bundle assembly shared by the
// build script and tests. The explicit BUILD_ORDER list is the build manifest:
// add a new src module here (or as SERVER_MODULE) or the build fails loudly.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const BUILD_ORDER = [
  "config.mjs",
  "http.mjs",
  "catalog.mjs",
  "protocol.mjs",
  "guide.mjs",
  "icons.mjs",
  "version.mjs",
  "awards.mjs",
  "awards-index.mjs",
  "browser-cdp.mjs",
  "tools.mjs",
];
export const SERVER_MODULE = "server.mjs";

// Checkout line endings must never change the generated bundle. Normalise to
// LF before any concatenation so Windows CRLF and Linux/macOS LF builds match.
export function normalizeNewlines(src) {
  return String(src).replace(/\r\n?/g, "\n");
}

export function prep(name, src) {
  let s = normalizeNewlines(src).replace(/^#![^\n]*\n/, "");
  s = s.split("\n").filter((l) => !/^import\s/.test(l)).join("\n");
  s = s.replace(/^export\s+(?=function|const|class|async function)/gm, "");
  if (name === "catalog.mjs") {
    s = s.replace(/\bSORTS\b/g, "CATALOG_SORTS");
  }
  if (name === "tools.mjs") {
    s = s.replace(/\bKINDS\b/g, "TOOL_KINDS");
    s = s.replace(/\bSORTS\b/g, "TOOL_SORTS");
    s = s.replace(/\bCATS\b/g, "TOOL_CATS");
    for (const fn of ["bad", "str", "num", "bool", "sort", "cat"]) {
      s = s.replace(new RegExp("\\bfunction " + fn + "\\(", "g"), "function toolFn_" + fn + "(");
      // Method calls (Array.sort, ...) must NOT be renamed: the prefix class
      // excludes "." so only bare helper calls are rewritten. (.sort( was
      // rewritten to .toolFn_sort( and crashed elements search in dist.)
      s = s.replace(new RegExp("([^a-zA-Z_.])" + fn + "\\(", "g"), "$1toolFn_" + fn + "(");
    }
  }
  if (name === "guide.mjs") {
    s = s.replace(/\bconst CDN\b/g, "const GUIDE_CDN");
    s = s.replace(/([^a-zA-Z_])CDN\./g, "$1GUIDE_CDN.");
  }
  // catalog.mjs arrow-const helpers (esc/ilike/trunc) are referenced before
  // rename-proof: only rename the colliding SORTS const + weekAgoIso function.
  // (esc/ilike/trunc have no cross-file collisions, so leave them canonical.)
  if (name === "protocol.mjs") {
    // strip import line via generic filter below; remove ESM-only createRequire block: dist/ gets a static version stamp instead
    s = s.split("\n").filter((l) => !l.includes("createRequire") && !l.includes("PKG_VERSION") && !l.includes("package.json")).join("\n");
    s = "const SERVER_INFO = { name: \"aura-components-mcp\", version: \"__PKG_VERSION__\" };\n" + s.replace(/export const SERVER_INFO = [^;]+;/, "");
    s = s.replace(/version: PKG_VERSION/, "version: \"__PKG_VERSION__\"");
    // keep textResult's canonical name (tools.mjs calls it); only de-collide err
    s = s.replace(/\bfunction textResult\(/g, "function textResult(");
    s = s.replace(/\bconst err\b/g, "const protocolFn_err");
    s = s.replace(/([^a-zA-Z_.])err\(/g, "$1protocolFn_err(");
  }
  // http.mjs sleep() is file-local with no collisions — leave canonical.
  return s;
}

// Fail the build if a src module exists that the manifest does not name, or if
// the manifest names a file that is gone. This prevents a silent "forgot to
// bundle the new module" release.
export function assertManifestComplete(srcDir) {
  const known = new Set([SERVER_MODULE, ...BUILD_ORDER]);
  const onDisk = readdirSync(srcDir).filter((f) => f.endsWith(".mjs"));
  const unlisted = onDisk.filter((f) => !known.has(f));
  const absent = [...known].filter((f) => !onDisk.includes(f));
  if (unlisted.length) throw new Error("bundle: src module(s) not in build manifest: " + unlisted.join(", ") + " — add to BUILD_ORDER or SERVER_MODULE");
  if (absent.length) throw new Error("bundle: build manifest names missing source module(s): " + absent.join(", "));
  return true;
}

export function assertBundle(out) {
  const esm = out.split("\n").filter((l) => /^import\s/.test(l) || /^export\s+(function|const|class|async function)/.test(l));
  if (esm.length) throw new Error("bundle: ESM statement leaked into dist: " + esm[0].slice(0, 100));
  if (out.includes("__PKG_VERSION__")) throw new Error("bundle: unresolved version placeholder");
  return out;
}

// Pure assembly seam: sources is a filename -> text map. Tests use this to
// prove CRLF and LF checkouts produce byte-identical bundles.
export function bundleFrom(sources, version) {
  let out = "#!/usr/bin/env node\n// aura-components-mcp v" + version + " — bundled (zero deps). Built by swastiksingh-dev.\n";
  for (const f of BUILD_ORDER) {
    if (typeof sources[f] !== "string") throw new Error("bundle: missing source module " + f);
    out += "\n// ---- " + f + " ----\n" + prep(f, sources[f]);
  }
  if (typeof sources[SERVER_MODULE] !== "string") throw new Error("bundle: missing source module " + SERVER_MODULE);
  const server = normalizeNewlines(sources[SERVER_MODULE])
    .replace(/^#![^\n]*\n/, "")
    .replace(/^import[^;]+;\s*$/gm, "");
  out += "\n// ---- server.mjs (main) ----\n" + server;
  return assertBundle(out.replace(/__PKG_VERSION__/g, version));
}

export function bundleSource({ root, version }) {
  assertManifestComplete(join(root, "src"));
  const sources = {};
  for (const f of [SERVER_MODULE, ...BUILD_ORDER]) sources[f] = readFileSync(join(root, "src", f), "utf8");
  return bundleFrom(sources, version);
}
