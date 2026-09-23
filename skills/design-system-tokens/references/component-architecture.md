# Component architecture patterns

How to document each component so design and engineering read the same sheet. Fill one block per component in the handoff packet (or link to the storybook page that holds it).

## Anatomy

List the layers a consumer can see or slot:

- **Root**: outer container, background, border, radius tokens.
- **Slot A / Slot B**: named regions (leading media, trailing action, label).
- **Overlays**: tooltips, popovers, menus; note their z-index token.
- **State surfaces**: focus ring, pressed fill, error border; each bound to a token path.

Draw a simple ASCII tree when nesting is more than two levels:

```text
Card
├── Media (optional)
├── Body
│   ├── Title
│   └── Meta
└── Actions (optional)
```

## Variants

Name the axis, not the appearance:

| Axis | Values |
|---|---|
| emphasis | primary, secondary, tertiary |
| density | comfortable, compact |
| shape | rectangle, pill |

Appearance names (`blue-button-2`) hide the decision and break when the palette changes.

## State matrix

Every interactive component ships this table. Blank cells are bugs.

| State | Visual | Interaction | A11y |
|---|---|---|---|
| default | token bindings | idle | role, accessible name |
| hover | delta from default | pointer only | not required alone |
| focus | focus ring token | keyboard | visible ring, 3:1 against surface |
| active | pressed token | pointer down | `aria-pressed` when toggle |
| disabled | muted tokens | no events | `aria-disabled` or native |
| loading | skeleton or spinner | blocks double submit | `aria-busy` |
| error | danger border/text | shows message | `aria-describedby` link |

## Token bindings

Write paths, never literals:

```text
background -> color.surface.raised
border     -> color.border.subtle
text       -> color.text.primary
padding    -> space.4
radius     -> radius.md
```

If a component needs a one-off value, promote it to a token instead of inlining hex or px.

## Accessibility notes

Record in plain sentences:

- semantic role (button, link, listitem, tab) and what happens if you swap it,
- accessible name source (visible label, `aria-label`, `aria-labelledby`),
- keyboard map (Tab order, arrow keys inside composite widgets, Escape to dismiss),
- announcement behavior for async updates (polite live region or none).

## Composition rules

- Prefer one public component with variants over three near-copies.
- Children slots accept tokens; the parent owns layout, the child owns type and color roles.
- Do not let a leaf component import another feature's leaf; share through the system package.

## Change log line

At the bottom of each component doc, one line per release:

```text
2026-09: compact density gains 4px vertical padding; focus ring switched to motion.easing.standard timing.
```

Reviewers scan this first when something looks different after an upgrade.
