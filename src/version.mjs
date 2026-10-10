// Module: version — running vs npm-published version check. One small
// interface (getVersion) over a registry fetch with a long cache. Never
// throws: offline or unpublished registries return latest:null and a note.

const VERSION_TTL_MS = 60 * 60 * 1000; // re-check npm at most hourly
const VERSION_URL = "https://registry.npmjs.org/aura-components-mcp/latest";
const VERSION_INSTALL = "npm i -g aura-components-mcp@latest (or npx -y aura-components-mcp@latest), then restart the MCP client";

export function createVersion({ fetcher, running, now = () => Date.now() }) {
  if (!fetcher || typeof fetcher.getText !== "function") throw new Error("fetcher.getText is required");
  const run = typeof running === "string" && running ? running : "0.0.0-dev";
  let cached = null;

  function cmp(a, b) {
    const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
    }
    return 0;
  }

  async function getVersion() {
    if (cached && now() - cached.t < VERSION_TTL_MS) return { ...cached.v, cached: true };
    let latest = null;
    try {
      const body = await fetcher.getText(VERSION_URL, { accept: "application/json" });
      const j = body ? JSON.parse(body) : null;
      if (j && typeof j.version === "string" && /^\d+\.\d+\.\d+/.test(j.version)) latest = j.version;
    } catch { latest = null; }
    const behind = latest !== null && cmp(run, latest) < 0;
    const v = latest === null
      ? { running: run, latest: null, update_available: false, cached: false, checked_at: new Date(now()).toISOString(), notice: "Could not reach the npm registry — running v" + run + ". Prefer the latest published version when you can check." }
      : behind
        ? { running: run, latest, update_available: true, cached: false, checked_at: new Date(now()).toISOString(), notice: "Update available: running v" + run + ", npm publishes v" + latest + ". Prefer latest — " + VERSION_INSTALL + "." }
        : { running: run, latest, update_available: false, cached: false, checked_at: new Date(now()).toISOString(), notice: "Running v" + run + " — latest published. Prefer latest on every new session." };
    cached = { t: now(), v };
    return { ...v };
  }

  return { getVersion };
}
