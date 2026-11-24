import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { TOOL_DEFS } from "../src/tools.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("README publishes the current unique tool names and no moving catalogue totals", () => {
  const readme = read("../README.md");
  const index = readme.slice(readme.indexOf("## Tool index"), readme.indexOf("## Browser and evidence limits"));
  const published = [...new Set(index.match(/`aura_[a-z_]+`/g) || [])].map((x) => x.slice(1, -1)).sort();
  const actual = TOOL_DEFS.map((tool) => tool.name).sort();
  const snapshot = JSON.parse(read("../docs/v2/tool-definitions.json"));
  assert.deepEqual(published, actual);
  assert.deepEqual(snapshot.map((tool) => tool.name).sort(), actual);
  assert.match(readme, new RegExp(`current working tree exposes \\*\\*${actual.length} tools\\*\\*`, "i"));
  assert.doesNotMatch(readme, /\b(?:2,495|30,688|725|192) (?:free )?(?:components|assets|design systems|skills)\b/i);
});

test("release-facing setup claims align with package metadata and browser limits", () => {
  const pkg = JSON.parse(read("../package.json"));
  const readme = read("../README.md");
  const setup = read("../SETUP.md");
  assert.equal(pkg.version, "2.0.0");
  assert.equal(pkg.engines.node, ">=22");
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.ok(pkg.files.includes("docs/v2"));
  assert.match(readme, /not a published v2 release/);
  assert.match(setup, /does not require Chrome, ffmpeg, or REA/);
  assert.match(setup, /aura-components-mcp@2\.0\.0/);
  assert.match(setup, /not yet published/);
  assert.doesNotMatch(setup, /35 `aura_\*` tools|31 `aura_\*` tools/);
});

test("README links only launch assets that exist and describes live checks honestly", () => {
  const readme = read("../README.md");
  const handoff = read("../docs/v2/LAUNCH_HANDOFF.md");
  const pkg = JSON.parse(read("../package.json"));
  const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  for (const ref of images) {
    if (/^https?:/i.test(ref)) continue;
    assert.ok(existsSync(new URL(`../${ref}`, import.meta.url)), `missing README asset: ${ref}`);
    assert.ok(
      pkg.files.some((entry) => ref === entry || ref.startsWith(`${entry}/`)),
      `package files must include README asset: ${ref}`,
    );
  }
  assert.match(readme, /npm run verify.*live network checks/s);
  assert.match(handoff, /not a release announcement/);
  assert.match(handoff, /not produced/);
});
