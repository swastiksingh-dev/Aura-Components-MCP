// Build: concatenate src/*.mjs into a single zero-dependency dist/server.js.
// Strips import lines and export keywords; renames per-file colliding identifiers.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function prep(name, src) {
  let s = src.replace(/^#!.*\n/, "");
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
      s = s.replace(new RegExp("([^a-zA-Z_])" + fn + "\\(", "g"), "$1toolFn_" + fn + "(");
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
    s = s.replace(/([^a-zA-Z_])err\(/g, "$1protocolFn_err(");
  }
  // http.mjs sleep() is file-local with no collisions — leave canonical.
  return s;
}

const order = ["config.mjs", "http.mjs", "catalog.mjs", "protocol.mjs", "guide.mjs", "tools.mjs"];
const pkgVer = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
let out = "#!/usr/bin/env node\n// aura-components-mcp v" + pkgVer + " — bundled (zero deps). Built by swastiksingh-dev.\n";
for (const f of order) out += "\n// ---- " + f + " ----\n" + prep(f, readFileSync(join(root, "src", f), "utf8"));
const server = readFileSync(join(root, "src", "server.mjs"), "utf8")
  .replace(/^#!.*\n/, "")
  .replace(/^import[^;]+;\s*$/gm, "");
out += "\n// ---- server.mjs (main) ----\n" + server;
mkdirSync(join(root, "dist"), { recursive: true });
out = out.replace(/__PKG_VERSION__/g, pkgVer);
writeFileSync(join(root, "dist", "server.js"), out);
writeFileSync(join(root, "dist", "cli.cjs"), "#!/usr/bin/env node\nrequire('./server.js');\n");
console.log("built dist/server.js (" + out.length + " chars) + dist/cli.cjs");
