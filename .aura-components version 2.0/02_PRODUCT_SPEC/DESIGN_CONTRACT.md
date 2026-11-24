# Design Intelligence — Design Contract

## Purpose

A design contract turns a broad request into compact, explicit decisions an implementation model can follow. It should reduce generic page output by making the desired visual character, composition, hierarchy and interaction concrete before code generation.

## Recommended tool

`aura_plan_design`

Inputs should be brief, bounded and explicit. Possible fields:

- `brief` (required string);
- optional project type, audience, goals, brand notes, content outline, preferred stack, available references, constraints and theme;
- optional `detail_level` with compact default.

Do not require a long questionnaire if the brief is sufficient. Return `assumptions` and `open_questions` rather than inventing missing brand details.

## Design Contract shape

```json
{
  "contract_version": "1",
  "project": {"type": "portfolio", "audience": [], "primary_goal": "..."},
  "visual_identity": {
    "direction": "editorial, precise, human",
    "personality": ["confident", "considered"],
    "avoid": ["generic SaaS hero", "decoration without purpose"]
  },
  "composition": {
    "hero_strategy": "...",
    "sections": [],
    "hierarchy": "...",
    "density": "..."
  },
  "type_and_colour": {"type_roles": [], "palette_strategy": "...", "tokens": []},
  "components": {"needed_patterns": [], "selection_criteria": []},
  "interaction": {"key_states": [], "feedback_principles": []},
  "motion": {"signature_moment": "...", "principles": [], "reduced_motion": "..."},
  "responsive": {"small_screen_recomposition": "...", "breakpoint_strategy": "..."},
  "accessibility": [],
  "constraints": [],
  "assumptions": [],
  "open_questions": [],
  "evidence_refs": []
}
```

## Required behaviour

- Distinguish known user requirements from recommendations and assumptions.
- Prefer specific composition decisions over piles of style adjectives.
- Explain why each major decision supports the product and audience.
- Provide only relevant component categories for the next retrieval step.
- Avoid generic default sections unless they serve the content.
- Make mobile a deliberate composition, not desktop scaled smaller.
- Describe one or two meaningful interaction/motion moments, not motion on every element.
- Include accessibility and reduced-motion requirements from the beginning.
- Include anti-patterns to avoid when they are grounded in the brief.
- Keep the contract concise enough to fit alongside code and component evidence.

## Design-to-implementation flow

1. Call `aura_plan_design`.
2. Search for a small number of suitable design systems and components.
3. Use `aura_diff` to compare viable candidates.
4. Retrieve only chosen component details.
5. Build tokens and page structure in the order required by the selected system.
6. Implement and inspect in a browser.
7. Run responsive, accessibility and motion checks against the contract.
8. Revise defects; do not regenerate the entire page for every local issue.

## Quality check

The contract should answer:

- Who is this for?
- What should the user understand or do first?
- What is visually distinctive about this experience?
- How does the page establish hierarchy?
- What content must be present?
- What is the signature interaction or moment?
- What changes on mobile?
- What must remain accessible?
- What should the implementation deliberately avoid?
