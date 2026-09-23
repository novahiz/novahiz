---
name: "apple-hig-audit"
description: "Audits and designs iOS/macOS/watchOS/visionOS interfaces against the Apple Human Interface Guidelines, including the Liquid Glass design language (announced WWDC25, shipped with iOS 26/macOS Tahoe, Sept 2025). Use when reviewing an Apple-platform mockup or app for HIG compliance, checking contrast or tap-target sizes, or designing native-feeling Apple UI (e.g., 'audit my iOS app against the HIG', 'is this text readable on Liquid Glass?')."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# Apple platform interface review

Judge or author iOS, macOS, watchOS, and visionOS UI against the Human Interface Guidelines at [developer.apple.com/design/human-interface-guidelines](https://developer.apple.com/design/human-interface-guidelines). The guidelines move with each OS train; when a hard number matters (minimum hit target, contrast rule, type ramp), confirm on the live HIG page rather than trusting a cached summary in `references/`.

Liquid Glass, introduced at WWDC25 and shipping from iOS 26 and macOS Tahoe (September 2025), changes material, depth, and control rendering. Treat older screenshots as pre-Glass until proven otherwise.

## Intake

If `product-context.md` or `ios-design-context.md` exists in the project, read both before asking anything. Otherwise capture:

1. Platform and minimum OS version.
2. Mode: greenfield design or audit of an existing mockup or codebase.
3. App category (utility, productivity, game, social, and so on), which drives density and animation expectations.

## Two modes

### Design mode

Produce native-feeling layouts: system type styles where possible, standard navigation patterns (navigation stack with back affordance, tabs for peer destinations, sheets for scoped tasks), platform-correct controls instead of web stand-ins. SwiftUI snippets target iOS 26 and later when they use Glass modifiers; document the fallback for earlier deployment targets.

### Audit mode

Walk the screen inventory with `templates/hig-audit-template.md`. For each screen record findings as pass, concern, or fail with a cited guideline section. Mechanical checks (contrast ratios, hit-target sizes, type sizes against the platform ramp) run through `scripts/hig_checker.py`, stdlib Python only:

```bash
python scripts/hig_checker.py --pair "#FFFFFF|#1C1C1E" --target-mm 44 --text-pt 17
```

Output is a short report the template can paste. Visual and interaction judgment still requires a human or agent review pass.

## Reference shelf

| File | Use it for |
|---|---|
| `references/visual-design.md` | Layout, materials including Liquid Glass, iconography, motion |
| `references/accessibility.md` | Contrast, Dynamic Type, VoiceOver labels, reduce-motion paths |
| `references/platform-specifics.md` | Per-platform differences: notch and safe areas, macOS pointer, watch crowns, visionOS windows |

Cross-check anything that changed after 2025 against the live HIG URL for that topic.

## Severity scale

- **Fail**: breaks an explicit HIG requirement (missing back affordance, text below minimum size, contrast under threshold for its role).
- **Concern**: discouraged pattern or fragile practice likely to fail review (custom tab bar that hides system behavior, animation without reduce-motion path).
- **Note**: preference or polish opportunity; does not block ship.

## Deliverable

A completed audit template plus, when design mode produced code, the SwiftUI files with deployment-target notes. State clearly which checks were automated and which were judged by eye.

## Freshness rule

HIG pages for Liquid Glass, navigation, and materials are revised often. Before final delivery, re-open the cited sections once. If a claim in `references/` disagrees with the live page, the live page wins; flag the reference for update in the report.
