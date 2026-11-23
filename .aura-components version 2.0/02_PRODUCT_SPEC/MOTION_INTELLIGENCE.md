# Motion Intelligence

## Product intent

Help the model design and understand motion that communicates hierarchy, cause-and-effect, state, spatial relationships and brand character. Do not turn every element into an animation.

## Three stages

### 1. Inspect

Observe when possible:

- trigger: load, scroll, hover, click, focus, key press, state update;
- target element or region;
- initial and final visual state;
- properties: transform, opacity, clipping, colour, layout and other observed changes;
- duration, delay, easing and iteration where exposed by the runtime;
- sequence/stagger and overlap;
- interruption/cancellation behaviour;
- library/runtime evidence (CSS, Web Animations API, GSAP, etc.).

Use labels:

- `observed`: directly exposed by browser evidence;
- `inferred`: interpretation from visual or structural clues;
- `unavailable`: cannot be measured with the available adapter.

Do not claim full GSAP timeline reconstruction if only a subset of tweens or runtime metadata is available.

### 2. Plan

Suggested tool: `aura_motion_plan`.

Return:

- motion purpose;
- interaction/trigger;
- target and affected properties;
- start/end state description;
- duration/easing/stagger as recommendations with rationale;
- sequencing and interruption rules;
- reduced-motion alternative;
- responsive/touch fallback;
- performance risks;
- implementation hint/library only when the project stack justifies it.

### 3. Verify

Check:

- user input is not delayed by unnecessary animation;
- motion does not obscure content or focus;
- motion communicates a useful state or relationship;
- related elements use consistent timing and easing;
- motion remains usable on touch devices;
- reduced-motion preference is respected;
- common animation paths favour transform/opacity when appropriate;
- heavy layout/paint work is not introduced without a reason;
- `will-change` is not applied indiscriminately.

## Motion taxonomy

- Micro-interaction: feedback and affordance.
- State transition: loading, success, error, selection, expansion.
- Spatial transition: relationship between views or elements.
- Scroll choreography: sequencing and narrative progression.
- Product storytelling: demonstrating how a product works.
- Brand motion: restrained, recognisable movement language.

## Timing guidance

No duration is universal. Research reviews discuss timing, velocity, displacement and easing as perceptual factors; one study's preferred range must not become a universal hard-coded value. Start from a restrained system, then verify in context and on device.

## Targeted capture

Prefer a controlled interaction scenario with:

1. baseline screenshot/state;
2. trigger action;
3. one or more transition snapshots or animation events;
4. settled final state;
5. extracted motion metadata;
6. compact human-readable summary plus artifact references.

A scroll tour remains useful for broad page inspection, but it is not a substitute for recording a named hover/click/expand interaction.

## Accessibility

Respect `prefers-reduced-motion`. For meaningful motion, provide a reduced or removed-motion alternative that preserves state feedback and does not hide information. Consider vestibular triggers and unnecessary large/continuous movement. Keyboard focus must receive equivalent feedback to hover.

## Output budget

Return the top findings and references by default. Store full frame sequences and verbose traces as local artifacts, with explicit retrieval. Never dump long timeline JSON or full screenshots as base64 by default.
