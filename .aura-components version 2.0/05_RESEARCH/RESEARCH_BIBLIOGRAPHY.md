# Research bibliography — Aura 2.0

> Curated starting points, not a claim that every paper has been fully reviewed. Before implementing a research-derived rule, inspect the source, publication status, methodology, scope and limitations. Save reviewed evidence cards in the research index with section/page pointers.

## Motion, interaction and perception

1. **Motion design in mobile user interface: A review from theory to practice** (2026 review). <https://www.sciencedirect.com/science/article/pii/S305074132600025X>
   - Use for: perception/cognition, temporal and spatial properties of motion, synthesis of motion design principles.
   - Caution: review-level synthesis; do not convert one suggested range into a universal timing rule.

2. **LogoMotion: Visually Grounded Code Generation for Content-Aware Animation** (2024). <https://arxiv.org/abs/2405.07065>
   - Use for: the idea that generated animation should be grounded in visual elements/roles and iteratively checked, rather than applying generic animation presets.
   - Caution: research prototype and task setting may not generalise directly to production websites.

3. **User perception of animation fluency: effect of time duration in different phases** (2024). <https://doi.org/10.1016/j.ijhcs.2024.103257>
   - Use for: how click-response delay and loading-completion duration relate to perceived fluency.
   - Caution: duration effects depend on context and phase; do not use a fixed universal value.

4. **Applying Cartoon Animation Techniques to GUI** (Thomas & Calder, 2001). <https://doi.org/10.1145/502907.502909>
   - Use for: how animation techniques can improve transitions and direct manipulation in interfaces.
   - Caution: older foundational work; test relevance against modern devices and interaction patterns.

## Visual design, screenshot-to-code and consistency

5. **Design2Code: How Far Are We From Automating Front-End Engineering?** (2024 preprint; later conference publication). <https://arxiv.org/abs/2403.03163>
   - Use for: screenshot-to-code benchmark design, visual element omissions and layout errors.
   - Caution: benchmark/task limitations; not a direct measure of general design quality.

6. **DesignBench** (2025). <https://arxiv.org/abs/2506.06251>
   - Use for: evaluating generation, editing and repair across multiple frontend frameworks and dimensions.
   - Caution: benchmark results are tied to its dataset and evaluation method.

7. **Design Behaviour and Interface Consistency in Generative No-Code Tools: Systematic Literature Review** (2026). <https://www.mdpi.com/2073-431X/15/4/238>
   - Use for: consistency, transparency, user control, reproducibility and drift in AI-assisted interface generation.
   - Caution: review of a defined body of studies and a particular no-code context; translate recommendations carefully.

8. **Constraints are all you need: Exploring AI-powered landing page design** (PLOS ONE, 19 November 2026). <https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0362573>
   - Use for: structured constraints/component guidance as a way to improve generated landing pages.
   - Caution: authors report a limited sample (12 pages) and differences in generation environments; promising evidence, not a universal guarantee.

## Responsive design, accessibility and performance

9. **WCAG 2.2 — Reflow (1.4.10)**. <https://www.w3.org/WAI/WCAG22/Understanding/reflow>
   - Use for: reflow expectations at narrow widths and horizontal scrolling for ordinary content.

10. **WCAG 2.2 — Animation from Interactions (2.3.3)**. <https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions>
    - Use for: non-essential interaction-triggered animation and reduced-motion alternatives.

11. **Chrome — CSS layout and container queries**. <https://developer.chrome.com/docs/modern-web-guidance/guides/css/css-layout>
    - Use for: layout techniques and component-level responsiveness.

12. **Chrome — Responsive design**. <https://developer.chrome.com/docs/modern-web-guidance/guides/css/responsive-design>
    - Use for: responsive layouts and viewport-aware behaviour.

13. **web.dev — High-performance CSS animations**. <https://web.dev/articles/animations-guide>
    - Use for: rendering performance, transform/opacity and avoiding unnecessary layout/paint.

## MCP and AI-tool architecture

14. **MCP Client Best Practices (2026-07-28 docs)**. <https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/develop/clients/client-best-practices.mdx>
    - Use for: progressive tool discovery, result routing, programmatic tool calling and context management. Remember that implementation of host-side discovery/code execution belongs to the MCP client.

15. **MCP Tool Descriptions Are Smelly!** (2026 preprint). <https://arxiv.org/abs/2602.14878>
    - Use for: evaluating tool-description clarity and the trade-off between discoverability and extra context/steps.
    - Caution: preprint; review evaluation setup before treating claims as settled.

## Tooling documentation

16. **OpenCode agents**. <https://opencode.ai/docs/agents>
17. **OpenCode permissions**. <https://opencode.ai/docs/permissions>
18. **OpenCode config**. <https://opencode.ai/docs/config/>

## Research implementation rule

The repository should store compact evidence cards with full source metadata and citations, not copy the full body of each paper into prompt files. Each recommendation should name whether it is empirical evidence, standard guidance, an engineering heuristic or an Aura-specific test result.
