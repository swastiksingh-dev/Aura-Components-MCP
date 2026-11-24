# Responsive design and Visual QA

## Responsive viewport matrix

Use a configurable viewport set. Suggested default widths:

| Width | Purpose |
|---:|---|
| 320px | narrow mobile / reflow stress |
| 360px | compact mobile |
| 390px | common modern mobile |
| 768px | tablet portrait |
| 1024px | tablet landscape / compact desktop |
| 1280px | desktop |
| 1440px | wide desktop |

Test additional device heights and orientation when the page uses sticky or viewport-height layouts.

## What to check

- horizontal overflow and clipped content;
- missing or inaccessible navigation state;
- hero content order and hierarchy;
- heading and paragraph wrapping;
- grid/card stacking and minimum widths;
- images, video and aspect-ratio/cropping;
- tables and dense content reflow;
- sticky headers, drawers, modals and viewport-height units;
- touch target spacing and interaction alternatives;
- focus visibility, keyboard order and semantic structure;
- content that disappears or becomes unreachable;
- contrast and text resizing where testable.

## Defect-oriented results

Use a stable report with:

- severity (`critical`, `high`, `medium`, `low`, `info`);
- viewport and affected element/region;
- observed evidence;
- user impact;
- suggested correction;
- confidence and whether directly measured;
- screenshot/artifact reference when available.

Example:

```text
[HIGH] 320px — hero title overflows its container.
Evidence: measured scroll width exceeds viewport width.
Impact: first-screen content is clipped.
Suggested fix: constrain max-width and adjust fluid type scale.
```

## Visual comparison

The current visual audit has been described as structural/coarse in the earlier review. Do not imply a DOM comparison is a full perceptual screenshot comparison. Use distinct checks:

1. DOM/geometry: region order, boxes, overflow, dimensions, text sizes.
2. Accessibility structure: landmarks, roles, names, focusability.
3. Screenshot comparison: pixel/image similarity where a valid baseline exists.
4. Human/vision review: composition, visual hierarchy, originality, balance and polish.

A pixel diff alone does not understand design quality. A model critique alone is not objective proof. Combine evidence and disclose limitations.

## Browser operation

Keep the browser adapter optional and bounded. Enforce navigation allowlists/URL safety, timeouts, body/capture limits, resource cleanup, and a no-browser fallback. Do not expose arbitrary CDP or execute arbitrary site scripts merely to audit a page.

## Acceptance

A report should tell the agent what is broken, where, at what viewport, and how to reproduce it. Avoid vague statements such as "make the mobile view better".
