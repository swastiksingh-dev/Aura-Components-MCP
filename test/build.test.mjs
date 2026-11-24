// build.test.mjs — the source-to-dist bundle is deterministic and current.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD_ORDER, SERVER_MODULE, assertBundle, bundleFrom, bundleSource, normalizeNewlines } from "../scripts/bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function readSources() {
  const sources = {};
  for (const f of [SERVER_MODULE, ...BUILD_ORDER]) sources[f] = readFileSync(join(root, "src", f), "utf8");
  return sources;
}

test("bundle is byte-identical from LF and CRLF checkouts", () => {
  const sources = readSources();
  const lf = {};
  const crlf = {};
  for (const [name, text] of Object.entries(sources)) {
    lf[name] = normalizeNewlines(text);
    crlf[name] = lf[name].replace(/\n/g, "\r\n");
  }
  assert.equal(bundleFrom(crlf, pkg.version), bundleFrom(lf, pkg.version));
});

test("committed dist matches a fresh bundle from source", () => {
  const fresh = bundleSource({ root, version: pkg.version });
  const committed = readFileSync(join(root, "dist", "server.js"), "utf8");
  assert.equal(committed, fresh, "dist/server.js is stale — run npm run build");
});

test("bundle guard rejects leaked ESM and unresolved version stamps", () => {
  assert.throws(() => assertBundle("import x from 'y';\n"), /ESM statement leaked/);
  assert.throws(() => assertBundle("export function x() {}\n"), /ESM statement leaked/);
  assert.throws(() => assertBundle("const v = '__PKG_VERSION__';\n"), /unresolved version/);
  assert.equal(assertBundle("const ok = 1;\n"), "const ok = 1;\n");
});

test("build manifest names every src module exactly once", () => {
  const names = [SERVER_MODULE, ...BUILD_ORDER];
  assert.equal(new Set(names).size, names.length, "duplicate module in manifest");
  for (const f of names) assert.ok(readFileSync(join(root, "src", f), "utf8").length > 0, "empty module: " + f);
});
