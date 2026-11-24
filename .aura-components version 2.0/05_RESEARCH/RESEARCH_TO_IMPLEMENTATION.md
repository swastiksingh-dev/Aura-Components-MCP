# Translating research into implementation

## Why this document exists

A bibliography alone does not improve a product. Research should result in testable engineering decisions while preserving the source's scope and limitations.

## Translation workflow

For each source:

1. State the research question in plain language.
2. Record the method, sample, context, publication status and limitations.
3. Extract no more than a few actionable findings relevant to Aura.
4. Classify each claim: empirical, systematic review, standard, engineering guidance or hypothesis.
5. Convert the finding into an implementation option, not an absolute rule.
6. Add a test/check that can prove whether the option helps in Aura's context.
7. Keep the original DOI/URL and section/page location beside the evidence card.

## Example translations

### Motion fluency

Research indicates timing in interaction phases affects perceived fluency. Implementation:

- measure trigger-to-feedback delay;
- avoid unnecessary waits before acknowledging input;
- distinguish feedback delay from animation completion;
- test with real interactions;
- avoid prescribing one duration for every component.

### Content-aware animation

Visually grounded animation work suggests tying movement to the role and geometry of interface elements. Implementation:

- define trigger, target and purpose;
- derive direction and distance from the UI relationship;
- preserve hierarchy and readability;
- capture before/transition/after states;
- critique the final motion rather than applying a global preset.

### Constraint-led design generation

Recent landing-page research suggests structured component and design constraints may improve outputs in its experimental setting. Implementation:

- make Design Contract fields explicit;
- specify section hierarchy and required content;
- define visual identity and anti-patterns;
- test multiple runs and page types;
- keep limitations visible and avoid overstating generality.

### Responsive and accessibility standards

Implementation:

- run viewport checks at narrow widths;
- check horizontal overflow and content reachability;
- honour reduced-motion preference;
- include keyboard focus and non-hover equivalents;
- use container queries when component width, rather than viewport width, is the relevant constraint.

## Research quality gate

Do not merge a research-derived rule unless:

- its source and version are clear;
- the claim accurately reflects the source;
- limitations are recorded;
- implementation trade-offs are understood;
- at least one test or validation idea is defined.
