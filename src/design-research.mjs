// Module: design-research — compact, deterministic design contracts and
// source-linked evidence cards. No network access or external corpus ingestion.
const drFields = [
  "audience", "product_purpose", "content_hierarchy", "visual_direction",
  "layout_composition", "typography", "colour_tokens", "components",
  "interaction", "motion_intent", "responsive_strategy", "accessibility",
  "anti_patterns",
];

const drProfiles = [
  {
    type: "developer portfolio", match: /\b(developer|engineer|personal site)\b/i,
    purpose: "Make the owner's work and engineering strengths easy to evaluate.",
    hierarchy: ["identity and role", "selected work with outcomes", "capabilities", "contact"],
    layout: "Use a restrained editorial grid: a concise identity block first, then a small number of project case studies with consistent metadata and generous separation.",
    visual: "Let project artifacts and their outcomes provide the visual character; keep interface chrome quiet and use one deliberate accent only if the owner supplies a brand direction.",
    components: ["identity header", "case-study cards", "project detail links", "contact action"],
    avoid: ["generic skill-meter grids", "invented client logos or project metrics"],
  },
  {
    type: "SaaS", match: /\b(saas|software|platform|product)\b/i,
    purpose: "Explain the product's intended job and help a suitable visitor take the next step.",
    hierarchy: ["problem and product purpose", "proof or product view", "key capabilities", "next step"],
    layout: "Build a clear top-to-bottom argument; give the product view enough space to explain one real workflow instead of stacking interchangeable feature cards.",
    visual: "Use a consistent product-led system and a single focal product view; defer brand-specific palette and type choices until supplied.",
    components: ["navigation", "product explanation", "workflow or product view", "evidence block", "primary action"],
    avoid: ["unsupported performance or customer claims", "feature grids without a user outcome"],
  },
  {
    type: "editorial", match: /\b(editorial|article|essay|publication|story|journal)\b/i,
    purpose: "Support focused reading and make the article's structure and source context legible.",
    hierarchy: ["title and byline", "summary or standfirst", "article sections", "sources and related reading"],
    layout: "Keep a readable central text measure, strong heading landmarks, and a separate narrow rail only when it aids navigation rather than competing with the article.",
    visual: "Treat typography, line length, and whitespace as the primary identity; use imagery only where it adds context.",
    components: ["article header", "table of contents when long", "body typography", "citation links"],
    avoid: ["interruptive overlays", "dense sidebars competing with the reading column"],
  },
  {
    type: "dashboard", match: /\b(dashboard|admin|analytics|reporting)\b/i,
    purpose: "Help a user understand current state and identify a useful next action.",
    hierarchy: ["scope and time context", "most decision-relevant measure", "supporting breakdown", "available actions"],
    layout: "Group data by the decisions it supports; show labels, units, and time context close to each value and preserve a stable navigation/content frame.",
    visual: "Prioritize scan order and legible data distinctions; use color as a redundant signal, not the only encoding.",
    components: ["navigation", "filter controls", "metric summaries", "data table or chart", "empty and loading states"],
    avoid: ["decorative charts without a question", "color-only status encoding", "fabricated metrics"],
  },
  {
    type: "ecommerce storefront", match: /\b(e-?commerce|storefront|shop|products|checkout)\b/i,
    purpose: "Help shoppers understand product fit and proceed through a transparent purchase path.",
    hierarchy: ["product or category context", "product details and price", "selection options", "purchase action", "delivery/returns details"],
    layout: "Keep product imagery and purchase information adjacent; expose selection, availability, and total-cost context before commitment.",
    visual: "Let real product photography and supplied brand assets lead; keep purchase controls visually distinct and consistent.",
    components: ["product listing", "product detail", "variant selection", "cart or purchase action", "delivery/returns details"],
    avoid: ["invented prices, reviews, stock, or policies", "hidden costs revealed only after commitment"],
  },
  {
    type: "creative studio", match: /\b(creative studio|design studio|agency|studio)\b/i,
    purpose: "Show the studio's work and point visitors toward a relevant conversation.",
    hierarchy: ["studio identity", "selected work", "services or approach when supplied", "contact"],
    layout: "Use a portfolio-led composition with varied project scale; keep captions and project context attached to the work.",
    visual: "Allow verified work samples to establish the character; do not assume a particular art direction, client roster, or medium.",
    components: ["studio identity", "project gallery", "project context", "contact action"],
    avoid: ["invented client names or awards", "uniform tiles that flatten different projects"],
  },
  {
    type: "accessible content-heavy page", match: /\b(accessible|content-heavy|guide|documentation)\b/i,
    purpose: "Make dense information navigable, understandable, and operable across input methods and viewport sizes.",
    hierarchy: ["page purpose and scope", "section navigation", "chunked content with descriptive headings", "related actions or references"],
    layout: "Use a readable main column with a clearly separated contents navigation; collapse the navigation into an in-page control on small screens without hiding the content.",
    visual: "Use typography, spacing, and heading structure to expose the information hierarchy; keep decoration subordinate to reading and navigation.",
    components: ["skip link", "landmark structure", "table of contents", "descriptive section headings", "back-to-top link when useful"],
    avoid: ["keyboard traps", "motion or colour as the only way to convey meaning", "collapsing required content behind unclear controls"],
  },
];

const drClean = (value, max = 8) => (Array.isArray(value)
  ? value.filter((v) => typeof v === "string" && v.trim()).slice(0, max).map((v) => v.trim().slice(0, 240))
  : undefined);
const drText = (value) => typeof value === "string" ? value.trim().slice(0, 600) : undefined;

export function planDesign(input) {
  const brief = drText(input.brief);
  const profile = drProfiles.find((p) => p.match.test(brief))
    || drProfiles.find((p) => p.match.test(String(input.project_type || "")));
  const known = {
    brief,
    project_type: drText(input.project_type),
    audience: drText(input.audience),
    goals: drClean(input.goals, 5),
    brand_notes: drText(input.brand_notes),
    content_outline: drClean(input.content_outline, 8),
    references: drClean(input.references, 5),
    constraints: drClean(input.constraints, 8),
    preferred_stack: drText(input.preferred_stack),
  };
  for (const key of Object.keys(known)) if (known[key] === undefined || known[key] === "") delete known[key];
  if (!known.goals?.length) delete known.goals;
  if (!known.content_outline?.length) delete known.content_outline;
  const questions = [];
  if (!known.audience) questions.push({ field: "audience", question: "Who is the primary audience, and what do they already know?" });
  if (!known.brand_notes) questions.push({ field: "visual_identity", question: "Are there existing brand colours, typefaces, logos, or identity rules to preserve?" });
  if (!known.content_outline) questions.push({ field: "content_hierarchy", question: "Which content, proof, or actions are required for the first release?" });
  if (!known.constraints) questions.push({ field: "constraints", question: "Are there technical, legal, or operational constraints beyond those stated in the brief?" });

  const rec = {
    product_purpose: known.goals?.join("; ") || profile?.purpose || "Clarify the stated request's primary user task before choosing a page structure.",
    content_hierarchy: known.content_outline || profile?.hierarchy || null,
    visual_direction: known.brand_notes || profile?.visual || null,
    layout_composition: profile?.layout || null,
    typography: known.brand_notes ? "Use supplied type guidance; otherwise select and validate a readable type system during implementation." : null,
    colour_tokens: known.brand_notes ? "Derive tokens from supplied brand notes; preserve unknown values until confirmed." : null,
    components: profile?.components || [],
    interaction: ["Provide visible feedback for actions and explicit loading, empty, success, and error states where applicable."],
    motion_intent: "No signature motion is specified. Add motion only when it clarifies a state change or spatial relationship; provide a reduced-motion alternative.",
    responsive_strategy: "Recompose by content priority at narrow widths; keep all actions and information reachable without horizontal page scrolling.",
    accessibility: ["Semantic landmarks and heading order", "Keyboard-operable controls with visible focus", "Text alternatives for meaningful imagery", "Do not rely on colour alone", "Respect prefers-reduced-motion"],
    anti_patterns: profile?.avoid || ["generic template sections without a content purpose", "invented brand, audience, product, or performance claims"],
  };
  const basisFor = (field) => {
    if (field === "product_purpose" && known.goals) return "derived from user-stated goals; confirm prioritization";
    if (field === "content_hierarchy" && known.content_outline) return "ordered from the user-stated content outline; confirm priority";
    if (field === "visual_direction" && known.brand_notes) return "based on user-stated brand notes; confirm implementation";
    if ((field === "typography" || field === "colour_tokens") && known.brand_notes) return "implementation recommendation based on user-stated brand notes";
    return profile ? "page-type heuristic; confirm against user goals and actual content" : "general implementation heuristic; confirm before treating as a requirement";
  };
  const statusFor = (field, value) => {
    if ((field === "product_purpose" && known.goals)
      || (field === "content_hierarchy" && known.content_outline)
      || (field === "visual_direction" && known.brand_notes)) return "user_stated";
    return value === null || value === undefined || (Array.isArray(value) && !value.length) ? "unknown" : "recommended";
  };
  const contract = {
    contract_version: "1",
    user_stated: known,
    recommendations: Object.fromEntries(drFields.map((field) => [field, {
      status: statusFor(field, rec[field]),
      value: rec[field] ?? null,
      basis: basisFor(field),
    }])),
    open_questions: questions,
    retrieval_hints: {
      component_queries: (profile?.components || []).slice(0, 4),
      system_query: profile?.type || known.project_type || null,
      note: "Use hints to search first-party catalogue metadata; select a few candidates and inspect only chosen details.",
    },
  };
  return contract;
}

const drSources = [
  {
    id: "arxiv-2403.03163",
    title: "Design2Code: Benchmarking Multimodal Code Generation for Automated Front-End Engineering",
    authors: ["Chenglei Si", "Yanzhe Zhang", "Ryan Li", "Zhengyuan Yang", "Ruibo Liu", "Diyi Yang"],
    publication: "NAACL 2025; arXiv preprint",
    year: 2024, date: "2024-03-05", url: "https://arxiv.org/abs/2403.03163", doi: null,
    source_type: "preprint_and_conference_paper", metadata_provider: "arXiv",
    license_access: "abstract and paper openly accessible on arXiv; reuse license not asserted here; link to source, do not reproduce paper",
    freshness: "arXiv version 3 updated 2025-02-09 (metadata checked 2026-11-23)",
  },
  {
    id: "wcag22-reflow",
    title: "Understanding Success Criterion 1.4.10: Reflow",
    authors: ["World Wide Web Consortium (W3C)"],
    publication: "WCAG 2.2 Understanding document",
    year: 2023, date: "2023-10-05", url: "https://www.w3.org/WAI/WCAG22/Understanding/reflow.html", doi: null,
    source_type: "standard_guidance", metadata_provider: "W3C",
    license_access: "public access; reuse license not asserted here; link to source; no source text reproduced",
    freshness: "W3C page updated 2026-10-04; checked 2026-11-23",
  },
  {
    id: "wcag22-animation",
    title: "Understanding Success Criterion 2.3.3: Animation from Interactions",
    authors: ["World Wide Web Consortium (W3C)"],
    publication: "WCAG 2.2 Understanding document",
    year: 2023, date: "2023-10-05", url: "https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html", doi: null,
    source_type: "standard_guidance", metadata_provider: "W3C",
    license_access: "public access; reuse license not asserted here; link to source; no source text reproduced",
    freshness: "W3C page updated 2025-09-16; checked 2026-11-23",
  },
  {
    id: "doi-10.1016-j.ijhcs.2024.103257",
    title: "User perception of animation fluency: The effect of time duration in different phases of animated transitions during application usage",
    authors: ["Yan Ge", "Hongyu Chen", "Yuchen Wang", "Weina Qu", "Yubo Zhang", "Yanfang Liu"],
    publication: "International Journal of Human-Computer Studies, volume 186, article 103257",
    year: 2024, date: "2024-06", url: "https://doi.org/10.1016/j.ijhcs.2024.103257", doi: "10.1016/j.ijhcs.2024.103257",
    source_type: "journal_article", metadata_provider: "OpenAlex and Crossref",
    license_access: "closed access per OpenAlex metadata; metadata only; link to publisher; no abstract or full text copied",
    freshness: "OpenAlex and Crossref metadata checked 2026-11-23",
  },
];

const drClaims = [
  {
    id: "design2code-layout-errors",
    source_id: "arxiv-2403.03163",
    evidence_type: "empirical_benchmark_abstract",
    method: "Benchmark evaluation of screenshot-conditioned multimodal code generation, with automatic metrics and human evaluation as described in the abstract.",
    population_sample: "484 manually curated real-world webpages; benchmark tasks and evaluated models are specific to the paper.",
    date: "2024-03-05",
    section: "Abstract",
    finding: "The authors report that evaluated models often omit visual elements and produce incorrect layouts in this benchmark.",
    limitations: ["Abstract-level summary only; benchmark performance is not a measure of general design quality.", "Task, dataset, models, and evaluation setup bound the result."],
    confidence_basis: "Medium: claim is explicit in the arXiv abstract; full paper has not been reviewed for this corpus card.",
    practical_implications: ["Compare implementation against the actual brief and reference at the element and layout level; do not assume generated code preserves all visual content."],
  },
  {
    id: "wcag-reflow-guidance",
    source_id: "wcag22-reflow",
    evidence_type: "standard_guidance",
    method: "Normative WCAG success criterion with explanatory Understanding guidance.",
    population_sample: null, date: "2023-10-05", section: "Success Criterion 1.4.10",
    finding: "Content should reflow at the criterion's specified equivalent narrow viewport conditions without requiring scrolling in two dimensions for ordinary content.",
    limitations: ["Apply the complete criterion and its exceptions from the linked WCAG source; this short card is not a conformance assessment."],
    confidence_basis: "High for what the W3C guidance states; not an empirical usability claim.",
    practical_implications: ["Test narrow layouts for readable reflow and reachable content; assess wide data tables and other exceptions against the full criterion."],
  },
  {
    id: "wcag-animation-guidance",
    source_id: "wcag22-animation",
    evidence_type: "standard_guidance",
    method: "WCAG success criterion with explanatory Understanding guidance.",
    population_sample: null, date: "2023-10-05", section: "Success Criterion 2.3.3",
    finding: "Non-essential animation triggered by interaction can be disabled, subject to the criterion's scope and exceptions.",
    limitations: ["This is Level AAA guidance; consult the linked criterion and exceptions. It is not a universal claim that all animation must be removed."],
    confidence_basis: "High for the standard's stated requirement and level; not an empirical claim.",
    practical_implications: ["Offer an appropriate reduced-motion experience for non-essential interaction-triggered movement and verify it with the platform preference."],
  },
];

export function researchSources() { return drSources.map((source) => ({ ...source, authors: [...source.authors] })); }
export function researchClaims() { return drClaims.map((claim) => ({ ...claim, limitations: [...claim.limitations], practical_implications: [...claim.practical_implications] })); }

export function searchResearch(query, limit = 3, corpus = { sources: drSources, claims: drClaims }) {
  const terms = String(query || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  if (!terms.length) return { query: String(query || ""), total: 0, items: [], note: "Provide a topic or question to search the curated evidence cards." };
  const sources = new Map((corpus.sources || []).map((source) => [source.id, source]));
  const ranked = (corpus.claims || []).map((claim) => {
    const source = sources.get(claim.source_id);
    if (!source) return null;
    const haystack = [claim.finding, claim.evidence_type, claim.method, claim.section, ...claim.practical_implications, source.title, source.publication].join(" ").toLowerCase();
    const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
    return { claim, source, score };
  }).filter((row) => row && row.score > 0).sort((a, b) => b.score - a.score || a.claim.id.localeCompare(b.claim.id));
  return {
    query: String(query || "").slice(0, 300), total: ranked.length,
    items: ranked.slice(0, limit).map(({ claim, source }) => ({
      id: claim.id, evidence_type: claim.evidence_type, finding: claim.finding,
      implication: claim.practical_implications[0], limitations: claim.limitations,
      source: { id: source.id, title: source.title, url: source.url, doi: source.doi, year: source.year },
      detail_ref: { tool: "aura_research_read", id: claim.id },
    })),
    corpus: { source_count: sources.size, claim_count: (corpus.claims || []).length, updated: "2026-11-23" },
    ...(corpus.claims?.length ? {} : { empty_corpus: true, note: "No reviewed evidence cards are available; use the Design Contract and do not infer research findings." }),
  };
}

export function readResearch(id) {
  const claim = drClaims.find((entry) => entry.id === id);
  if (!claim) return null;
  const source = drSources.find((entry) => entry.id === claim.source_id);
  if (!source) return null;
  return { ...claim, source: { ...source, authors: [...source.authors] }, interpretation: { kind: "research_implication", text: claim.practical_implications[0] } };
}
