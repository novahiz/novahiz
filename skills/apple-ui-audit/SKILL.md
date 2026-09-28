---
name: "apple-ui-audit"
description: "Audit iOS/macOS/watchOS/visionOS interfaces against Apple HIG and Liquid Glass (iOS 26): navigation hierarchy, materials, controls, accessibility settings, screenshots vs binary. Use when reviewing an Apple-platform mockup or build for HIG compliance, contrast, tap targets, reduced transparency, or App Store UI review readiness."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# apple-ui-audit

Structured review of an Apple-platform interface against the Human Interface Guidelines and current Liquid Glass guidance (iOS 26 / 2025-2026). The report lists findings with severity and a fix direction.

## Scope

SwiftUI, UIKit, AppKit screens; mockups intended for App Store submission; cross-platform (iOS/iPadOS/macOS/tvOS/watchOS/visionOS) consistency checks. Web UI that only *looks* iOS-like is out of scope (use `ui-slop-remover` / `ui-craft-rules`).

## 1. Navigation and hierarchy

- Content layer vs navigation layer clearly separated. Tab bars, sidebars, toolbars sit in the functional layer above content.
- One obvious primary path per screen; no competing equal-weight actions.
- Standard back / dismiss patterns; no custom chrome that fights system gestures.
- Search and navigation work the same way across iPhone, iPad, Mac where the HIG expects it.
- Sidebar / inspector safe areas: content peeks correctly; nothing clipped under Liquid Glass.

## 2. Liquid Glass (when targeting latest OS)

Primary references: Apple "Adopting Liquid Glass", HIG Materials.

| Check | Fail signal |
|---|---|
| Use system components first | Custom opaque bars fighting the system material |
| Glass on controls/navigation, not content layer | Decorative glass cards in body content |
| Sparingly on custom controls | Every cell frosted |
| Regular vs clear variant | Clear over bright text without dimming |
| Reduce Transparency path | Broken layout when the setting strips blur |
| Scroll edge effect | Unreadable controls over scrolling content |
| Color on controls | Hard-coded brand color with no light/dark/increase-contrast variants |

Rebuild with latest SDK, run on latest OS, then judge. App Review 2.3 rejects marketing shots whose glass the binary does not ship.

## 3. Controls and touch

- Minimum tap targets per HIG (44×44 pt default; follow current platform tables).
- Standard control sizes: do not hard-code metrics that the system now updates.
- Toolbars: no empty spacer hacks; hide the whole item, not an empty shell.
- Tab bar auto-minimize: intentional opt-in, tested both scroll directions.
- Focus engine / keyboard / remote (tvOS) paths for every actionable control.

## 4. Color, type, and accessibility

- System colors or custom colors with light, dark, and increased-contrast variants.
- Dynamic Type: no fixed-height labels that clip at accessibility sizes.
- Test matrix: Reduce Transparency, Reduce Motion, Increase Contrast, Bold Text, larger text, VoiceOver, Switch Control.
- Liquid Glass fallback under those settings must remain legible and navigable.
- Contrast on frosted surfaces: measure. Blur alone does not guarantee a ratio.
- State must remain readable without color.

## 5. Motion and materials

- Prefer system transitions; custom morphs respect Reduce Motion.
- `GlassEffectContainer` (where applicable) for combined custom glass performance.
- Profile scroll hitching and modal latency on representative devices.

## 6. Store readiness (UI-adjacent)

- Screenshots match the submitted build (current chrome, not last year's).
- Privacy manifest present when required; AI features disclosed where guidelines require.
- No mock-only UI in the listing.

## Report format

```
## Apple UI audit
Verdict: PASS | PASS_WITH_FIXES | FAIL

### Blockers
- [HIGH] screen:path : finding
  HIG / doc: ...
  Fix: ...

### Should fix
- ...

### Notes / accepted risk
- ...
```

Each finding cites a screen path and a guideline source (HIG section or Apple doc title). No finding without a location.

## Sources

Apple Human Interface Guidelines; Adopting Liquid Glass; Materials (Liquid Glass + standard materials); App Review guidelines (2.3 screenshots, privacy). Original Novahiz checklist synthesis.
