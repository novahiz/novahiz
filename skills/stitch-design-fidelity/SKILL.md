---
name: stitch-design-fidelity
description: "Generate faithful mobile UI screens via Google Stitch MCP. Use when a screen originates from a Stitch maquette, when integrating Stitch designs into an app, when a screen is missing and must be created, or when the user asks whether a build matches its Stitch reference. Forces Stitch to write precise, non-AI-looking prompts from project context, existing screen briefs, and design rules. Only calls Stitch MCP for full-screen generation. Different from novahiz-stitch-fidelity (which verifies a screen against a reference) — this one drives the generation prompt."
license: Apache-2.0
metadata:
  author: novahiz
  version: 1.0.0
---

# Stitch Design Fidelity

Generate mobile UI screens that match a Stitch maquette — pixel-faithful, on-brand, and free of AI-slop tells. This skill drives **Google Stitch MCP** with a precise, context-rich prompt so the output is craft, not a statistical average.

## When this applies

- A screen comes from a Stitch maquette and must be integrated into the app.
- A screen is **missing** from the maquette and must be created to complete the flow.
- The user asks whether a build is identical to its Stitch reference.
- A design task is important enough to warrant a full-screen generation.

**Do not call Stitch MCP for:** small tweaks, single components, copy changes, or layout nudges. Those are ordinary edits. Stitch MCP is for **full-screen generation only** — when the design task is significant.

## The gate: is this a full-screen generation?

Before any Stitch MCP call, answer **yes** to all three:

1. Is a **whole screen** being created or replaced (not a component, not a copy edit)?
2. Is there a **Stitch reference** for it (a maquette screen, or a sibling screen whose brief defines the pattern)?
3. Is the **project context loaded** (design system, existing screen briefs, domain)?

If any answer is no, do not call Stitch MCP. Do the work directly, or ask the user for the missing input.

## Workflow

### Step 1 — Load project context

Gather before prompting. A prompt without context produces generic output.

- **Project domain & audience** — what the app does, who uses it, what they are doing on this screen.
- **Design system** — the tokens below, plus any project-specific overrides in `DESIGN.md` or the design roadmap.
- **Existing screen briefs** — for the screen being generated **and** its siblings (the screens before and after it in the flow). Siblings define the navigation pattern, the header style, the density, the voice.
- **The specific screen brief** — what this screen must do, its primary action, its data, its states.

If any of these is missing, ask the user. Never invent a domain, a brand, or a user need.

### Step 2 — Verify theme

**Light theme is the default.** Enforce a light canvas and high-contrast typography unless the user explicitly requested dark. If the maquette is dark, follow the maquette — the reference wins.

### Step 3 — Build the token block

Formulate the semantic tokens for this screen from the design system below. Do not paste raw hex values into the prompt — name the roles and let Stitch map them, unless the maquette pins exact values.

### Step 4 — Enforce structure

Apply the header rules, navigation architecture, and component persistence rules to **every** screen. These are non-negotiable.

### Step 5 — Group and generate

Group screens into logical batches of **4–5 maximum** per prompt. Inject interactive states, responsive rules, and micro-interactions. Then call Stitch MCP.

### Step 6 — Verify against the reference

After generation, compare the output to the Stitch reference. Use `novahiz-stitch-fidelity` for a measured PASS/DIVERGE verdict. Fix divergences and re-verify until clean.

## Design system

The contract below is the readable source of truth. It is enhanced from the universal Stitch UI/UX directives.

### Dynamic color engine & persistent semantic tokens

- **Theme mode mandate:** Light theme prioritized (soft light neutral canvas, dark crisp headers/body text) unless dark is explicitly requested.
- **Theme auto-selection:** Stitch dynamically chooses a harmonious, accessible palette tailored to the project domain.
- **Primary action token:** main buttons, active tabs, primary triggers.
- **Accent / highlight token:** promotional badges, progress fills, active states.
- **Canvas background:** light, subtle neutral tone (`#F8FAFC` / light gray-slate).
- **Containers & cards:** pure white surface (`#FFFFFF`), 1px subtle structural border (`#E2E8F0`), 12–16px radius, soft elevation shadow.
- **Typography color hierarchy:** dark slate/navy (`#0F172A`) for headers, cool slate gray (`#475569`) for body/secondary labels.
- **Semantic status badges (strict persistence):**
  - Success / completed: soft green tint background + high-contrast green bold text.
  - Warning / pending: soft amber/orange tint background + high-contrast amber bold text.
  - Error / danger: soft red tint background + high-contrast red bold text.

### Header & navigation structural rules (strict)

- **Header logo rule:** logo permitted **only** on screen 1 (welcome/landing). All subsequent screens omit the header logo and use text titles with navigation icons.
- **Top bar:** left back button/icon, center clear title, right context utility icon (search/bell/filter/profile).
- **Navigation:** mobile bottom navigation bar (3–5 items) with primary active color indicator and muted inactive states.

### Typography & data density system

- **Font family:** modern geometric sans-serif (Plus Jakarta Sans / Inter / system sans).
- **Screen title:** bold 20px / dark primary text.
- **Section header:** semi-bold 16px / dark primary text.
- **Body text:** regular 14px / secondary muted text.
- **Financial / data numbers:** extra-bold tabular numbers (32px hero, 18px list cards).

### Component persistence & interaction states

- **Form inputs:** 1px subtle border, 12px radius, focused state = 2px brand primary border.
- **Primary button:** solid brand primary background, readable contrast text, 14px vertical padding, rounded-xl (12px), bold font, explicit active press state.
- **Secondary button:** light brand primary tint background + brand primary text color.

## Anti-AI-pattern rules

These are **bans**, not suggestions. Every generated screen is checked against them. The full catalogue with replacements lives in `references/anti-ai-patterns.md`.

**Color:** no violet-indigo hero wash, no cream/beige second wave, no emerald/amber reflex with no brief, no `gray-50` stock background, no neon-on-dark premium, no rainbow chart cycle.

**Chrome:** no 1px gray border + soft shadow on every card, no colored left strip on plain cards, no identical card row (icon tile + bold subhead + two blurbs), no eyebrow pill above every centered H1, no gradient orb behind hero, no repeated Lucide five as feature language, no emoji as nav/bullets, no nested card-in-card, no placeholder avatars, no fake metric banners.

**Typography & layout:** no Inter/Geist as the only face with no display cut, no default size ladder, no centered stack hero, no Title Case headings with emoji, no mobile-treated-as-desktop-stacked.

**Motion:** no fade-up on scroll for every child, no hover scale + shadow on every card, no infinite pulsing glow on CTAs, no heavy parallax, no same spring on everything.

**Copy:** no "In today's fast-paced world", no "Unlock the power of", no pill trios under the hero, no triple gerund columns.

## Prompt methodology

The prompt injected into Stitch MCP must be **specific, structured, and context-bearing**. The full methodology with templates lives in `references/prompt-methodology.md`.

A prompt that produces craft has:

1. **Domain grounding** — the project's domain and the user's job-to-be-done on this screen.
2. **Token block** — the semantic colors, typography, and geometry for this screen.
3. **Structural rules** — header, navigation, and component persistence applied to this screen.
4. **Screen-specific brief** — what this screen does, its primary action, its data, its states.
5. **Sibling context** — the pattern established by the screens before and after it.
6. **Anti-AI constraints** — the specific tells banned for this screen.
7. **Interactive states** — default, hover, active, focus, disabled, loading, empty, error.

A prompt that produces slop is vague, context-free, and pattern-driven.

## References

- `references/design-system.md` — the full design system with per-domain palette guidance.
- `references/anti-ai-patterns.md` — the AI-slop catalogue with concrete replacements.
- `references/prompt-methodology.md` — the prompt-building methodology with templates.
- `references/stitch-mcp.md` — Stitch MCP server configuration (SSE endpoint, API key auth, tool signatures, call patterns).
- `references/stitch-fidelity.md` — per-screen PASS/DIVERGE verification protocol (used with `novahiz-stitch-fidelity`).
