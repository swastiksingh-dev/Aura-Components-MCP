import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planDesign, researchClaims, researchSources, searchResearch, readResearch } from "../src/design-research.mjs";
import { TOOL_DEFS, createHandlers } from "../src/tools.mjs";

const briefs = JSON.parse(readFileSync(new URL("./fixtures/design-briefs.json", import.meta.url), "utf8"));
const parse = (result) => JSON.parse(result.content[0].text);

test("Design Contract gives all seven briefs specific, structured direction", () => {
  for (const fixture of briefs) {
    const contract = planDesign({ brief: fixture.brief });
    assert.equal(contract.contract_version, "1", fixture.name);
    assert.equal(contract.user_stated.brief, fixture.brief, fixture.name);
    assert.ok(contract.recommendations.layout_composition, fixture.name + " needs composition guidance");
    assert.ok(contract.recommendations.content_hierarchy.value, fixture.name + " needs content hierarchy");
    assert.ok(contract.recommendations.accessibility.value.length >= 4, fixture.name);
    if (fixture.expected_component) assert.ok(contract.retrieval_hints.component_queries.includes(fixture.expected_component), fixture.name);
    assert.ok(contract.open_questions.some((q) => q.field === "audience"), fixture.name + " should leave missing audience unresolved");
    assert.equal(Object.hasOwn(contract.user_stated, "audience"), false, fixture.name + " must not invent an audience");
    assert.equal(Object.hasOwn(contract.user_stated, "brand_notes"), false, fixture.name + " must not invent brand facts");
    assert.ok(contract.recommendations.visual_direction.basis.includes("heuristic"), fixture.name);
  }
});

test("user supplied details stay in facts, while recommendation language stays labeled", () => {
  const contract = planDesign({
    brief: "A portfolio for my work",
    audience: "Hiring engineering managers",
    brand_notes: "Use our supplied navy wordmark and typeface",
    content_outline: ["Selected work", "Contact"],
    constraints: ["No external image hosting"],
  });
  assert.equal(contract.user_stated.audience, "Hiring engineering managers");
  assert.match(contract.user_stated.brand_notes, /navy/);
  assert.deepEqual(contract.user_stated.content_outline, ["Selected work", "Contact"]);
  assert.deepEqual(contract.user_stated.constraints, ["No external image hosting"]);
  assert.equal(contract.recommendations.visual_direction.status, "user_stated");
  assert.equal(contract.recommendations.content_hierarchy.status, "user_stated");
  assert.match(contract.recommendations.visual_direction.basis, /user-stated brand notes/);
  assert.match(contract.recommendations.content_hierarchy.basis, /user-stated content outline/);
  assert.equal(contract.recommendations.audience.status, "unknown");
  assert.equal(contract.open_questions.some((q) => q.field === "content_hierarchy"), false);
});

test("explicit project_type guides recommendations when the brief is underspecified", () => {
  const contract = planDesign({ brief: "Build this page.", project_type: "dashboard" });
  assert.equal(contract.user_stated.project_type, "dashboard");
  assert.ok(contract.recommendations.layout_composition.value.includes("data"));
  assert.ok(contract.retrieval_hints.component_queries.includes("metric summaries"));
});

test("empty goal/content arrays stay unresolved; non-empty goals retain user provenance", () => {
  const empty = planDesign({ brief: "A dashboard.", goals: [], content_outline: [] });
  assert.equal(Object.hasOwn(empty.user_stated, "goals"), false);
  assert.equal(Object.hasOwn(empty.user_stated, "content_outline"), false);
  assert.equal(empty.recommendations.product_purpose.status, "recommended");
  assert.match(empty.recommendations.product_purpose.basis, /heuristic/);
  assert.ok(empty.open_questions.some((question) => question.field === "content_hierarchy"));

  const supplied = planDesign({ brief: "A page.", goals: ["Track pending review tasks"] });
  assert.deepEqual(supplied.user_stated.goals, ["Track pending review tasks"]);
  assert.equal(supplied.recommendations.product_purpose.status, "user_stated");
  assert.match(supplied.recommendations.product_purpose.basis, /user-stated goals/);
});

test("tool schemas and handlers expose compact planning and research tools", async () => {
  const names = TOOL_DEFS.map((tool) => tool.name);
  assert.ok(names.includes("aura_plan_design"));
  assert.ok(names.includes("aura_research_search"));
  assert.ok(names.includes("aura_research_read"));
  const handlers = createHandlers({});
  for (const name of ["aura_plan_design", "aura_research_search", "aura_research_read"]) assert.equal(typeof handlers[name], "function");
  assert.equal(parse(await handlers.aura_plan_design({ brief: "A dashboard for reviewing service status." })).contract_version, "1");
  await assert.rejects(handlers.aura_plan_design({ brief: " " }), (error) => error.code === "BAD_ARGS");
  await assert.rejects(handlers.aura_research_search({ query: "motion", limit: 6 }), (error) => error.code === "BAD_ARGS");
});

test("research claims have a stored source record and complete provenance", () => {
  const sources = new Map(researchSources().map((source) => [source.id, source]));
  const claims = researchClaims();
  assert.ok(sources.has("arxiv-2403.03163"));
  assert.ok(sources.has("doi-10.1016-j.ijhcs.2024.103257"));
  for (const claim of claims) {
    assert.ok(sources.has(claim.source_id), claim.id + " citation must resolve");
    const source = sources.get(claim.source_id);
    assert.ok(source.title && source.url && source.source_type && source.license_access, claim.id + " source metadata");
    assert.ok(claim.evidence_type && claim.method && claim.date && claim.section, claim.id + " evidence provenance");
    assert.ok(Array.isArray(claim.limitations) && claim.limitations.length, claim.id + " limitations");
    assert.ok(claim.confidence_basis && claim.practical_implications.length, claim.id + " confidence and implication");
    if (claim.evidence_type === "standard_guidance") assert.equal(claim.population_sample, null);
  }
  const closed = sources.get("doi-10.1016-j.ijhcs.2024.103257");
  assert.match(closed.license_access, /closed access/);
  assert.equal(claims.some((claim) => claim.source_id === closed.id), false, "closed metadata-only record must not yield paper findings");
});

test("research search returns ranked, compact evidence cards with detail pointers", () => {
  const result = searchResearch("responsive reflow accessibility", 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].source.id, "wcag22-reflow");
  assert.match(result.items[0].source.url, /^https:/);
  assert.equal(result.items[0].detail_ref.tool, "aura_research_read");
  assert.ok(result.items[0].limitations.length);
  assert.equal(JSON.stringify(result).includes("pdf"), false);
  const detail = readResearch(result.items[0].id);
  assert.equal(detail.source.id, result.items[0].source.id);
  assert.ok(detail.population_sample === null);
  assert.ok(detail.confidence_basis);
});

test("empty or unavailable research corpus is explicit and does not invent evidence", () => {
  const result = searchResearch("visual layout", 3, { sources: [], claims: [] });
  assert.equal(result.total, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.empty_corpus, true);
  assert.match(result.note, /do not infer research findings/);
  assert.equal(searchResearch("nothing matches").items.length, 0);
  assert.equal(searchResearch("").total, 0);
});

test("research failures are honest and selected detail is bounded", async () => {
  const handlers = createHandlers({});
  const result = parse(await handlers.aura_research_search({ query: "animation", limit: 1 }));
  assert.equal(result.items.length, 1);
  assert.ok(result.items[0].finding.length < 500);
  await assert.rejects(handlers.aura_research_read({ id: "unknown-card" }), (error) => error.code === "NOT_FOUND");
  await assert.rejects(handlers.aura_research_search({ query: "  " }), (error) => error.code === "BAD_ARGS");
});
