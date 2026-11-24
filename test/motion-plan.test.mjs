import test from "node:test";
import assert from "node:assert/strict";
import { planMotion } from "../src/motion-plan.mjs";

test("motion plan separates supplied facts from guidance and preserves accessibility fallbacks", () => {
  const result = planMotion({
    purpose: "Show that a filter was applied",
    trigger: "Select a filter chip",
    target: "Results count and selected chip",
    properties: ["opacity"],
    constraints: "Do not delay searching",
  });
  assert.equal(result.contract, "aura-motion-plan/v1");
  assert.equal(result.evidence.status, "unavailable");
  assert.deepEqual(result.user_stated, {
    purpose: "Show that a filter was applied",
    trigger: "Select a filter chip",
    target: "Results count and selected chip",
    properties: ["opacity"],
    constraints: "Do not delay searching",
  });
  assert.equal(result.plan.purpose.status, "user_stated");
  assert.equal(result.plan.properties.status, "user_stated");
  assert.match(result.plan.reduced_motion, /prefers-reduced-motion/);
  assert.match(result.plan.responsive_fallback, /hover/);
  assert.ok(result.plan.accessibility.some((x) => /Keyboard/.test(x)));
  assert.deepEqual(result.open_questions, []);
  assert.ok(result.limitations.some((x) => /not measured/.test(x)));
});

test("underspecified motion plan labels defaults as recommendations and asks for missing intent", () => {
  const result = planMotion({});
  assert.equal(result.plan.purpose.status, "recommended");
  assert.equal(result.plan.trigger.status, "recommended");
  assert.equal(result.plan.target.status, "recommended");
  assert.deepEqual(result.plan.properties.values, ["transform", "opacity"]);
  assert.equal(result.open_questions.length, 3);
  assert.ok(result.plan.performance_risks.some((x) => /unknown/.test(x)));
});

test("motion plan bounds and filters direct helper inputs", () => {
  const result = planMotion({
    purpose: "x".repeat(400),
    properties: [" opacity ", "", 7, "transform", "color", "filter", "clip-path"],
  });
  assert.equal(result.user_stated.purpose.length, 240);
  assert.deepEqual(result.user_stated.properties, ["opacity", "transform", "color", "filter", "clip-path"]);
});

test("caller-supplied browser summary stays observed-attributed rather than user-authored", () => {
  const result = planMotion({
    purpose: "Explain that the panel expanded",
    observation: {
      source: "https://example.com",
      viewport: "390x844",
      trigger: "Activate the disclosure button",
      target: "details panel",
      changes: ["height 0px to 240px", "opacity 0 to 1"],
      limitations: ["capture summary supplied by caller"],
    },
  });
  assert.equal(result.evidence.status, "observed");
  assert.match(result.evidence.basis, /did not independently verify/);
  assert.equal(result.plan.trigger.status, "observed");
  assert.equal(result.plan.target.status, "observed");
  assert.equal(result.plan.properties.status, "observed");
  assert.equal(Object.hasOwn(result.user_stated, "trigger"), false);
  assert.equal(result.observation.source, "https://example.com");
});
