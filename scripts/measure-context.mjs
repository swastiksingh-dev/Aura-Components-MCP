// Capture bounded representative MCP result and tool-definition byte counts.
// Live catalogue/Awwwards availability affects result sizes; token counts are
// intentionally not estimated without a supported target tokenizer.
import { writeFileSync } from "node:fs";
import { loadConfig } from "../src/config.mjs";
import { createFetcher } from "../src/http.mjs";
import { createCatalog } from "../src/catalog.mjs";
import { facets } from "../src/guide.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";
import { createIcons } from "../src/icons.mjs";
import { createVersion } from "../src/version.mjs";
import { createAwardClient } from "../src/awards.mjs";
import { createBrowserAdapter } from "../src/browser-cdp.mjs";

const config = loadConfig();
const fetcher = createFetcher({
  fetchImpl: fetch,
  timeoutMs: config.timeoutMs,
  retries: config.retries,
  userAgent: config.userAgent,
});
const catalog = createCatalog({ fetcher, config, facetsFn: facets });
const handlers = createHandlers(
  catalog,
  createIcons({ fetcher }),
  createVersion({ fetcher, running: "1.7.3" }),
  { awardClient: createAwardClient({ fetchImpl: fetch }), browser: createBrowserAdapter({}) },
);

const representative = {};
async function measure(key, name, args) {
  try {
    const result = await handlers[name](args);
    const text = result.content?.[0]?.text || JSON.stringify(result);
    representative[key] = {
      tool: name,
      bytes: Buffer.byteLength(text),
      chars: text.length,
      compact_json_bytes: Buffer.byteLength(JSON.stringify(JSON.parse(text))),
    };
  } catch (error) {
    representative[key] = { tool: name, error: error.code || error.message };
  }
}

await measure("search_small", "aura_search_components", { query: "dark pricing", limit: 3 });
await measure("search_normal", "aura_search_components", { query: "hero", limit: 10 });
await measure("search_worst", "aura_search_components", { limit: 50, slim: false });
const search = await catalog.searchCatalog("components", { query: "hero", limit: 10 });
const ids = search.items.map((item) => item.id).filter((id) => id !== undefined).slice(0, 8);
if (ids.length) {
  await measure("detail", "aura_get_component", { id: ids[0] });
  await measure("bundle", "aura_bundle", { ids });
  await measure("scaffold", "aura_scaffold_page", { goal: "portfolio landing page", components: ids.slice(0, 4) });
}
await measure("awards", "aura_award_search", { mode: "sites", query: "studio", limit: 5 });
await measure("browser_evidence", "aura_visual_audit", { mode: "structure", url: "https://example.com" });

const tools = TOOL_DEFS.map((tool) => ({ name: tool.name, bytes: Buffer.byteLength(JSON.stringify(tool)) }));
const output = {
  recorded_at: new Date().toISOString(),
  runtime: process.version,
  measurements: {
    tool_list_bytes: Buffer.byteLength(JSON.stringify(TOOL_DEFS)),
    tool_count: TOOL_DEFS.length,
    tools,
  },
  representative,
  tokenizer: "unknown; no target tokenizer measured",
};
const outPath = process.argv[2] || "./docs/v2/2026-11-23-session2-after.json";
writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ output: outPath, ...output.measurements, representative }, null, 2));
