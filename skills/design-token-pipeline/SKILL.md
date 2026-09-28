---
name: "design-token-pipeline"
description: "Design token architecture and pipeline: DTCG 2025.10 format ($value/$type/aliases), base/semantic/component layers, Style Dictionary v4 builds, Figma Variables round-trip, theming and governance. Use when creating or migrating token files, CSS custom properties from a system, multi-brand themes, or design-dev handoff of color/type/spacing."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: September 2026
---

# design-token-pipeline

Tokens are the contract between design tools and shipped code. This skill covers the format, the layer model, the build, and the governance rules the format does not prescribe.

## Format: DTCG 2025.10

Stable spec from the W3C Design Tokens Community Group (October 2025). Prefer it for new files.

| Property | Role |
|---|---|
| `$value` | The value (reserved word) |
| `$type` | Kind: `color`, `dimension`, `fontFamily`, `fontWeight`, `duration`, `cubicBezier`, `number`, `string`, `boolean`, `strokeStyle`, `border`, `transition`, `shadow`, `gradient`, `typography`, `fontStyle` |
| `$description` | Human doc that travels with the token |
| `$extensions` | Vendor/team metadata, namespaced keys |

- Spec keys use `$`. Token and group names must not start with `$`.
- A token is an object with `$value`. Without it, the object is a group.
- Groups may set `$type` (inherited), `$description`, `$deprecated`, `$extends`, `$root`.
- Aliases: `{color.brand.blue}` curly-brace path references.
- Colors in 2025.10 are objects with a colour space plus components (`srgb`, `hsl`, `hwb`, `lab`, `lch`, `oklab`, `oklch`), not bare hex. Keep an optional hex only as a fallback for old tools.
- Do not put `{` `}` `.` in token/group names (alias and path rules).

Style Dictionary v4 reads DTCG natively. Full 2025.10 colour-object support is still landing in v5; check the version you pin before migrating hex-only colour tokens.

## Layer model (the spec does not mandate one)

The spec standardizes the container. Layering is your architecture decision. The common stack:

```
base (primitives)  →  semantic (intent)  →  component (instance)
#bada55              color.accent.brand     button.primary.bg
spacing.4            text.muted             card.padding
```

| Layer | Names answer | Change cost |
|---|---|---|
| Base | What is the literal? | Low (internal) |
| Semantic | What is it for? | Medium (meaning is public) |
| Component | Which control? | High (scattered consumers) |

Reference upward with aliases. Theme swaps change base (or a semantic override set), not each component file.

`outputReferences: true` in Style Dictionary keeps `var(--…)` chains in CSS when base and semantic ship in the same bundle. Hardcode when a semantic file must stand alone.

## Pipeline shape

1. Author tokens in DTCG JSON (Figma Variables export or hand-maintained).
2. Validate against the format (structure, types, unresolved aliases).
3. Build with Style Dictionary (or Terrazzo): transforms per platform.
4. Emit CSS custom properties, iOS/Android/Flutter sources as needed.
5. Point components only at semantic (or component) names, never raw hex in JSX.

Multi-platform: DTCG `dimension` has `px`/`rem`/`em`, not iOS `pt` or Android `dp`. Conversion is an explicit transform step with a documented ratio.

## Governance (outside the spec)

- Who may add a semantic token? Review rule in the repo.
- Deprecate with `$deprecated`, do not leave `blue-v2-new` beside `blue`.
- One naming dialect documented (e.g. `color.text.muted`, not mixed `--textColorMuted` and `color-text-muted` at the same layer).
- Delete unused base tokens on a schedule; cruft accumulates silently.

## Checklist

- [ ] New work is DTCG-shaped (`$value` / `$type`), not legacy `value`/`type`.
- [ ] Three layers (or a documented reason for fewer).
- [ ] Components import semantic names only.
- [ ] Light/dark (and brand) are data, not forked component CSS.
- [ ] Alias graph resolves; no circular references.
- [ ] Platform transforms documented for non-web targets.
- [ ] Governance rule written where contributors will see it.

## Sources

Design Tokens Format Module 2025.10 (designtokens.org), Style Dictionary DTCG docs, W3C Design Tokens CG announcements, Nathan Curtis / Cosima writing on token naming layers. Original Novahiz synthesis.
