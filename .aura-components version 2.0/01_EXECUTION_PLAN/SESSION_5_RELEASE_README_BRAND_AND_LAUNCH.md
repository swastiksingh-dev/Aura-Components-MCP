# Session 5 — Documentation, identity, launch assets and release readiness

## Outcome

Present the shipped v2.0 honestly and professionally, make the project easier to install and understand, and prepare a cohesive banner/video/social launch package.

## Read first

- `04_BRAND_AND_LAUNCH/README_REBUILD.md`
- `04_BRAND_AND_LAUNCH/GITHUB_BANNER_BRIEF.md`
- `04_BRAND_AND_LAUNCH/LAUNCH_VIDEO_STORYBOARD.md`
- `04_BRAND_AND_LAUNCH/SOCIAL_LAUNCH_KIT.md`
- `03_ENGINEERING_PLAYBOOK/RELEASE_CHECKLIST.md`

## Work sequence

1. Reconcile every README claim against shipped code, package metadata, tests and actual npm package contents.
2. Rebuild README around a strong first impression, one-command install, short capability overview, tested examples, tool index, architecture, privacy/security, limitations, contribution and roadmap.
3. Create a new original banner from scratch following the creative brief. Keep high-contrast and readable at GitHub social-preview scale. Store editable source (SVG or design source) alongside final PNG.
4. Update setup/client configuration examples only after testing them with the published package and supported clients.
5. Create a 25–35 second launch-video master using the storyboard. Show the real working product: task, tool call, design contract, actual browser result, responsive/motion check, final CTA. Do not fabricate an AI response or benchmark.
6. Keep the video project and prompt/source assets editable. If the coding model cannot render video, prepare the assets and a clear handoff for a capable editor/video tool; do not pretend an MP4 was rendered.
7. Export a master 16:9 version and platform crops only after checking legibility and safe areas. Add captions/subtitles and a no-audio-readable version.
8. Prepare X/Twitter copy, GitHub release notes, short changelog and an announcement asset pack.
9. Run the full test/build/verify suite, `npm pack --dry-run`, package install smoke test, MCP handshake and representative tool calls.
10. Verify generated `dist` exactly matches the source build. Check versions, setup docs, `llms.txt`, badges, links, alt text, licences and third-party notices.
11. Prepare a release checklist and tag proposal. Do not publish without the user's explicit approval.

## Deliverables

- Rebuilt README and aligned supporting docs.
- New banner source and PNG (if image rendering capability is available).
- Launch-video storyboard, voiceover, on-screen text, prompts, caption file and editable project handoff.
- Social post and GitHub release draft.
- Complete test and package verification report.
- Migration guide and release notes.
- Updated `PROGRESS.md` with release readiness status.

## Acceptance criteria

- Every number and feature claim in README is verified.
- A first-time contributor can install and use the server without reading the source.
- The banner is original, legible and uses actual v2 capabilities.
- The launch video contains real demonstrations and has captions.
- Installation, build, MCP handshake, representative tools and package contents pass.
- Known limitations and breaking changes are clear.
- No npm publish, GitHub release or push occurs until the user approves.

## Session 5 prompt

> Execute Session 5 only. Rebuild the README and public-facing materials using only verified v2 capabilities. Create the banner source and launch-video production package; render/export only if the available tools genuinely support it. Run full release checks, verify npm package contents and all claims, draft release notes and social copy, and leave publishing for explicit user approval. Update `PROGRESS.md` with a final go/no-go report.
