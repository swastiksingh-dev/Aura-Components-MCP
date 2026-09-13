#!/usr/bin/env node
// Module: server — composition root. Wires config -> fetcher -> catalog ->
// tools -> protocol session over stdio. Only framing + wiring lives here.

import { loadConfig } from "./config.mjs";
import { createFetcher } from "./http.mjs";
import { createCatalog } from "./catalog.mjs";
import { createSession, SERVER_INFO } from "./protocol.mjs";
import { TOOL_DEFS, createHandlers } from "./tools.mjs";

const config = loadConfig();
const fetcher = createFetcher({ fetchImpl: globalThis.fetch, timeoutMs: config.timeoutMs, retries: config.retries, userAgent: config.userAgent });
const catalog = createCatalog({ fetcher, config });
const handlers = createHandlers(catalog);

let buffer = "";
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const { dispatch } = createSession(send, { tools: TOOL_DEFS, handlers });

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    dispatch(msg);
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();

// Startup cinematics live on stderr only: stdout is reserved for JSON-RPC.
// Sequence: aura moment -> catalogue credit -> builder credit -> running.
const BANNER = [
  "  <<<  aura-components-mcp  >>>",
  "  free Aura catalogue, every AI agent",
];
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
const paint = (s) => process.stderr.write(s + "\n");
async function typeLine(text, cps = 90) {
  for (const ch of text) { process.stderr.write(ch); await sleepMs(1000 / cps); }
  process.stderr.write("\n");
}
async function dots(label, n = 3) {
  process.stderr.write(label);
  for (let i = 0; i < n; i++) { await sleepMs(160); process.stderr.write("."); }
  process.stderr.write("\n");
}
async function boot() {
  if (process.env.AURA_QUIET === "1" || process.argv.includes("--quiet")) {
    paint(SERVER_INFO.name + " v" + SERVER_INFO.version + " listening on stdio");
    return;
  }
  for (const l of BANNER) paint(l);
  await typeLine("starting your aura for designing...");
  await dots("warming catalogue cache");
  paint("catalogue credit: Aura (aura.build) — components, skills, assets, systems");
  await sleepMs(180);
  paint("built by swastiksingh-dev — free to use, MIT, no paywall");
  await sleepMs(180);
  paint(SERVER_INFO.name + " v" + SERVER_INFO.version + " running — 15 tools on stdio");
}
boot();
