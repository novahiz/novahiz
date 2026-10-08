# Prompt Methodology

How to build the prompt injected into Google Stitch MCP so the output is craft, not a statistical average.

## The gate: full-screen generation only

Stitch MCP is called **only** when a whole screen is being created or replaced. Not for components, copy edits, or layout nudges. The design task must be significant.

## Universal prompt anatomy

Every UI generation prompt includes these sections:

```
[SUBJECT]:      What screen to generate
[PLATFORM]:     Target platform (iOS 26, Android/Material 3, web)
[STYLE]:        Visual style (mood, references, aesthetic)
[TOKENS]:       Specific design token values (colors, fonts, spacing)
[CONTENT]:      Real or realistic content (never lorem ipsum)
[STATES]:       Which states to show (default, hover, error, loading, empty)
[CONSTRAINTS]:  What NOT to include (negative prompt)
[QUALITY]:      Fidelity level (wireframe, mockup, high-fidelity, production)
[REFERENCE]:      Products to reference style from ("in the style of Linear")
```

**Minimum viable prompt:** SUBJECT + PLATFORM + STYLE.

## The discrete value constraint technique

The single most important technique for pixel-perfect output: give the model an explicit list of allowed values so it stops guessing and starts choosing.

```
Implement only the centered card from this screenshot.
- Framework: SwiftUI (iOS 26 / Xcode 26)
- Spacing options: 8 / 12 / 16 / 24 (pt)
- Radius options: 8 / 12 / 16
- Typography: .footnote / .body / .headline / .title3
- Prefer Asset Catalog colors: Tint/Primary, Surface/Card, Text/Secondary
```

This stops the model from emitting odd numbers like `12.7` and gets output a code reviewer will not mark up.

## The three-part output format

Always ask for three things:

1. **Full source code** for the component
2. **Bulleted rationale** for the values chosen (spacing, shadow, size)
3. **List of details you could not read** from the reference (tap target, pressed state, etc.)

This surfaces where the model hesitated and closes most of the remaining gap in the second round.

## The iterative diff technique

Never say "rewrite the whole thing." Send a tight diff list instead:

```
Apply the smallest possible diff to your previous code:
- shadow-md -> shadow-sm (the reference shadow is much shallower)
- Keep var(--color-brand), but change font-bold -> font-semibold
- Card padding: p-6 -> p-5 (vertical spacing is tighter)
- Button radius: rounded-lg -> rounded-md
Do not change other classes or structure.
```

The phrase "smallest possible diff" matters. Without it, the model quietly suggests "improvements" and you end up with structural changes you did not ask for.

## Platform-specific prompt prefixes

**iOS:**
```
iOS 26 mobile app screen, Liquid Glass design language.
SF Pro font family. SF Symbols for all icons.
Standard iOS navigation with large title header and tab bar.
44pt minimum touch targets. Safe areas respected for Dynamic Island
and home indicator. Light mode with system background colors.
```

**Android:**
```
Android app screen, Material 3 Expressive design language.
Google Sans font family. Material Symbols outlined icons.
48dp minimum touch targets. Material You Dynamic Color with
primary seed color #6366F1. Navigation bar at bottom with
3-5 destinations. Top app bar with centered title.
Light theme with surface container hierarchy.
```

## Mobile-specific constraints checklist

Always include these in mobile UI prompts:

- "Touch targets minimum 44×44pt (iOS) / 48×48dp (Android)"
- "Bottom navigation bar for primary actions" (or specify nav pattern)
- "Thumb-friendly layout — critical actions in the bottom third"
- "Single-column layout" (unless tablet/desktop)
- "No text smaller than 14pt"
- "Include safe area padding for notched devices"
- "No horizontal overflow on mobile"
- "16px font minimum for inputs" (prevents iOS Safari zoom)
- "Maximum N UI elements visible" (prevents overcrowding)

## Screenshot-to-code best practices

When generating from a reference screenshot:

1. **Export at 2x resolution** — 1x Retina captures blur glyph edges
2. **Annotate distances directly on the image** — draw a red line between two elements and write the measurement
3. **Crop to the target component** — a tight crop outperforms a full screen
4. **Paste multiple images** — full-screen shot + close-up of target + another component using the same design language
5. **Name the exact target framework** — so output uses idiomatic, dependency-free code
6. **Run screen by screen** — do not paste a whole flow at once

## The mobile-first prompting strategy

Start every prompt with "mobile-first design" or "using mobile-first [framework] responsive breakpoints."

Describe each breakpoint as a separate visual state:
```
Mobile (base): Single column. Bottom tab bar with four icons.
  Content fills full width with 16px horizontal padding.
  Cards stack vertically with 12px gaps.
Tablet (md): Navigation moves to collapsible sidebar, 240px wide.
  Cards display in 2-column grid.
Desktop (lg): Sidebar always visible. Cards in 3-column grid.
  Add right sidebar (280px) for notifications.
```

Describe navigation separately from content. Navigation changes most dramatically across screen sizes.

## Common AI mobile UI mistakes and prevention

| Mistake | Prevention |
|---------|-----------|
| Desktop-first layout | Start with "mobile-first" |
| Fixed pixel widths | "Use relative widths, no fixed pixel widths wider than the mobile viewport" |
| Multi-column grids on mobile | "No more than 2 columns until lg (1024px)" |
| Hover-only interactions | "Tap to expand on mobile, hover on desktop" |
| Touch targets too small | "All buttons minimum 44px height" |
| Font sizes too small | "No text smaller than 14pt" |
| Ignoring safe areas | "Include safe area padding for notched devices" |
| Too many elements | "Maximum 6 UI elements visible" |
| Generic AI look | "Inspired by [real app name]" + specific token values |
| Inconsistent spacing | "All spacing from the 4pt grid: 4, 8, 12, 16, 20, 24, 32" |
