---
name: "anti-AI-design"
description: "Use when building any UI, landing page, dashboard, or frontend component to eliminate generic AI-generated design patterns. Detects and fixes visual tells that make sites look machine-made: purple gradients, sparkle icons, centered heroes, identical cards, fade-in-up animations. Apply BEFORE every UI deliverable."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# Machine tells in UI work

Run a pass over this list before any interface leaves your hands. Reviewers and end users read these cues as signs the page was assembled by a model. Fixing the cue after launch costs more trust than fixing it in the draft.

Companion skill: `frontend-design-taste` covers constructive choices (palette, composition, motion). This one strips the signatures that give the work away. R13 loads both together.

## Signature marks to purge

Glyphs that read as product logos for generators rather than as interface furniture:

| Glyph or badge | Replace with |
|---|---|
| Sparkles, wand bursts, "AI powered" lozenges in hero zones | Domain icon for the feature, or omit decoration |
| Generic robot head as feature art | Real screenshot, product mark, or empty space |
| Star rows used as filler next to invented social proof | Verified customer quote with name and role, or drop the block |

If the mark would appear unprompted in a prompt demo, it does not belong in a client deliverable.

## Layout habits that smell synthetic

1. **Dead-center hero with two pill buttons.** Anchor the primary action off-axis. Give the headline an editorial measure (roughly 12 to 18 words per line at desktop width) and let supporting copy sit asymmetrically.
2. **Grid of six identical rounded cards.** Break the rhythm: vary span, hierarchy, or density across the row. One card may dominate; others may be list rows.
3. **Section stack of equal-height bands with a centered title plus three columns.** Alternate orientation. Use a full-bleed break, a sidebar, or a two-column measure at least once per scroll.
4. **Everything floating in max-width 1200px with nothing bleeding to edges.** Full-bleed imagery, rules, or color fields restore scale.

## Color signatures

- The violet-to-indigo gradient (often `#667eea` into `#764ba2`, or close relatives) used as hero wash, button fill, or chart accent. Swap for a brand hue drawn from the product domain, or a flat field with texture from photography.
- Near-black background plus one neon accent as the default "premium" mode without a reason tied to the brand.
- Rainbow chart palettes pulled from default library cycles. Constrain charts to a sequential or diverging ramp with a stated semantic meaning.

## Motion defaults

- Scroll-triggered fade-up on every child with the same 0.5s ease and 100ms stagger. Motion should answer an interaction or guide attention, not decorate entry.
- Infinite pulsing glow behind CTAs. Prefer a state change on hover or focus with a short transition (150 to 250ms).
- Parallax layers that shift more than a few pixels on scroll. Heavy parallax reads cheap and hurts motion-sensitive users; gate it behind `prefers-reduced-motion`.

## Copy and iconography red flags

- Feature blurbs that open with "In today's fast-paced world" or "Unlock the power of". Rewrite around a concrete outcome the user can verify.
- Pill badges under the hero (`No credit card`, `Free forever`, `24/7 support`) repeated as a trio on every section. Keep at most the one that removes the actual blocker for this audience.
- Icon column titled with three parallel gerunds ("Streamline. Analyze. Succeed."). Name the job the section does for the reader instead.

## Pre-ship checklist

Run these checks in order on the final screenshot or live preview:

- [ ] No sparkle, wand, or AI badge glyph anywhere in chrome or empty states.
- [ ] Hero is not a centered stack of headline, subhead, two pills.
- [ ] No row of six or more cards identical in size, radius, and illustration style.
- [ ] No violet-indigo brand gradient unless the brand book says so.
- [ ] Scroll animations disabled or varied; page still communicates meaning with motion off.
- [ ] Every decorative icon maps to a real feature; empty slots removed.
- [ ] Section titles are sentence case; no emoji in headings or list markers.
- [ ] Specific numbers, names, or screenshots appear somewhere above the fold.

If a check fails, fix the source component, not the screenshot.

## Pairing note

R13 treats `anti-AI-design` and `frontend-design-taste` as one unit. Load both when the task touches production UI. This file handles removal of tells; the companion handles deliberate craft decisions that replace them.
