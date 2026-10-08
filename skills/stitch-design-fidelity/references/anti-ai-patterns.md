# Anti-AI-Pattern Reference

The AI-slop catalogue. Every generated screen is checked against these. A pattern is a problem when it is the **default form with no product reason**. The same pattern with a stated choice behind it (off-default hue, custom treatment, coherent with the rest of the screen) is craft.

**Root cause:** distributional convergence. Given vague prompts, AI returns the statistical average of training data. Users identify AI-generated interfaces within 2-3 seconds, and that perception lowers trust.

## The substitution test

If you can swap the product name with a competitor and nothing changes, the design is too generic. Apply this test to every screen.

## Color tells

| Tell | What it looks like | Replace with |
|---|---|---|
| Violet-indigo hero wash | `from-indigo-500 to-purple-500`, `#667eea` → `#764ba2` | Flat brand field, or a gradient that encodes a real direction |
| Cream / beige second wave | Warm cream page + amber accent as the new reflex | A palette chosen from the product's domain |
| Emerald or amber reflex | Accent green or warm amber when the brief said nothing | One dominant hue + one accent, both justified |
| `gray-50` page (`#F9FAFB`) | Tailwind's stock background on every section | Tinted neutral tied to the brand surface ramp |
| Neon-on-dark premium | Near-black + cyan/violet glow borders | Dark only if the product is dark-first |
| Rainbow chart cycle | Default library cycle on every series | Sequential or diverging ramp with semantic meaning |

## Chrome and component tells

| Tell | Replace with |
|---|---|
| 1px gray border + soft shadow on every card | Whitespace first, then background shift, then elevation. Border only if all three fail |
| Colored 3-4px left strip on plain cards | Semantic state only (error, warning, selected). Never decoration |
| Identical card row (icon tile + bold subhead + two blurbs) | Ledger, table, prose, or asymmetric layout where one item dominates |
| Eyebrow pill / "New" chip above every centered H1 | Drop it, or one label that removes a real blocker |
| Gradient orb / blob / particle field behind hero | Empty space, product screenshot, or domain imagery |
| Lucide five repeated (Sparkles, Zap, Shield, Check, BarChart3) | Domain icon for the actual feature, or no icon |
| Emoji as nav, bullets, or feature icons | One icon system (outline *or* filled), or text only |
| Nested card-in-card shells | Flatten: one surface level for the section |
| Placeholder avatars and stock "team at laptop" | Real faces with names, product UI, or leave the slot empty |
| Fake metric banners (invented "10k+ teams") | Numbers you can source, or remove the block |
| Pill-shaped buttons everywhere | Radius scale: buttons 6-10px, cards 8-12px, pills only for tags/chips |
| Icon in a tint of itself | Let icons inherit text color, no container |
| AI-drawn SVG icons (blob faces) | Real icon set (Lucide, Phosphor, SF Symbols, Material Symbols) |
| Inconsistent icon styles | One library, one style (outlined OR filled, consistent weight) |

## Typography and layout tells

- **Inter everywhere** (73% of AI frontends): choose a distinctive display font for headlines; Inter only for body at 400-500.
- **Flat type hierarchy:** every heading the same size. Create a clear type scale with weight contrast.
- **Centered everything:** left-align body text; center only when it serves a purpose.
- **Default size ladder** (`text-5xl` hero, three equal columns, `py-24` on every band): vary section padding; let one band break full-bleed.
- **Title Case headings with emoji:** sentence case, no emoji in headings.
- **Mobile-treated-as-desktop-stacked:** give narrow viewports their own hierarchy.
- **Excessive letter spacing on labels:** only on large uppercase display labels, never body text.

## Motion tells

| Tell | Replace with |
|---|---|
| Fade-up on scroll for every child, same 0.5s ease | Animate state changes, not the fact of scrolling |
| Hover `scale(1.05)` + shadow on every card | One hover language; cards may only change surface |
| Infinite pulsing glow on CTAs | Short hover/focus transition (150-250ms) |
| Heavy parallax | A few pixels max, gated behind `prefers-reduced-motion` |
| Same spring on everything | Document duration and easing per property |
| Springy hover on everything | Micro-interactions that communicate state changes |

## Copy red flags in the chrome

- Openers: "In today's fast-paced world", "Unlock the power of", "Empower your business".
- Pill trios under the hero repeated in every section. Keep at most the pill that removes the actual blocker.
- Triple gerund columns ("Streamline. Analyze. Succeed."). Name the job the section does.
- Vague SaaS headlines: "Supercharge your workflow", "Scale without limits". Use specific, concrete claims.
- Generic "Live" / "New" badges: badge only genuine status.
- "Trusted by" logo bar: use real testimonials with real names, or remove.
- Gradient "Most Popular" pricing pill: use a simple border or text label.

## Missing states (the clearest signal)

Only the happy path is designed. Real apps load, fail, and start empty.

Design every component with 8 states: **default, hover, focus-visible, active, disabled, loading, empty, error.**

- Empty states explain what should appear, show how to make it appear, give a starting action.
- Loading states use skeleton placeholders, not spinners.
- Error states are written in human language with a recovery path.
- Test with real data: long usernames, truncated text, network failures.

## Placeholder content

"Lorem ipsum", "User Name", "Item 1, Item 2" hide hierarchy and density problems. Use realistic data. Test with edge cases. Design for the worst-case content.

## Tool signatures that shout the generator

- Verbatim Tailwind stacks: `bg-gradient-to-br from-blue-600 to-purple-500`, `rounded-2xl shadow-lg p-6` everywhere.
- `shadcn/ui` stock classes and untouched `text-muted-foreground` tokens with no design system behind them.
- Visible generator badges in `<head>` (Lovable, v0 meta, "Built on …").

## Pre-ship checklist

Run on the final screenshot or live preview:

- [ ] No sparkle, wand, robot, or "AI-powered" badge in chrome or empty states.
- [ ] Hero is not a centered stack of badge, H1, subhead, two pills.
- [ ] No row of identical icon-tile cards.
- [ ] No default violet-indigo brand gradient unless the brand book says so.
- [ ] Cards are not uniform gray-bordered boxes.
- [ ] Scroll animations off or varied; page still reads with motion disabled.
- [ ] Body text contrast checked against its real background.
- [ ] At least one concrete number, name, or product screenshot above the fold.
- [ ] Sentence-case headings; no emoji as structure.
- [ ] Narrow viewport has its own hierarchy, not a vertical dump.
- [ ] All 8 component states designed (default, hover, focus, active, disabled, loading, empty, error).
- [ ] No lorem ipsum or placeholder content.
- [ ] Passes the substitution test.

If a check fails, fix the source component. Do not crop the screenshot.

## Sources

vibecoded-design-tells (3.2M Reddit posts), noqta.tn, SmoothUI, Superdesign, MeDo Blog, arXiv 2605.15124, arXiv 2607.22928, impeccable.style, v-1.design, developersdigest.tech, kostac (hey.com).
