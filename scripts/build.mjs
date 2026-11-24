// Build: assemble src/*.mjs into a single zero-dependency dist/server.js.
// Assembly, line-ending normalisation, manifest checks and guardrails live in
// scripts/bundle.mjs so tests can prove the output is reproducible.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleSource } from "./bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgVer = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const out = bundleSource({ root, version: pkgVer });
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "server.js"), out);
writeFileSync(join(root, "dist", "cli.cjs"), "#!/usr/bin/env node\nrequire('./server.js');\n");
console.log("built dist/server.js (" + out.length + " chars) + dist/cli.cjs");
