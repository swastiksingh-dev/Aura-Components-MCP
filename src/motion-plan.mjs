// Module: motion-plan — compact, deterministic motion guidance. This is a
// planning contract, not an observation of a running page.
const clean = (value, max = 240) => typeof value === "string" && value.trim()
  ? value.trim().slice(0, max)
  : undefined;

export function planMotion(input = {}) {
  const purpose = clean(input.purpose);
  const observation = input.observation && typeof input.observation === "object" ? input.observation : {};
  const observedTrigger = clean(observation.trigger, 120);
  const observedTarget = clean(observation.target, 160);
  const trigger = clean(input.trigger, 120);
  const target = clean(input.target, 160);
  const properties = Array.isArray(input.properties)
    ? input.properties.filter((x) => typeof x === "string" && x.trim()).slice(0, 5).map((x) => x.trim().slice(0, 40))
    : [];
  const observedChanges = Array.isArray(observation.changes)
    ? observation.changes.filter((x) => typeof x === "string" && x.trim()).slice(0, 5).map((x) => x.trim().slice(0, 160))
    : [];
  const observedSource = clean(observation.source, 300);
  const observedViewport = clean(observation.viewport, 80);
  const observedLimitations = Array.isArray(observation.limitations)
    ? observation.limitations.filter((x) => typeof x === "string" && x.trim()).slice(0, 5).map((x) => x.trim().slice(0, 200))
    : [];
  const hasObservation = !!(observedTrigger || observedTarget || observedChanges.length);
  const stated = {};
  if (purpose) stated.purpose = purpose;
  if (trigger) stated.trigger = trigger;
  if (target) stated.target = target;
  if (properties.length) stated.properties = properties;
  for (const key of ["interaction", "stack", "constraints"]) {
    const value = clean(input[key], key === "constraints" ? 360 : 120);
    if (value) stated[key] = value;
  }

  const purposeValue = purpose || "Make the state change or relationship clear without delaying input.";
  const triggerValue = trigger || observedTrigger || "The named user action or state change.";
  const targetValue = target || observedTarget || "The smallest element or region that communicates the change.";
  const propertyValues = properties.length ? properties : observedChanges.length ? observedChanges : ["transform", "opacity"];
  const observationRecord = hasObservation ? {
    status: "observed",
    source: observedSource || null,
    viewport: observedViewport || null,
    trigger: observedTrigger || null,
    target: observedTarget || null,
    changes: observedChanges,
    limitations: observedLimitations,
    verification: "Caller-supplied observation summary; Aura did not independently verify it.",
  } : null;
  return {
    contract: "aura-motion-plan/v1",
    evidence: hasObservation
      ? { status: "observed", basis: "An observation summary was supplied by the caller; Aura did not independently verify the capture." }
      : { status: "unavailable", basis: "Planning guidance is derived from the brief; no live page observation was supplied." },
    observation: observationRecord,
    user_stated: stated,
    plan: {
      purpose: { value: purposeValue, status: purpose ? "user_stated" : "recommended" },
      trigger: { value: triggerValue, status: trigger ? "user_stated" : observedTrigger ? "observed" : "recommended" },
      target: { value: targetValue, status: target ? "user_stated" : observedTarget ? "observed" : "recommended" },
      properties: { values: propertyValues, status: properties.length ? "user_stated" : observedChanges.length ? "observed" : "recommended", basis: properties.length ? "Provided by the user." : observedChanges.length ? "Reported by the caller's observation summary." : "Prefer transform/opacity where they express the change; confirm paint/layout cost in the browser." },
      state: { start: "Current visible state.", end: "The resulting state remains readable and operable.", status: "recommended" },
      timing: { duration_ms: { min: 160, max: 240 }, easing: "ease-out", status: "recommended", basis: "A restrained starting point, not a universal timing rule; verify on the actual interaction and device." },
      sequencing: "Animate only the affected region; avoid delaying the next input.",
      interruption: "Cancel or retarget on repeated input; the final state must remain deterministic.",
      reduced_motion: "When prefers-reduced-motion: reduce, remove nonessential travel/continuous motion while preserving state change and feedback.",
      responsive_fallback: "On touch/narrow layouts, provide equivalent immediate state feedback; do not rely on hover or scroll-only discovery.",
      accessibility: ["Keyboard focus receives equivalent feedback to hover.", "Do not move, obscure, or trap focus."],
      performance_risks: ["Layout/paint cost is unknown until measured.", "Do not add will-change globally; profile on a representative device."],
    },
    open_questions: [
      ...(!purpose ? ["What user benefit should this motion communicate?"] : []),
      ...(!trigger && !observedTrigger ? ["What exact action or state change starts it?"] : []),
      ...(!target && !observedTarget ? ["Which element or region should move or change?"] : []),
    ],
    limitations: [
      ...(hasObservation ? ["Caller-supplied observation was not independently verified by Aura."] : ["No browser observation was supplied."]),
      "Duration/easing and performance are recommendations, not measured facts.",
    ],
  };
}
