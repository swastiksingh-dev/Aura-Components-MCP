// packaging.test.mjs — generated bundle matches source; CLI entry boots.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = readFileSync(join(root, "dist", "server.js"), "utf8");

test("dist bundle is require-compatible plain script (no ESM import/export)", () => {
  const bad = dist.split("\n").filter((l) => /^import\s/.test(l) || /^export\s+(function|const|class|async function)/.test(l));
  assert.deepEqual(bad, [], "ESM statements would break require() on Node 18");
});

test("dist bundle tracks current source (no stale generated output)", () => {
  for (const marker of ["aura_version", "combineScaffold", "assertFreeRow", "min_views_filtered_out"]) {
    assert.ok(dist.includes(marker), "dist missing current source marker: " + marker);
  }
});

test("dist/cli.cjs boots and answers initialize over stdio", async () => {
  const child = spawn(process.execPath, [join(root, "dist", "cli.cjs"), "--quiet"], { stdio: ["pipe", "pipe", "pipe"] });
  const got = await new Promise((resolve, reject) => {
    let buf = "";
    const kill = (v) => { try { child.kill(); } catch {} resolve(v); };
    const timer = setTimeout(() => kill(new Error("cli handshake timeout")), 15000);
    child.stdout.on("data", (c) => {
      buf += String(c);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.id === 1) { clearTimeout(timer); kill(m); }
        } catch { /* banner never hits stdout; ignore */ }
      }
    });
    child.on("error", (e) => { clearTimeout(timer); kill(e); });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  });
  if (got instanceof Error) throw got;
  assert.equal(got.result.serverInfo.name, "aura-components-mcp");
  assert.match(got.result.serverInfo.version, /^\d+\.\d+\.\d+$/);
});
