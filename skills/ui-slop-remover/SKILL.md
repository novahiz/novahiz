---
name: "ui-slop-remover"
description: "Strip generic AI-generated visual tells from UI before ship: default purple gradients, sparkle glyphs, centered pill heroes, identical card grids, fade-up motion, shadcn/Tailwind stock chrome. Use when building or reviewing any landing page, dashboard, or frontend component, or when the layout looks machine-assembled. Apply BEFORE every UI deliverable; pair with ui-craft-rules."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# ui-slop-remover

Generated interfaces converge on the same statistical average. Reviewers clock that average in under a second. This skill is the pre-ship pass that finds the tells and forces a real decision in their place.

Companion: `ui-craft-rules` builds the constructive choices (palette roles, type system, layout stress tests). This skill only deletes what gives the work away. Gate rule R13 loads both on design work.

## How to run the pass

1. Open the page (or the component in isolation) at 320px, 768px, and desktop.
2. Walk the tables below top to bottom. Every hit is a decision that was never made.
3. Replace each hit with a concrete choice from the product, the brand, or the content. Never swap one stock look for another stock look.
4. Re-check with the pre-ship list at the bottom.

A pattern is a problem when it is the *default* form with no product reason. The same pattern with a stated choice behind it (off-default hue, custom treatment, coherent with the rest of the screen) is craft. That test decides every line below.

## Color tells

| Tell | What it looks like | Replace with |
|---|---|---|
| Violet-indigo hero wash | `from-indigo-500 to-purple-500`, `#667eea` → `#764ba2`, gradient buttons | Flat brand field, photo, or a gradient that encodes a real direction (not the default two-stop) |
| Cream / beige "tasteful" second wave | Warm cream page + amber accent as the new reflex | A palette chosen from the product's domain, not from the anti-purple backlash |
| Emerald or amber reflex | Accent green or warm amber when the brief said nothing about either | One dominant hue + one accent, both justified in a one-line note |
| `gray-50` page (`#F9FAFB`) | Tailwind's stock background on every section | Tinted neutral (warm or cool) tied to the brand surface ramp |
| Neon-on-dark premium | Near-black + cyan/violet glow borders with no brand reason | Dark only if the product is dark-first; use a designed surface ramp, not pure `#000` |
| Rainbow chart cycle | Default library cycle on every series | Sequential or diverging ramp with stated semantic meaning |

## Chrome and component tells

| Tell | Replace with |
|---|---|
| 1px gray border + soft shadow on every card | Whitespace first, then a small background shift, then elevation. Border only if all three fail. Never a flat gray line as decoration |
| Colored 3-4px left strip on plain cards | Semantic state only (error, warning, selected). Never decoration |
| Identical card row (icon tile + bold subhead + two blurbs), usually three or four | Ledger, table, prose, or an asymmetric layout where one item dominates |
| Eyebrow pill / "New" chip above every centered H1 | Drop it, or one label that removes a real blocker for this audience |
| Gradient orb / blob / particle field behind hero | Empty space, product screenshot, or domain imagery |
| Lucide five repeated (Sparkles, Zap, Shield, Check, BarChart3) as the feature language | Domain icon for the actual feature, or no icon |
| Emoji as nav, bullets, or feature icons | One icon system (outline *or* filled), or text only |
| Nested card-in-card shells | Flatten: one surface level for the section, content sits on it |
| Placeholder avatars and stock "team at laptop" | Real faces with names, product UI, or leave the slot empty |
| Fake metric banners (invented "10k+ teams") | Numbers you can source, or remove the block |

## Typography and layout tells

- Inter, Geist, or Space Grotesk as the only face, or `system-ui` with no display cut. Pair a display with a body face chosen for tone; weight carries hierarchy, so a third family is usually unnecessary.
- The default size ladder (`text-5xl` hero, three equal columns, `max-w-7xl mx-auto py-24` on every band). Vary section padding; let at least one band break full-bleed or sit off-center.
- The centered stack hero: badge → oversized H1 → one-line subhead → gradient primary + ghost secondary. Anchor the primary action off-axis; give the headline an editorial measure (roughly 12-18 words per line at desktop).
- Title Case headings with emoji. Sentence case. No emoji in headings or list markers.
- Mobile treated as desktop stacked. Give narrow viewports their own hierarchy and navigation rhythm.

## Motion tells

| Tell | Replace with |
|---|---|
| Fade-up on scroll for every child, same 0.5s ease, flat stagger | Animate state changes (enter, exit, reorder, feedback), not the fact of scrolling |
| Hover `scale(1.05)` + shadow on every card | One hover language for the whole product; cards may only change surface |
| Infinite pulsing glow on CTAs | Short hover/focus transition (150-250ms) |
| Heavy parallax | A few pixels max, gated behind `prefers-reduced-motion` |
| Same spring on everything | Document duration and easing per property; reduced-motion path strips transforms |

Motion answers an interaction or guides attention. Scroll-in animation alone does neither.

## Copy red flags in the chrome

- Openers: "In today's fast-paced world", "Unlock the power of", "Empower your business".
- Pill trios under the hero (`No credit card` · `Free forever` · `24/7 support`) repeated in every section. Keep at most the pill that removes the actual blocker.
- Triple gerund columns ("Streamline. Analyze. Succeed."). Name the job the section does for the reader.

Fix copy that sits in the UI chrome. Long-form prose belongs to the humanizer pass.

## Tool signatures that shout the generator

When reviewing someone else's output (or cleaning a scaffold), note but do not auto-delete:

- Verbatim Tailwind stacks: `bg-gradient-to-br from-blue-600 to-purple-500`, `rounded-2xl shadow-lg p-6` everywhere, spacing only in `gap-4` / `p-6` / `my-8`.
- `shadcn/ui` stock classes and untouched `text-muted-foreground` tokens with no design system behind them.
- Visible generator badges in `<head>` (Lovable, v0 meta, "Built on …").

These lines point at evidence. The fix is still a real palette, type, and layout decision in the source component.

## Pre-ship checklist

Run on the final screenshot or live preview:

- [ ] No sparkle, wand, robot, or "AI-powered" badge in chrome or empty states.
- [ ] Hero is not a centered stack of badge, H1, subhead, two pills.
- [ ] No row of identical icon-tile cards.
- [ ] No default violet-indigo brand gradient unless the brand book says so.
- [ ] Cards are not uniform gray-bordered boxes.
- [ ] Scroll animations off or varied; page still reads with motion disabled.
- [ ] Body text contrast checked against its real background (not white in a picker).
- [ ] At least one concrete number, name, or product screenshot above the fold.
- [ ] Sentence-case headings; no emoji as structure.
- [ ] Narrow viewport has its own hierarchy, not a vertical dump.

If a check fails, fix the source component. Do not crop the screenshot.

## Sources

Field guides and primary design writing consulted for this catalogue: signs-of-ai-design (tell lifecycle, cream migration), Tundra Anti-AI UI Guide (decision test, card-grid ban), Vibe Code Kit anti-slop rules (DESIGN.md lock, palette cap, APCA), Sailop anti-AI design 2026 (dimension scoring), unslop preflight reference list. No third-party skill text is reused.
