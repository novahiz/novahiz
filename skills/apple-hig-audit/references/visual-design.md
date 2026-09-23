# Visual design notes for Apple platforms

Layout, materials, icons, and motion as the Human Interface Guidelines describe them for current OS trains. Numbers marked as hard requirements should be re-checked on the live HIG page before an audit ships.

## Layout fundamentals

- Respect safe areas. On notched iPhones and on Macs with camera housings, content that can sit under system chrome gets top and bottom insets; fixed toolbars use the system safe area guides in SwiftUI (`safeAreaInset`) rather than magic padding constants.
- Margins scale with the device class. Compact widths use tighter leading/trailing margins; regular widths open up. Do not lock one margin across phone and pad.
- Prefer system-provided layout guides (stacks, grids, safe areas) over absolute frames. Absolute positions break under Dynamic Type and localization.

## Hierarchy and scannability

- One primary action per view where the task allows it. Secondary actions demote to toolbar menus or contextual rows.
- Group related controls; separate unrelated ones with spacing, not with heavier borders everywhere.
- Titles describe the content or task. Avoid marketing phrasing in navigation bars.

## Materials and depth (including Liquid Glass)

Liquid Glass (iOS 26, macOS Tahoe and later) layers translucent materials over content with specular highlights and adaptive blur. Practical rules:

- Use the system material APIs for bars, sheets, and floating controls; hand-rolled blurs miss adaptive tinting and accessibility reductions.
- Text on glass needs a legible contrast path: system materials already adjust, but custom glass must still pass contrast against the content scrolling underneath.
- Depth should encode stacking order (modal above page, popover above toolbar). Decorative depth without a stacking reason reads as noise.
- On earlier OS targets, fall back to standard system materials (regular, thick, ultraThin) and note the fallback in the audit.

## Typography

- Start from text styles (`Large Title`, `Title`, `Headline`, `Body`, `Footnote`) so Dynamic Type works without per-label math.
- Reserve custom faces for brand moments (logo wordmark, marketing screens); product UI sticks to San Francisco through the text styles.
- Minimum sizes: body content should not ship below the platform floor for its style; very small labels belong in Footnote or Caption styles, not in arbitrary pixel sizes.

## Iconography

- Use SF Symbols where a system symbol exists; keep weight and scale consistent within one toolbar or row.
- Custom icons align to the symbol grid (cap height, optical centering) so mixed rows do not look misaligned.
- Do not recolor symbols into arbitrary brand fills on standard controls; tint with semantic colors (`primary`, `secondary`, accent).

## Color

- Support light and dark appearances with semantic color sets (`systemBackground`, `label`, `secondarySystemFill`) rather than single hexes.
- Accent color drives tintable controls (buttons, switches, selection). One accent per app unless a documented multi-brand need exists.
- Charts and status colors follow system semantics: green success, yellow warning, red danger, blue info, with dark-mode variants.

## Motion

- Match system curves for standard transitions; custom curves only when the interaction is brand-critical.
- Duration: micro feedback under about 0.3s; view transitions in the 0.35 to 0.5s band; longer only for spatial storytelling that needs it.
- Respect Reduce Motion: swap parallax, zoom, and large spatial moves for crossfades or instant state changes.
- Interruptible animations: user gesture during a transition should cancel or reverse cleanly, not freeze.

## Density by platform

| Platform | Density bias | Notes |
|---|---|---|
| iPhone | Comfortable, thumb-reachable | Primary actions low on screen when modal |
| iPad | More columns, more chrome | Pointer and pencil targets still 44pt |
| macOS | denser rows, menu bar actions | Prefer menus over long toolbars |
| watchOS | very sparse, large glyphs | One task per glance |
| visionOS | windows and volumes, indirect input | Eye + pinch targets need generous hit slop |

## Checklist before calling a screen done

- [ ] Safe areas respected on every edge that can collide with system UI.
- [ ] Text styles in use; Dynamic Type at accessibility sizes does not clip.
- [ ] Dark mode pass completed with semantic colors.
- [ ] Symbols and custom icons optically aligned in the same row.
- [ ] Motion has a Reduce Motion fallback.
- [ ] Liquid Glass modifiers (when targeting 26+) verified on device, not only in previews.
