# Session 4 — Motion, responsive design and verification

## Outcome

Move Aura from describing design to checking how an interface behaves in a real browser. Add deliberate motion planning and responsive diagnostics backed by evidence.

## Read first

- `02_PRODUCT_SPEC/MOTION_INTELLIGENCE.md`
- `02_PRODUCT_SPEC/RESPONSIVE_VISUAL_QA.md`
- `02_PRODUCT_SPEC/REA_WORKFLOW.md`
- Current `src/browser-cdp.mjs`, `src/awards.mjs`, `src/awards-index.mjs`, `aura_visual_audit`, and `aura_motion_study` implementation/tests.

## Work sequence

1. Document exactly what current `inspect`, `record` and `search` modes observe and their limitations.
2. Add a motion planning contract (`aura_motion_plan`) that expresses purpose, trigger, target, properties, duration/easing, sequencing, interruption, reduced-motion alternative and responsive fallback.
3. Improve observation of live motion where safely possible: CSS animations/transitions, Web Animations API, and limited GSAP evidence when present. Mark evidence as observed, inferred or unavailable.
4. Add targeted interaction/transition capture where supported. Prefer capturing before, transition and after states for named interactions over only scrolling a page and taking a few frames.
5. Expand responsive audit to a viewport matrix and produce precise defects, with optional screenshots and structural/accessibility evidence.
6. Keep capture and screenshot artifacts on disk with bounded metadata/pointers; do not return enormous base64 image or DOM dumps into model context by default.
7. Prefer `transform` and `opacity` for common animation paths; measure actual browser behaviour and do not assume every effect is compositor-only.
8. Respect `prefers-reduced-motion`, keyboard focus, touch behaviour and WCAG reflow expectations.
9. Add an optional REA-assisted workflow. REA remains a separate MCP server; Aura should not import or require it. The agent uses REA for browser evidence and sends a concise observation summary into Aura planning/audit.
10. Test failure paths: no browser, disconnected target, timeout, oversized page, unavailable animation API, reduced-motion enabled, and narrow viewport.

## Deliverables

- Motion plan schema and examples.
- Honest motion inspection/recording improvements.
- Multi-viewport responsive audit and actionable defect output.
- Bounded screenshot/artifact handling.
- REA workflow documentation and sample evidence-to-contract transformation.
- Browser tests or deterministic fixtures for relevant cases.
- Updated `PROGRESS.md`.

## Acceptance criteria

- Motion output identifies purpose, trigger and target rather than just suggesting animation libraries.
- The system distinguishes directly observed facts from inferred interpretation.
- Missing browser capability is reported clearly and does not break catalogue/design tools.
- Responsive checks identify concrete overflow, clipping, stacking, typography and interaction defects.
- Reduced-motion and keyboard interaction are included in relevant plans/audits.
- Browser evidence is compact by default, and full artifacts are explicitly retrievable.
- REA is optional and no protected site source is copied into Aura.

## Session 4 prompt

> Execute Session 4 only. Inspect the existing CDP/browser implementation and tests before changing it. Upgrade motion planning and evidence-based inspection, responsive viewport audits, and screenshot handling. Keep the browser capability optional and outputs bounded. Document where inference starts and evidence ends. Add failure-path tests and update `PROGRESS.md`. Do not start release branding or publishing.
