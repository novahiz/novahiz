# Platform specifics

Differences that change audit criteria by target. Confirm any hard number against the live HIG for the OS version you ship.

## iOS and iPadOS

- Navigation: navigation stack with a back affordance that keeps a recognizable label (previous title or "Back"); modals usually dismiss with a visible close or swipe where the pattern allows.
- Tab bars: peer destinations, about three to five items; more belong in a "More" slot or a different pattern.
- Sheets: scoped tasks that should not lose page context; full-screen modals for tasks that own the whole flow.
- Safe areas: notch and home indicator insets; fixed bottom toolbars need bottom inset padding.
- Split view on iPad: two columns with correct restoration of each side's state after relaunch.
- Pointer support on iPadOS: hover highlights and trackpad focus must match touch affordances, not disappear.

## macOS

- Window chrome: traffic lights, unified toolbars, inspector sidebars rather than mobile-style drawers unless the app is clearly designed as a single-purpose utility.
- Menus: app menu, standard Edit/View/Window/Help sets; keyboard equivalents on frequent commands.
- Controls: checkboxes for independent toggles, radio groups for exclusive choices, pop-up buttons for short lists; avoid oversized touch-style sliders when a precise stepper fits.
- Pointer: right-click contextual menus expected in lists and canvases; focus ring on full keyboard navigation.
- Full-screen: proper window zoom and full-screen behaviors; document-based apps restore windows on relaunch.

## watchOS

- One primary task per screen; hierarchical navigation or tabs with very few items.
- Crowns and side button map to system behaviors; custom controls must document their crown interaction if they take it over.
- Graphics favor high-contrast glyphs and large touch targets over dense text.
- Complications and notifications follow system templates when possible for glanceability.

## visionOS

- Windows and volumes live in space; content must remain readable at the distances the system places it.
- Indirect input (eye + pinch): generous hit targets, clear hover affordances before commit, no reliance on pixel-perfect small icons.
- Immersive content: provide an exit and a way to re-anchor UI; never trap the user's view.
- Materials adapt to the passthrough environment; test text contrast over bright and dark rooms.

## Liquid Glass era notes (iOS 26 / macOS Tahoe and later)

- Floating bars and controls use Glass materials from the system; audit for custom imitations that miss adaptive blur or legibility.
- Icon and control rendering may pick up depth and specular treatment; screenshots from older OS trains need re-validation.
- If deployment target includes pre-26 releases, the audit report must list the fallback material used there.

## Shared cross-platform rules

| Rule | Applies to |
|---|---|
| Dynamic Type / text styles | all text-heavy UI |
| Dark mode semantic colors | all |
| Reduce Motion fallback | all animated transitions |
| VoiceOver labels on icon-only controls | all |
| 44pt-class touch floor | touch and direct-manipulation targets |

## Evidence expectations per platform

- iOS/iPadOS: simulator screenshots at two device sizes plus one VoiceOver pass on the primary flow.
- macOS: windowed and full-screen screenshots, keyboard-only walk of the main menu path.
- watchOS: paired iPhone screenshots of the app plus on-watch captures if a device is available.
- visionOS: system captures in both light and dark environments when possible.
