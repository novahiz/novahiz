---
name: anti-AI-design
description: "Use when building any UI, landing page, dashboard, or frontend component to eliminate generic AI-generated design patterns. Detects and fixes visual tells that make sites look machine-made: purple gradients, sparkle icons, centered heroes, identical cards, fade-in-up animations. Apply BEFORE every UI deliverable."
---

# Anti-AI Design — Eliminate Machine-Made Tells

Every UI deliverable MUST pass this checklist before shipping. These patterns are detected by users in ~50ms and destroy trust.

---

## BANNED ICONS & EMOJIS

Never use these icons/emojis in feature sections, badges, or CTAs:

| Banned | Why | Replace With |
|--------|-----|-------------|
| Sparkle (✨) | Signature #1 of v0/Lovable AI output | Contextual icon to the product, or NO icon |
| Zap (⚡) for "fast" | Top 5 AI Lucide icon | Timer, or remove icon entirely |
| Shield (🛡) for "secure" | Default AI icon for any "secure" word | Lock, or text-only description |
| Rocket (🚀) in pill badges | AI pill badge pattern | Delete badge, or use plain text label |
| Fire (🔥) in pill badges | Same as rocket | Same |
| Check (✓) in tinted circles | shadcn Pricing example pattern | Simple check without circle, or bold text |
| BarChart3 for "analytics" | Top 5 AI icons | Donut, TrendingUp, or no icon |
| ArrowRight on all CTAs | Every AI button has an arrow | Remove arrow, or use distinct button style |
| Emoji in section headings | Inconsistent rendering, ignores brand color | Inline SVG with currentColor, stroke 1.5-2px |
| Terminal mockup with 3 macOS dots | Ultra-recognizable AI signature | Real product screenshot, or nothing |
| DiceBear/Pravatar avatars | Generated = fake = zero trust | Real photos, or remove avatars |
| 5 amber stars on testimonials | Always 5/5, always amber | Link to real source (G2, Capterra, App Store) |

---

## BANNED COLORS

### Primary Color
- NEVER use `#3B82F6` (blue-500) or `#6366F1` (indigo-500) as primary
- Use: Emerald (#10b981), Deep Rose, Amber, Teal, or a REAL brand color
- 60%+ of AI sites use blue-500 — it screams "nobody chose a brand color"

### Gradients
- NEVER use `from-purple-500 to-pink-500` (the strongest visual AI tell)
- NEVER use triple gradients `from-blue-500 via-purple-500 to-pink-500`
- NEVER use rainbow gradient text (3-stop rainbow on a word)
- FIX: Single solid accent, or gradient with <60° hue spread using analogous colors
- FIX: If gradient is essential — 2 stops max, analogous hues, modest saturation

### Shadows
- NEVER use purple-tinted shadows on cards
- FIX: Neutral diffusion: `shadow-[0_20px_40px_-15px_rgba(0,0,0,0.08)]`
- Color comes from the surface, not the shadow

### Backgrounds
- NEVER use pure `#fff` or `#000` — always add a tint
- NEVER use `slate-50` (#F8FAFB) — the most common AI background hex
- Use off-white with warmth: `#f5f0eb`, `#faf7f2`
- Use dark with tint: `#0a0a0a`, `#1a1a1e`

### Accent Budget
- Pick 3 accent colors maximum
- Each appears 3 times maximum on the page
- Total accent moments: 9 maximum
- More = slot machine = AI slop

---

## BANNED TYPOGRAPHY

| Banned | Why | Fix |
|--------|-----|-----|
| Inter weight 700 for display headlines | Default of every AI tool | Inter weight 400-500 at larger size (size does the work) |
| Inter alone, no pairing | Inter body = fine, Inter display = tell | Serif display (Fraunces, Playfair) + sans body |
| `text-[90px]` arbitrary px values | Bypasses type scale | `clamp()` for fluid typography |
| `tracking-wide uppercase` on eyebrow labels | The "here's thing" of AI pages | Sobre label, normal case, light weight |
| `text-gray-600` everywhere | Tailwind default = no color system | Semantic token: `text-secondary`, `text-muted` |
| System font stack as display | Last resort fallback | Geist, Satoshi, Cabinet Grotesque, IBM Plex |

### Typography Rules
- ONE display font + ONE body font — that's it
- Display weight: 500 maximum — let size do the work
- Body weight: 400 — readability
- Line-height: 1.1 on headings, 1.65 on body — NOT 1.5 everywhere
- Use `text-wrap: balance` on headlines

---

## BANNED LAYOUTS

| Banned | Why | Fix |
|--------|-----|-----|
| `grid-cols-3 gap-6 rounded-2xl shadow-md` | 71% of AI sites have exactly this | Asymmetric: 2+1, bento, unequal mosaic |
| Centered hero: H1 + p + 2 CTAs | Laziest AI hero composition | Left-aligned hero with editorial 7-5 or 8-4 grid |
| `rounded-2xl` on EVERYTHING | No hierarchy = flat | `rounded-none` (editorial), `rounded-[2px]`, `rounded-sm` — vary by class |
| `shadow-md` on all cards | Stripe-era Goldilocks shadow | `shadow-none`, `shadow-sm`, or 1px hairline border |
| `transition-all duration-300 ease-in-out` | The AI animation on everything | Custom curves: `cubic-bezier(0.22,1,0.36,1)`, variable durations |
| Identical vertical padding between sections | Metronome rhythm = template | Vary: 160px, 200px, 120px, 96px per section |
| `max-w-7xl` everywhere | AI default value | Deliberate: 1080px, 1200px, 1440px |
| Sticky nav with blur backdrop | Glassmorphism tell | Blur ONLY on overlays/modals, not every element |
| `fade-in-up` on every section | Motion slop — decorative without reason | Functional animations that communicate state |
| `opacity: 0, y: 20` then `opacity: 1, y: 0` | The AI scroll animation | No animation, or attention-guiding animation |

### Layout Rules
- At least 1 section must break the vertical rhythm (full-bleed, short, asymmetric)
- At least 50% of sections must use asymmetric layouts
- ONE "bold moment" per fold — not five competing visuals
- ONE border radius on the page — pick a system, apply consistently
- Section padding: 160px minimum (AI defaults use 64-96px)

---

## BANNED COPY PATTERNS

| Banned | Why | Fix |
|--------|-----|-----|
| "Build the future of work" | Generic hero copy | Say WHAT the product does specifically |
| "Scale without limits" | Same problem | Client language, not marketing language |
| "Seamless", "Robust", "Cutting-edge" | Empty superlatives | Concrete numbers, client names, use cases |
| "Empower", "Unlock", "Elevate" | AI default verbs | Specific action verbs |
| Em-dash in every sentence | AI copywriting signature | Use ; or . or — but rarely |
| "In today's fast-paced world" | Most cliché AI opening | Start with a fact, question, or direct statement |
| "Get started", "Learn more", "Watch demo" | Generic CTAs | Context-specific CTAs |
| Hedging: "May help you" | AI hedges to avoid being wrong | Assert: "This does X" |
| 5-star testimonials without source | Zero trust | Link to verifiable source |
| "Trusted by" with fake logos | Immediately fake | Real logos with permission, or nothing |
| 3 pricing tiers: Starter/Pro/Enterprise | AI pricing pattern | Value-based pricing, not tier comparison |

---

## BANNED STRUCTURES

| Banned | Why | Fix |
|--------|-----|-----|
| Navbar > Hero > Features > Testimonials > CTA > Footer | Template waterfall | Reorder, merge, break the sequence |
| FAQ accordion with chevron | Universal AI pattern | FAQ in prose, or alternating Q&A layout |
| Footer 4 columns: Product/Company/Resources/Legal | AI default footer | Minimal footer, or creative layout |
| Glassmorphism on everything | Glass = AI tell 2021-2026 | Blur ONLY on overlays/modals |
| `backdrop-filter: blur()` everywhere | Same | Same |

---

## BANNED CODE PATTERNS

| Banned | Why | Fix |
|--------|-----|-----|
| shadcn/ui defaults unmodified | Default tokens = no design system | Modify radius, colors, spacing, typography |
| Tailwind via CDN `<script>` | Non-production build signal | Normal CSS build (PostCSS, Tailwind CLI) |
| `data-v0-*` attributes | v0 brand in DOM | Remove after generation |
| "Made with Lovable" link | Lovable default footer | Disable in settings |
| `console.log` in production | Draft-state leak | Remove before push |
| `style=` inline attributes | Bypasses design system | Tailwind classes or CSS modules |
| Lucide icons in nav + CTAs | AI default icon library | Phosphor duotone, Tabler filled, or custom SVG |

---

## SELF-CRITIQUE CHECKLIST

Before shipping ANY UI, run this checklist:

1. Gradient check: Is it the same as 100 other sites? Change at least 1 stop
2. Cards check: Are the 3 cards identical? Make asymmetric
3. Hero check: Is it centered with H1 + p + 2 buttons? Left-align
4. Icon check: Is there a sparkle/rocket/fire? Delete or replace
5. Copy check: Does it say something specific to THIS product? Rewrite
6. Animation check: Do animations have a functional reason? Delete decorative ones
7. Avatar check: Are avatars real? Real photos or remove
8. Favicon check: Is it a globe/emoji? Custom favicon
9. 404 check: Is it the default Next.js/Vercel? Custom 404 page
10. Asymmetry check: Is there at least 1 asymmetric layout? Break the uniform grid
11. Color check: Are there more than 3 accent colors? Reduce to 3 max
12. Spacing check: Is every section the same padding? Vary the rhythm
13. Shadow check: Are shadows purple-tinted? Switch to neutral rgba(0,0,0,0.08)
14. Radius check: Is everything rounded-2xl? Mix rounded-none, rounded-sm, rounded-[2px]
15. Font check: Is Inter weight 700 the display font? Switch to weight 500 or pair with serif

---

## POSITIVE CRAFT SIGNALS

These patterns signal human craftsmanship and LOWER the AI score:

- Custom selection colors (`::selection` styled)
- Custom focus-visible states (not browser default)
- Proper dark mode palette (tested, not adapted from light)
- Semantic color tokens (not raw Tailwind values)
- Editorial typography (mixed weights 300/500/700, display face with intent)
- Real content density (600+ words on feature pages, not 80 words + 6 icons)
- Numbers, dates, version strings — proof of craft
- Negative space used aggressively — not everything needs a card
- At most one border-radius on the page — pick a system
- Reference images over adjectives — "Look at Linear's density" > "Make it premium"
