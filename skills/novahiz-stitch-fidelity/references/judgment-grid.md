# Judgment grid

Run every reachable screen through these eight lines. Each line ends with **PASS** or **DIVERGE**,
and a DIVERGE carries a measurement: px, dp (after `adb.density`), hex, or token name. A verdict
without a number is a guess — discard it.

## 1. Layout and hierarchy

- Same skeleton as the reference: header, primary block, action zone, tab bar. No extra block, no
  missing block.
- Measure with the anchor bounds from `<id>.bounds.json`, not by eye. Overlay the reference at the
  same device width and compare the block edges.

## 2. Spacing and rhythm

- Padding, gaps and margins equal the reference within 1 dp. Report the delta in dp *and* px.
- Rhythm: the vertical gaps inside a stack are consistent with each other, not just with the ref.

## 3. Color and surfaces

- Every fill matches a design token (`tokens.ts`, `theme`, `ColorScheme`) — no raw hex in a screen
  file that duplicates an existing token.
- Opaque vs translucent: a scrim or sticky footer must be opaque or explicitly conditional. A
  `rgba()` backdrop painted outside its modal is a DIVERGE even when the modal is closed.
- Check the reference at full resolution for subtle tints; a thumbnail hides them.

## 4. Typography

- Sizes, weights and line heights match the reference token scale. Compare the token values against
  the reference's own type ramp, not against each other.
- No default platform font creeping in where the project declares one.

## 5. Copy

- Strings identical to the reference: wording, punctuation, casing, plural.
- Project forbidden-terms list respected (for a West-African FCFA app: no supranational-institution
  names in product copy). Exact match required — this line has zero tolerance.

## 6. States

- Whatever state the reference shows (empty, loading, error, disabled, focused) exists in the build,
  and a state the reference does *not* show is not painted unconditionally.

## 7. Native-ness

- Real platform components (native button, native list row) instead of web-shaped markup. Nested
  interactive elements, `<div>`-style wrappers, and browser-only behaviour are DIVERGE.

## 8. Gesture and safe-area clearance

- Bottom action bars clear the system gesture area: measure the distance from the last interactive
  element to the screen bottom in px, convert to dp, and compare with the reference.
- Pattern to check in code: `paddingBottom` driven by an inset **plus** a constant (`max(inset, 16) +
  32`), never the raw inset value.
- No tappable control within 8 dp of another (fat-finger collisions).

## Tolerance policy

| Dimension | Tolerance |
|---|---|
| Copy | exact |
| Colors | exact token match |
| Layout blocks, spacing | 1 dp |
| Gesture clearance | must exceed the device inset |

Anything outside tolerance is DIVERGE. When two lines disagree (looks right, measures wrong),
**the measurement wins**.
