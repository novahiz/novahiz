# Accessibility notes for Apple platform audits

What to check on every screen, which numbers the checker script can verify, and which items need human or agent judgment against the live HIG.

## Contrast

- Normal text against its background: at least 4.5:1 for WCAG-derived AA parity; Apple contrast guidance aligns for body content.
- Large text (roughly 18pt regular or 14pt bold and up): at least 3:1.
- Non-text UI (icon strokes, focus indicators, control boundaries): at least 3:1 against adjacent colors.

```bash
python scripts/hig_checker.py --pair "#FFFFFF|#1C1C1E"
```

Placeholder text and disabled controls still need a visible shape; do not rely on near-invisible gray alone for affordances the user must find.

## Type size and Dynamic Type

- Default body styles should not be replaced by fixed tiny sizes.
- Spot-check accessibility sizes (largest content categories) for clipping, truncation of critical words, and overlapping controls.
- ```bash
  python scripts/hig_checker.py --text-pt 17
  ```

## Hit targets

- Primary touch targets on iOS and related platforms: about 44 by 44pt as the standard floor; keep adjacent targets from merging into one ambiguous zone.
- ```bash
  python scripts/hig_checker.py --target-mm 44
  ```
- On macOS, clickable regions can be smaller when pointer precision helps, but icon-only toolbar buttons still need clear hover and focus states.
- Indirect input (visionOS eye + pinch) benefits from extra hit slop; treat the 44pt figure as a floor, not a target to graze.

## VoiceOver and labels

- Every control exposes a role and a name. Icon-only buttons: `accessibilityLabel` describing the action, not the glyph ("Compose", not "pencil").
- Decorative images: mark accessibility hidden; informative images: short description or adjacent text that already covers the info.
- Reading order matches visual order; modal content traps focus until dismissed (system sheets already do this; custom overlays must replicate it).
- Updates after async work announce politely when the user needs to know (save succeeded, upload failed).

## Focus and keyboard (macOS and keyboard-driven iPad)

- Focus ring visible on every interactive element; never removed without a replacement style.
- Tab order follows the visual hierarchy; no positive `tabIndex` style traps.
- Escape dismisses transient layers; arrow keys move within segmented controls and lists where the platform expects it.

## Motion sensitivity

- Reduce Motion on: large parallax, zoom transitions, continuous ambient animation should stop or degrade to opacity changes.
- Blinking or strobing content must not exceed safe thresholds; avoid rapid full-screen flashes entirely.

## Color independence

- Status is never hue-only: pair color with icon shape, text label, or pattern.
- Charts: direct labels or a legend with pattern differentiation for common color-vision deficiencies.

## Forms and errors

- Error text sits next to the field, linked programmatically, and summarizes at the top when many fields fail.
- Labels remain visible after typing (floating or persistent); placeholder-only labeling fails as soon as the user enters data.
- Secure text fields expose the show-password control with a proper accessibility name.

## Audit workflow

1. Run the script for each measured pair, target, and critical type size; paste output into the template.
2. Walk VoiceOver (or the accessibility inspector) on the three most important flows: launch, primary task, recovery from error.
3. Toggle Reduce Motion and dark mode; note any screen that breaks.
4. Mark each finding fail, concern, or note with the HIG section that backs it.

## Common fail patterns

| Pattern | Why it fails |
|---|---|
| Gray helper text at 10pt on white | contrast and size floor |
| Icon-only nav without labels | VoiceOver silence |
| Custom tab bar without system semantics | wrong roles, lost VoiceOverRotor behavior |
| Focus outline `outline: none` with no substitute | keyboard users lose position |
| Success green toast with no icon or words | color-only status |
