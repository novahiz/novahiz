---
name: "frontend-design-taste"
description: "Use when building high-agency frontend interfaces with strict design taste, calibrated color, responsive layout, and motion rules."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# Frontend design judgment

Senior-level choices for interface work: how color earns its place, how layout survives narrow viewports, when motion helps, and where generated UI usually drifts into cliché. Pair with `anti-AI-design` under R13: that skill deletes synthetic signatures, this one sets the constructive rules.

## Scope

Apply when the request asks for careful frontend UI, or when any of these need a deliberate call: React or Next.js screens, Tailwind (v3 or v4), Framer Motion, component states, type hierarchy, spacing rhythm, palette decisions, responsive behavior. Confirm which libraries are actually installed before assuming an import will resolve.

Out of scope: token pipelines (see `design-system-tokens`), Apple platform audits (see `apple-hig-audit`), backend or data-layer work.

## Operating principles

**Color with a job.** Build a small ramp from one brand hue: a surface scale, a text scale, one accent for primary action, one semantic set (success, warning, danger, info). Every swatch should answer what it means here. Gradients only when they encode direction or brand, never as default hero wallpaper. Check contrast of body text against its actual background, not against white in a picker.

**Layout that holds under stress.** Start from the content's longest realistic string, then constrain. Prefer CSS grid for page regions and flex for row internals. Define breakpoints from where the composition breaks, not from device names alone. Test at 320px, 768px, 1280px, and one ultrawide width before calling a layout done. Reserve space for images, async data, and error strings so nothing jumps.

**Type before decoration.** One family, or two with a clear division of labor (UI sans plus editorial serif). Set a modular scale with explicit line-heights. Limit weights to 400, 500, 700 unless the foundry license and brand require otherwise. Measure between 45 and 75 characters for reading text.

**Motion with a purpose.** Animate state changes (enter, exit, reorder, feedback), not the mere fact that a section scrolled into view. Keep micro-transitions under 300ms. Honor `prefers-reduced-motion: reduce`. Framer Motion, when present, owns shared layout and gesture work; plain CSS transitions cover hover and focus.

**States are part of the design.** Ship empty, loading, error, disabled, and focus-visible variants with the happy path. Keyboard focus ring must be visible against every surface in the palette. Hover styles never carry information that focus styles omit.

## Default bans for generated screens

These attract the same smell the companion skill polices; treat them as red flags until a brand constraint forces one:

- Centered hero with two pill CTAs as the only above-fold structure.
- Violet or indigo brand gradient as a catch-all accent.
- Grids of identical rounded cards with placeholder illustrations.
- Section headings in Title Case with emoji decorations.
- Infinite scroll-triggered fade-ups with uniform stagger.
- Icon-only affordances without accessible names.

## Responsive checklist

1. No horizontal overflow at 320px; long words wrap or ellipsize with a title attribute.
2. Tap targets at least 44 by 44 CSS pixels on touch layouts.
3. Navigation collapses into a pattern the platform expects (menu button, not hidden links).
4. Tables become stacked records or horizontally scroll containers with a visible hint.
5. Images use explicit aspect ratios or `object-fit` rules so late loads do not shift layout.

## Motion checklist

- [ ] Duration and easing documented for each animated property.
- [ ] Reduced-motion path removes transforms and long transitions, keeps opacity fades short if needed.
- [ ] No animation blocks input or hides content from assistive tech.
- [ ] Shared-element transitions only where spatial continuity helps the user follow the object.

## Handing off

Leave the next engineer a short decision log in the PR description: palette roles, breakpoint rationale, motion tokens used, and which clichés were rejected on purpose. Screenshots of the three viewport sizes above belong in the same PR.
