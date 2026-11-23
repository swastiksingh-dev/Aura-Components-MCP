# Session 4 — Motion and responsive evidence

## Motion planning

`aura_motion_plan` is pure local planning. Supplied purpose, trigger, target,
properties, interaction, stack and constraints are returned as `user_stated`.
Defaults are recommendations, not observed facts. The contract includes state,
timing rationale, sequencing, interruption, reduced-motion behavior, responsive
fallback, keyboard-focus parity and performance risks. Timing is a starting
point, not a universal optimum.

Example:

```json
{
  "trigger": "Select a filter chip",
  "target": "Selected chip and results count",
  "purpose": "Confirm the active filter without delaying results"
}
```

Without an observation summary, the planner's `evidence.status` is
`unavailable`: it plans from the brief and does not claim browser observation.
An optional caller-supplied `observation` can carry `source`, `viewport`,
`trigger`, `target`, `changes` and `limitations`. Those values stay under
`observation` and receive `observed` labels, while the output explicitly says
Aura did not independently verify the capture.

## What browser modes observe

- `aura_motion_study {mode:"inspect"}` navigates to the URL, waits for page load
  and a short settle, and samples global library/render hints, ScrollTrigger
  counts/samples, bounded GSAP duration/easing summaries, computed CSS
  animation/transition declarations, up to 12 Web Animations API records, and
  the current reduced-motion preference. CSS/WAAPI rows are observed at one
  instant; the WAAPI API's unavailability is returned distinctly from an empty
  sample list. A present GSAP global is only inferred evidence of runtime presence;
  it does not expose a complete timeline. No trigger is invoked. The response
  explicitly marks named interaction capture unavailable.
- `mode:"record"` scrolls through the page and saves at most 16 JPEG frames
  during a 4–30 second bounded session. It may encode a WebM if optional ffmpeg
  is available. This is a scroll tour, not a controlled hover/click/focus
  transition; frames and video are returned as local paths, never base64.
- `mode:"search"` queries the local recorded-motion index; an empty corpus is
  distinct from a zero-match search.
- `aura_visual_audit {mode:"capture"}` stores a PNG and returns its path only
  when the file was written. `structure` reports live DOM bands or explicitly
  labeled static estimates. `compare` compares band count/order, coarse
  background tokens and page-height ratio; it is not pixel/perceptual or
  interaction parity.

Missing Chrome remains a clear `BROWSER_UNAVAILABLE` for operations that
require it. Static structure fallback has no measured offsets. Browser tools
are optional and do not affect normal catalogue/design operations.

## Responsive matrix

`aura_visual_audit {mode:"responsive", url, viewports?}` defaults to
`[320,360,390,768,1024,1280,1440]`; callers may pass 1–7 unique integer widths
from 320 to 1920. Each live width measures document scroll width, a capped set
of off-screen element bounds, document height, a focusable-element count and
the current `prefers-reduced-motion` value. Measured horizontal overflow
produces viewport-specific findings with evidence and a suggested correction.
The browser adapter reuses one page and resizes it across the matrix. It emits
at most three findings per viewport; `findingCount`, `findingsTruncated`,
`omittedFindingCount` and `truncatedViewports` disclose capped candidates.
Off-screen element bounds are candidates, not proven causes of document
overflow, because intentional fixed controls and nested scrollers can extend
beyond the viewport. Each measurement follows load and a short 100ms layout
settle; late fonts, images or asynchronous content may still shift the page.
The CDP commands have per-operation timeouts, and Chrome is forcibly killed
after its bounded process window (up to roughly 75 seconds including startup);
this is not a strict response deadline if socket/command cancellation stalls.

This is geometry evidence, not a full accessibility audit: focusability count
does not verify keyboard order or visible focus; reduced-motion preference
detection does not verify every animation obeys it. Static HTML fallbacks do
not claim geometry and emit no inferred defects. No screenshot is captured by
default; use `mode:"capture"` for a chosen viewport and its saved artifact.

## Targeted interaction and REA

Aura's current `record` mode does not invoke arbitrary page actions. For a
named interaction, use REA as a separate, optional MCP server on an authorized
page: inspect a bounded browser target, capture baseline/action/settled states
declaratively, then pass Aura a concise summary with trigger, target, observed
state changes, viewport, source/artifact references and limitations. Event
listener inspection alone does not invoke the interaction; execution tracing
can perturb timing. See the
[REA workflow](https://github.com/webdebug/reverse-engineering-mcp/blob/main/docs/browser-scenario-contract.md).
Aura does not import, install, or require REA.

Example handoff: an authorized REA capture reports a click on a disclosure
button and a panel height change at 390×844. Pass the summary, not page scripts:

```json
{
  "purpose": "Confirm that the disclosure opened",
  "observation": {
    "source": "https://example.com/help",
    "viewport": "390x844",
    "trigger": "Click the disclosure button",
    "target": "Help details panel",
    "changes": ["height changed from 0px to 240px"],
    "limitations": ["Single captured run; not independently verified by Aura."]
  }
}
```

Do not copy protected source, scripts, or assets from a reference.
