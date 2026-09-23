# Responsive calculations

Formulas and rules for layouts that hold from 320px phones to wide desktops. Pair with the breakpoint list your framework already ships; do not invent device-specific names.

## Breakpoint sourcing

Start from content failure, not from a phone model. Widen the viewport until a row wraps badly, a table overflows, or type loses its measure. Place a breakpoint just before that failure.

Typical starting points for a content site:

| Token | Min width | What usually breaks below it |
|---|---|---|
| sm | 640px | multi-column feature rows |
| md | 768px | side-by-side hero, two-up cards |
| lg | 1024px | sidebar plus main, dense tables |
| xl | 1280px | wide editorial grids, multi-pane tools |

Adjust after testing real copy lengths in the target language.

## Fluid type

Prefer clamp over breakpoint jumps for display sizes:

```text
font-size = clamp(min_size, preferred vw expression, max_size)
```

Example intent: body stays fixed at 16px; a headline runs from 28px on small screens to 48px on large ones with `clamp(1.75rem, 4vw + 0.5rem, 3rem)`. Convert the token scale to rem so user font settings still apply.

## Spacing and density

- Page gutters: `max(16px, (100vw - content_max) / 2)` keeps edges comfortable on mid widths.
- Section rhythm: one vertical scale (for example 8-unit steps) shared with the spacing tokens. Do not invent a second padding language for mobile only.
- Touch density: interactive rows grow padding on coarse pointers (`@media (pointer: coarse)`) until the hit box reaches 44 by 44 CSS pixels.

## Content-max and measure

```text
content_max = ideal_line_length * average_char_width
```

For 16px body text at roughly 0.5em average character width, 65 to 75 characters land near 520 to 600px. Article columns use that figure; application shells may go wider for tables and toolbars.

## Image and media rules

- Declare `aspect-ratio` on every thumbnail slot so late loads cannot shift layout.
- Prefer `object-fit: cover` for crops, `contain` for logos and diagrams that must stay whole.
- Full-bleed media uses `width: 100vw` only with overflow guards on the parent, or switch to a grid track that already spans the viewport.

## Container queries

When a component can appear in a sidebar and in a main column, size it with container queries instead of assuming the page breakpoint:

```css
.panel { container-type: inline-size; }
@container (min-width: 30rem) { .panel__row { display: grid; grid-template-columns: 1fr auto; } }
```

Fall back to page breakpoints when the host environment does not support container queries.

## Safe areas and dynamic viewports

Mobile browser chrome changes the visible height. For full-height heroes and fixed footers use `min-height: 100dvh` (dynamic viewport height) rather than `100vh`, and pad with `env(safe-area-inset-bottom)` where content can sit under system bars.

## Overflow audit

Before calling a layout done:

1. Set the viewport to 320px; no horizontal scrollbar from page content.
2. Zoom text to 200%; controls still reachable, no clipped labels.
3. Longest realistic word in each language wraps or truncates with a title.
4. Tables either reflow into stacked records or sit in a scroll container with a visible affordance.
