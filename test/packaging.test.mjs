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
  for (const marker of ["aura_version", "combineScaffold", "assertFreeRow", "min_views_filtered_out", "aura_award_search", "aura_design_blueprint"]) {
    assert.ok(dist.includes(marker), "dist missing current source marker: " + marker);
  }
});

test("dist renamer never rewrites method calls (.sort stays .sort)", () => {
  // Regression: the tools.mjs helper renamer once rewrote Array.sort( into
  // .toolFn_sort(, hard-crashing aura_award_search{mode:elements} in dist
  // while src tests stayed green. This fails the build output, not src.
  assert.ok(!dist.includes(".toolFn_sort("), "renamed method call leaked into bundle");
  assert.ok(dist.includes("function toolFn_sort("), "bare helper still renamed");
  assert.ok(dist.includes(".sort("), "Array.sort calls survive bundling");
});

test("dist server answers elements search without crashing (bundled 35-tool path)", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-dist-smoke-"));
  const child = spawn(process.execPath, [join(root, "dist", "server.js"), "--quiet"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, AURA_AWARDS_DIR: dir },
  });
  const got = await new Promise((resolve) => {
    let buf = "";
    let id = 0;
    const pending = new Map();
    const kill = (v) => { try { child.kill(); } catch {} resolve(v); };
    const timer = setTimeout(() => kill(new Error("dist elements timeout")), 25000);
    child.stdout.on("data", (c) => {
      buf += String(c);
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line);
          if (m.id !== undefined && pending.has(m.id)) { const r = pending.get(m.id); pending.delete(m.id); r(m); }
        } catch { /* ignore */ }
      }
    });
    child.on("error", (e) => { clearTimeout(timer); kill(e); });
    const call = (method, params) => new Promise((r) => { pending.set(++id, r); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
    (async () => {
      await call("initialize", {});
      const list = await call("tools/list", {});
      const names = (list.result.tools || []).map((t) => t.name);
      if (names.length !== 35) { clearTimeout(timer); kill(new Error("dist exposes " + names.length + " tools, want 35")); return; }
      // Empty index + elements mode returns honest-empty WITHOUT network
      // (gallery backfill needs no fetch) — must be a result, never a crash.
      const el = await call("tools/call", { name: "aura_award_search", arguments: { mode: "elements", query: "hero", limit: 3 } });
      clearTimeout(timer);
      kill(el);
    })().catch((e) => { clearTimeout(timer); kill(e); });
  });
  if (got instanceof Error) throw got;
  assert.ok(!got.error, "elements search crashed in dist: " + JSON.stringify(got).slice(0, 300));
  const body = JSON.parse(got.result.content[0].text);
  assert.equal(body.mode, "elements");
  assert.ok(Array.isArray(body.items));
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
