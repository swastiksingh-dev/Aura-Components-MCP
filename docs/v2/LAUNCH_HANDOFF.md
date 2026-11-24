# Aura v2 launch handoff (draft; not a release announcement)

## Status

This is a local release candidate only. `package.json` declares `2.0.0`, but npm
`latest` remains `1.7.3`; the v2 package is not published or tagged. Do not use
the npm install commands in launch copy until publication.

No launch film is included in this repository. A previous local render was
removed at the maintainer's request; the maintainer will produce the final film
separately. A six-shot treatment and narration draft are kept below as a
starting point only. Nothing in this handoff is a capture of the MCP client or a
demo of a live tool call.

## Brand assets

The launch banner is [`../../assets/banner.png`](../../assets/banner.png)
(1672 x 941, ~2.96 MB) and is referenced directly under the README H1.

The launch clip is [`../../assets/launch.mp4`](../../assets/launch.mp4)
(1,724 x 970, 48.9 s, H.264 + AAC, ~42.1 MB). It is a typographic motion piece:
floating tool chips, “35 TOOLS. ONE STUDIO CALL.” cards, and award-intelligence
flow. It is **not** a screen recording of a client or a live tool call.

- The banner is the only image; the old `assets/social-preview.png` was deleted.
- `package.json` allowlists `assets/banner.png` but deliberately not the clip, so
  the published package stays near 3 MB. The README link resolves against the
  repository, not the tarball.
- Before using the clip as launch proof, re-render two chips in its opening
  scene: they read `aura_search` and `aura_award_motion`, but the current tool
  names are `aura_search_components` and `aura_motion_study`.
- Neither asset may contain fabricated UI, invented catalogue counts, or a
  “now on npm” claim while 2.0.0 is unpublished.

## Launch-film treatment (not produced)

No project or render currently exists. The treatment below is a starting point
for the maintainer's own film; it was previously built and checked as a local
HyperFrames project, then deleted at the maintainer's request.

| Time | Visual | On-screen copy |
| --- | --- | --- |
| 0.0–4.2 | A 360 px outlined `COMPONENT` cropped by the right edge drifts left; two masked lines land | “More than / a component.” |
| 4.2–11.0 | Three ledger rows draw in and indent: Stated, Recommended, Still unknown; a mint marker walks the rows | “Start with intent.” |
| 11.0–16.8 | A 6 x 4 field of generic UI nouns fades in, dims, then one word scales up in mint | “Find. Compare. Choose.” |
| 16.8–20.4 | Fourteen hairlines converge into one mint rule beside the headline | “One direction, carried through.” |
| 20.4–26.6 | Desktop and phone outlines; the desktop's two columns reflow to one, then the phone fills | “Check the edges.” |
| 26.6–33.6 | Wordmark, repository path, amber caveat rule | “AURA / COMPONENTS / MCP 2.0” + “LOCAL RELEASE CANDIDATE — NOT YET PUBLISHED” |

The treatment avoids fabricated install commands and “now on npm” claims because
2.0.0 is not published. Any film that uses this structure should keep the
local-candidate caveat visible or state it in the post copy.

## Future real-product recording (not produced)

A true product demo still requires a maintainer-selected build and a real MCP
client. Use a demo project with no private data, keep each tool response on
screen long enough to read, and never substitute fabricated results.

| Time | Capture | Caption / narration |
| --- | --- | --- |
| 0–3s | A plain product brief in the actual client | “A useful interface starts with clear intent.” |
| 3–8s | Real `aura_plan_design` call and its supplied facts/recommendations/questions | “Aura separates what you told it from what it recommends.” |
| 8–13s | Real `aura_search_components` and selected `aura_diff` result | “Find free catalogue options and compare only the facts available.” |
| 13–18s | Show an actual page built by the recording operator, with provenance/credit for its materials | “Use the plan to guide your own implementation.” |
| 18–24s | Real `aura_motion_plan`; optionally show `aura_motion_study` only if Chrome is available and the capture is real | “Plan motion with a reduced-motion alternative. Runtime observations are labeled.” |
| 24–27s | Real responsive audit at selected widths, showing its measured/candidate limits | “Check viewport geometry, not a blanket accessibility certification.” |
| 27–30s | Project name, repository, Node 22+ and install command | “Explore Aura Components MCP on GitHub.” |

Record the command/build identity, date, client and browser/tool availability in
the final edit notes. Do not claim a responsive defect was fixed unless the
recording shows the actual before and after. Any subtitle file, thumbnail,
vertical crop, or recorded client demo remains **not produced** until
independently captured and checked for legibility, captions, rights, and privacy.

### Narration draft (for the new film)

Local Kokoro TTS, voice `am_michael`, was used for the deleted cut. The same
script can be reused; total speech is about 28.5 s inside a 33.6 s timeline.

> A good interface needs more than a component. Start with intent. Aura
> separates what you stated, what it recommends, and what is still unknown.
> Then search a free catalogue, and compare known details, with the unknowns
> marked. Carry one direction into the system you build. Plan motion with a
> reduced-motion path, and check the edges at real viewport sizes. Aura
> Components MCP 2.0. Open source. Node 22 and up.

### Caption cue windows (approximate, not word-verified)

Derived from the generated WAV durations and their placement. Convert to the
editor's subtitle format and re-time against the final audio before publishing.

```text
00:00:00.300 --> 00:00:03.200
A good interface needs more than a component.

00:00:04.400 --> 00:00:07.200
Start with intent.

00:00:07.200 --> 00:00:10.700
Aura separates what you stated, what it recommends, and what is still unknown.

00:00:11.200 --> 00:00:13.600
Then search a free catalogue,

00:00:13.600 --> 00:00:16.200
and compare known details, with the unknowns marked.

00:00:17.000 --> 00:00:19.850
Carry one direction into the system you build.

00:00:20.600 --> 00:00:23.200
Plan motion with a reduced-motion path,

00:00:23.200 --> 00:00:26.400
and check the edges at real viewport sizes.

00:00:26.800 --> 00:00:29.400
Aura Components MCP 2.0. Open source.

00:00:29.400 --> 00:00:32.600
Node 22 and up.
```

## Announcement copy (hold until release approval)

> I’ve been working on Aura Components MCP: a stdio server that combines
> attributed design planning with free Aura catalogue discovery. The current
> branch also includes curated research cards, motion planning, reference
> intelligence, and optional browser evidence—with limitations made explicit.
>
> Source and setup: https://github.com/swastiksingh-dev/Aura-Components-MCP
>
> This is a draft. Replace “working on” only after the release is actually
> published. The rendered film is local and may be posted with the
> local-release-candidate caveat visible; add a real demo link only after a
> client recording and review.

## GitHub release-note outline (unpublished draft)

- **Highlights:** Design Contract planning; provenance-labeled research cards;
  motion planning and evidence; bounded responsive viewport evidence; 35-tool
  current working-tree inventory.
- **Compatibility:** package metadata in this branch is 2.0.0 (unpublished);
  npm `latest` is 1.7.3; Node >=22; stdio; zero npm runtime dependencies.
  Verify release version and client config before publishing.
- **Optional programs:** Chrome/Chromium for browser capture; ffmpeg for WebM.
  REA is separate and optional.
- **Known limitations:** see README and
  [`MOTION_RESPONSIVE.md`](./MOTION_RESPONSIVE.md),
  [`DESIGN_CONTRACT.md`](./DESIGN_CONTRACT.md), and
  [`RESEARCH_LIBRARY.md`](./RESEARCH_LIBRARY.md).
- **Migration:** five `aura_inspo_*` mapping tools were removed in the v2 working
  surface; use catalogue search, award reference tools, `aura_diff`, or
  `aura_scaffold_page`. Confirm whether a formal migration note is needed before
  a release is declared.
- **Release version, tag, dates, install command, credits, and published
  artifact:** unknown until an approved release exists.
