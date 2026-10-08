# Design System Reference

The full design system for Stitch-generated mobile screens. This is the deep reference; `SKILL.md` carries the summary.

## Three-tier token architecture

| Tier | Purpose | Example | Naming |
|------|---------|---------|--------|
| **Primitive** | Raw values, no meaning | `color.core.blue.500 = #3B82F6` | Value-descriptive |
| **Semantic** | Maps primitives to role | `color.action.primary = {color.core.blue.500}` | Role-descriptive |
| **Component** | Scoped to one component | `component.button.bg.primary = {color.action.primary}` | Component-scoped |

Reference direction is strictly downward. Primitives never reference other tokens. Semantic tokens reference primitives. Component tokens reference semantic tokens.

**Naming rule:** name semantic tokens by role, never by appearance. `color-text-secondary` survives a rebrand; `color-bright-blue` does not.

## Color tokens

**Primitive palette** — raw swatches by hue and lightness:
```
color.core.blue.500 = #3B82F6
color.core.gray.900 = #111827
color.core.gray.50  = #F9FAFB
```

**Semantic layer** — role-based:
```
color.text.primary        → {color.core.gray.900}
color.text.secondary      → {color.core.gray.600}
color.background.surface  → #FFFFFF
color.action.primary      → {color.core.blue.500}
color.feedback.error      → {color.core.red.600}
```

**Accessibility floors:**
- Body text on background: ≥ 4.5:1 (WCAG AA)
- Large text/headings: ≥ 3:1
- Interactive elements: ≥ 3:1
- Disabled states: opacity 0.38 (Material) or 0.3 (iOS HIG)

**Accent budget = 2.** One active tab + one primary action per screen. One accent color, used at most twice. This prevents the "everything is colorful" AI look.

## Typography tokens

Always define typography as composite groups, never standalone properties:

```json
{
  "font": {
    "heading": {
      "level-1": { "value": { "fontFamily": "{font.family.sans}", "fontSize": "32", "fontWeight": "700", "lineHeight": "40", "letterSpacing": "-0.5" } }
    },
    "body": {
      "large": { "value": { "fontFamily": "{font.family.sans}", "fontSize": "16", "fontWeight": "400", "lineHeight": "24" } }
    }
  }
}
```

**Platform mapping:**

| Platform | System Font | Scale Unit |
|----------|-------------|------------|
| iOS | SF Pro (Dynamic Type) | pt |
| Android | Roboto / Google Sans | sp/dp |
| React Native | Platform default | dp |
| Flutter | Platform default | sp |

**Line height:** body 1.4–1.6× font size; never below 1.2×.

## Spacing tokens

**Base unit: 4pt grid.** All spacing values are multiples of 4:

```
space.1 = 4px    (icon nudges, tight clusters)
space.2 = 8px    (dense lists, chips)
space.3 = 12px   (default element gaps)
space.4 = 16px   (section spacing, card padding, screen edge)
space.5 = 20px   (screen gutters, hero spacing)
space.6 = 24px   (large section breaks)
space.8 = 32px   (page transitions, hero layouts)
space.10 = 40px  (major section separation)
```

**Screen edge padding:** default `space.4` (16px), one value kept consistent across all screens.

## Radius tokens

```
radius.sm   = 4px    (small chips, tags)
radius.md   = 8px    (buttons, inputs, default)
radius.lg   = 12px   (cards, dialogs)
radius.xl   = 16px   (bottom sheets, large cards)
radius.2xl  = 24px   (hero cards, feature cards)
radius.full = 9999px (pills, avatars, circular buttons)
```

**iOS rule:** pair every non-capsule radius with `borderCurve: "continuous"`.

## Shadow / elevation tokens

**iOS (subtle, layered):**
```
shadow.sm: offset(0,1) blur(3) opacity(0.08)
shadow.md: offset(0,4) blur(12) opacity(0.10)
shadow.lg: offset(0,8) blur(24) opacity(0.12)
```

**Dark mode rule:** elevation is achieved through background color (darker = lower, lighter = higher), not box-shadow.

## Design brief structure

Every screen prompt includes a design system brief extracted from the first screen:

```
Design system brief (established):
- Background: dark navy (#0A1628)
- Headings: white, Fraunces Serif Bold
- Body text: white at 70% opacity
- Primary action color: teal (#00C896)
- Card corner radius: 16px
- Bottom tab navigation: 5 tabs (Home, Explore, Create, Library, Profile)
- Spacing: 8px grid (8, 16, 24, 32, 48)
```

**Highest-impact brief elements:**

| Element | Impact |
|---------|--------|
| Reference apps by name | Very High |
| Exact measurements | Very High |
| Real content (not lorem ipsum) | High |
| Element count limits | High |
| Mood statement | Medium-High |
| Explicit "don'ts" | Medium |
| Platform specification | Medium |

## Screen archetypes

A mobile screen does one job. Map the brief to exactly one archetype:

| Brief language | Archetype |
|----------------|-----------|
| feed, inbox, timeline, list, messages | Feed |
| article, post, item, recipe, product detail | Detail |
| sign-up, welcome, intro, walkthrough | Onboarding |
| profile, account, user page, bio | Profile |
| checkout, payment, order, form, settings step | Checkout |
| timer, map, dashboard widget, single big number | Focus / Hero card |

If the brief combines two archetypes, ship one screen and offer the other as a follow-up.

## Component state matrix

Every component must define all states:

| State | Visual treatment |
|-------|-----------------|
| default | Base token values |
| pressed | Slightly darker background, scale 0.98 |
| focused | Focus ring or border highlight |
| disabled | Opacity 0.38, no interaction |
| loading | Spinner or skeleton, reduced opacity |
| error | Error color + icon + message |
| selected | Accent background or border |

## Platform-specific patterns

| Element | iOS (HIG) | Android (Material 3) |
|---------|-----------|---------------------|
| Navigation | Tab bar + large title | Bottom nav + top app bar |
| Primary action | Trailing toolbar button | FAB |
| Touch targets | ≥ 44×44pt | ≥ 48×48dp |
| Safe area | 44pt top, 34pt bottom | 24pt top, 48pt bottom |
| Cards | No native card view | ElevatedCard |
| Sheets | Sheet with detents | ModalBottomSheet |

## Anti-pattern rules (machine-checkable)

Rules must be precise and checkable:

```
BAD:  "Avoid harsh colors"
GOOD: "NEVER use a color value not present in the color token system"

BAD:  "Make buttons look nice"
GOOD: "Button height must be one of: 32, 44, 48, 56pt"

BAD:  "Use appropriate spacing"
GOOD: "All spacing values must be multiples of 4pt from the spacing scale"
```
