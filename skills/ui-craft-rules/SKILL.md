---
name: "ui-craft-rules"
description: "Constructive frontend design rules: palette roles capped at three hues, type pairing and modular scale, grid/flex layout under stress, purposeful motion, full component states, APCA/WCAG contrast. Use when building React/Next/Tailwind screens or reviewing visual quality after ui-slop-remover has stripped tells. Pair under R13 with ui-slop-remover."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# ui-craft-rules

Senior judgment for interface work: how color earns its place, how layout survives narrow viewports, when motion helps, and which states ship. `ui-slop-remover` strips synthetic signatures. This skill decides what goes in their place. R13 loads both on design work.

## Scope

Apply for React or Next screens, Tailwind v3/v4, CSS Modules, Framer Motion when installed, component state design, type hierarchy, spacing rhythm, palette, responsive behavior. Confirm which libraries resolve before assuming an import.

Out of: token file pipelines (`design-token-pipeline`), Apple platform audits (`apple-ui-audit`), backend and data layers.

## Color with a job

Cap the live palette at three hues plus neutrals:

| Role | Share | Notes |
|---|---|---|
| Dominant | ~60% | Brand or product field |
| Neutral ramp | ~30% | Surfaces and text, tinted warm or cool |
| Accent | ~10% | Primary action and focus |

Semantic colors (success, warning, danger, info) sit outside the brand three. Extend with tints and shades of the same hue; a fourth decorative hue is a smell.

- Gradients only for direction or brand. Never as default wallpaper.
- Check contrast on the real background pair. Prefer APCA for body/UI on dark or thin type (target roughly Lc ≥75 body, ≥45 large, ≥30 non-text); keep WCAG 2.2 AA (4.5:1 / 3:1) as the floor when APCA is unavailable.
- Text over images or busy fields needs a scrim or a solid plate under the type.

## Type before decoration

- One family, or two with a clear split (UI sans + editorial serif). Avoid Inter/Roboto/Open Sans as the *only* headline voice unless the brand says so.
- Modular scale: ×1.25 for product UI, ×1.333 for editorial. Explicit line-heights. Body ≥16px.
- Weights: 400 / 500 / 700 unless the foundry and brand need more.
- Measure 45-75 characters for reading text; tighter tracking on display sizes.

## Layout that holds under stress

1. Start from the longest realistic string, then constrain.
2. CSS grid for page regions; flex for row internals.
3. Set breakpoints where the composition breaks, not only at device names.
4. Verify 320px, 768px, 1280px, and one ultrawide before calling it done.
5. Reserve space for images, async data, and error strings (no layout jump).
6. Tap targets ≥44×44 CSS px on touch. No horizontal overflow at 320px.
7. Tables become stacked records or scroll containers with a visible hint.
8. At least one section may full-bleed or sit off-center; equal `py-24` bands every time read as generated.

## Motion with a purpose

Animate state: enter, exit, reorder, feedback. Scrolling a section into view is not a state change.

- Micro-transitions ≤300ms; hover/focus 150-250ms.
- Honor `prefers-reduced-motion: reduce`: strip transforms and long moves; short opacity is usually enough.
- Framer Motion (when present) owns shared layout and gesture; CSS owns hover/focus.
- Document duration and easing per animated property in the PR.
- Nothing animation-related may block input or hide content from assistive tech.

## States are part of the design

Ship with every interactive control:

- default, hover, active, focus-visible, disabled, loading
- empty, error, and populated for data surfaces

Focus ring visible on every surface in the palette. Hover must not carry information that focus omits. Error text says how to recover, not only that something failed.

## Responsive checklist

- [ ] 320px: no overflow; long words wrap or ellipsize with `title`.
- [ ] Touch targets ≥44×44.
- [ ] Nav collapses to a platform-expected pattern (menu button, not hidden links).
- [ ] Images have aspect-ratio or `object-fit` so late loads do not shift.
- [ ] Narrow layout has its own hierarchy, not a vertical desktop dump.

## Motion checklist

- [ ] Duration + easing named per property.
- [ ] Reduced-motion path keeps meaning without transforms.
- [ ] No animation blocks input or AT.
- [ ] Shared-element transitions only when spatial continuity helps.

## Decision log (handoff)

In the PR, leave: palette roles, breakpoint rationale, motion tokens, which clichés were rejected on purpose, screenshots at three widths. The next engineer should not reverse-engineer your taste from CSS.

## Sources

Apple HIG (layout, states), WCAG 2.2 and APCA practice, web.dev layout/INP guidance, established design-system writing on modular type and semantic color. Original Novahiz synthesis; no upstream skill text.
