# Optional REA MCP workflow — reverse engineering as evidence collection

## Project

The user's intended companion is `webdebug/reverse-engineering-mcp`:
<https://github.com/webdebug/reverse-engineering-mcp>

REA is a separate MCP server and toolset. Aura must not depend on it at runtime or install it automatically. Its value is browser observation, scenario capture, runtime/bundle analysis and screenshot comparison.

## Appropriate workflow

1. Use REA `list_browser_targets` to identify the correct browser tab.
2. Use `inspect_web_page` for a bounded overview of a user-owned or otherwise authorised page.
3. Use `capture_browser_scenario` to observe specific interactions declaratively: initial state, action, wait condition and selected post-action captures.
4. Use `capture_web_screenshot` or `compare_web_screenshots` when screenshots are needed.
5. Use `inspect_web_event_listeners`, `observe_web_execution`, `analyze_web_bundle` or JS tracing only when the question requires those forms of evidence.
6. Summarise evidence in a compact object: page purpose, layout regions, visible tokens, trigger/action/state changes, responsive differences, observed limitations, source links and screenshot references.
7. Feed the compact observation summary to Aura's `aura_plan_design`, `aura_motion_plan` or `aura_visual_audit` workflow.
8. Build an original implementation that captures high-level principles and functional behaviour; do not copy protected source code, assets or a distinctive site wholesale.

## Important limits

- REA's passive CDP inspection and controlled Playwright scenarios are different modes; choose deliberately.
- `observe_web_execution` can affect timing/JIT behaviour and is not an animation recorder.
- Event-listener inspection does not itself invoke the interaction.
- Bundle analysis provides evidence about shipped resources; it does not recover an exact original source project.
- Large scenario captures, DOM snapshots and scripts can fill the context window. Request only the necessary states and evidence, then summarise before handing to Aura.
- Use only sites the user owns, is authorised to test, or is publicly accessible for ordinary non-invasive observation. Respect terms and access controls.

## REA references

- Repository: <https://github.com/webdebug/reverse-engineering-mcp>
- Browser observation: <https://github.com/webdebug/reverse-engineering-mcp/blob/main/docs/browser-observation.md>
- Scenario contract: <https://github.com/webdebug/reverse-engineering-mcp/blob/main/docs/browser-scenario-contract.md>
- Tool design: <https://github.com/webdebug/reverse-engineering-mcp/blob/main/docs/tool-design.md>
- JavaScript application workflows: <https://github.com/webdebug/reverse-engineering-mcp/blob/main/docs/javascript-application-workflows.md>
