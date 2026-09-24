# Tell catalogue (expanded)

Quick lookup when the SKILL.md tables are not enough. Same decision test: stock form with no product reason = tell; same pattern with a stated choice = craft.

## Color families

### Second-wave defaults

Purple gradients were the first default. Cream with amber followed, then emerald when teams banned purple in writing. Any of the three arriving unprompted is still a default.

Check: does the hue appear in the product mark, a brand doc, photography, or domain imagery? If not, pick one that does.

### Surface ramps

`#F9FAFB` and pure `#fff` / `#000` are the laziest surfaces. Build a short ramp: page, raised, sunken, border. Tint warm or cool on purpose. Inverting light mode for dark is not a ramp design.

## Layout skeletons that converge

1. Centered hero: pill badge, H1 ≥64px, one-line subhead, gradient primary + ghost secondary.
2. Three (never two, never four) feature cards: icon tile, bold subhead, two-line blurb.
3. Stat banner: three or four big numbers with tiny labels.
4. Logo marquee, testimonials with five stars, pricing trio, FAQ, footer.
5. Every section `max-w-7xl mx-auto py-24 px-6`.

Break at least three of these on a long landing page. Prefer: left-aligned editorial hero, definition list or table for features, one full-bleed band, asymmetric measure.

## Icon language

The "Lucide five" (Sparkles, Zap, Shield, Check, BarChart3) on unrelated products is a herd signal. Emoji as icons is stronger still: rare in hand-built professional UI.

Rule: one set, one weight (outline *or* filled), every icon either names a real feature or comes out.

## Motion catalog

| Pattern | Problem | Direction |
|---|---|---|
| Fade-up every section | Decorates scrolling | Enter/exit/reorder only |
| Uniform 0.1s stagger | Mechanical | Vary by hierarchy or drop stagger |
| Glow pulse CTA | Distracts, fails reduced-motion | State change 150-250ms |
| Parallax > few px | Cheap + vestibular risk | Near-static or removed |

Always ship a `prefers-reduced-motion` path that keeps meaning without transforms.

## Type

- Display and body pair chosen for tone; avoid Inter-only by reflex.
- One modular scale (×1.25 apps, ×1.333 editorial). Body ≥16px.
- Measure 45-75 characters for reading text.
- Tracking tighter on display, looser on small captions.

## Review order

1. Screenshot at three widths.
2. Color pass (hue reasons, surfaces, contrast).
3. Chrome pass (cards, borders, badges, icons).
4. Motion pass (with reduced-motion on).
5. Copy pass on chrome strings only.
6. Run `scripts/slop_lint.mjs` on the source tree for HIGH hits you missed by eye.
