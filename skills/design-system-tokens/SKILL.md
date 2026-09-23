---
name: "design-system-tokens"
description: "UI design system toolkit for Senior UI Designer including design token generation, component documentation, responsive design calculations, and developer handoff tools. Use when creating design systems, generating design tokens, maintaining visual consistency, or facilitating design-dev collaboration and developer handoff."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
  date: September 2026
---

# Design system token toolkit

Produce a token file, a type scale, a spacing rhythm, component outlines, and a handoff packet a frontend team can implement without a meeting. Everything here targets the DTCG token shape so Style Dictionary or any compliant build step can consume the output.

## When this skill fires

Triggers include: generate design tokens, create a color palette, build a typography scale, calculate a spacing system, scaffold a design system, document components for handoff, align design and development on shared values.

## Pipeline overview

```text
brand inputs  ->  scripts/design_token_generator.py  ->  tokens.json (DTCG)
                                                     ->  scale tables (md)
component inventory  ->  references/component-architecture.md patterns
viewport rules       ->  references/responsive-calculations.md formulas
delivery pack        ->  assets/design_system_doc_template.md
```

Run the generator with Python 3 and no third-party packages:

```bash
python scripts/design_token_generator.py --brand "#0B5FFF" --accent "#FF6B35" --out tokens.json
```

Optional flags: `--base-font 16`, `--ratio 1.25` (type scale multiplier), `--space-unit 8`, `--dark` to emit a paired dark surface set.

## Token categories to emit

| Group | DTCG type examples | Notes |
|---|---|---|
| color | `color` | Brand, accent, surface, text, border, semantic (success, warning, danger, info) |
| typography | `dimension`, `fontWeight`, `fontFamily` | Family stack, modular size scale, line-height numbers |
| space | `dimension` | Multiples of one base unit |
| radius | `dimension` | Corner set (sm, md, lg, pill) |
| shadow | `shadow` | Elevation steps with color alpha |
| motion | `duration`, `cubicBezier` | Fast, base, slow; standard curves |

Every leaf uses `$type` and `$value` per DTCG. Groups may carry `$description` for handoff notes. No raw hex or pixel numbers outside `$value`.

## Color work

Start from the brand hex or a named reference hue. Derive:

1. A 10-step surface ramp (100 lightest to 900 darkest) by mixing toward white or black; the script approximates perceptual lightness steps when given only one seed.
2. Text tokens at AA contrast (4.5:1) against each surface step; the generator fails loudly if a proposed pair drops below threshold.
3. Semantic aliases that point at ramps, not duplicate hex literals.

Details and contrast math live in `references/token-generation.md`.

## Type and space math

- Modular scale: `size(n) = base * ratio^n` for n from 0 to 10 (or a custom range). Round to whole pixels below 24px, one decimal above.
- Line-height: 1.2 for display sizes, 1.5 for body, tabular figures where the face supports them.
- Space: integer multiples of the base unit (default 8). Prohibit magic 4/12/16 mixes unless the unit flag says so.

Formulas and responsive substitution rules: `references/responsive-calculations.md`.

## Component documentation

For each component record anatomy (slots, layers), variants, state matrix (default, hover, focus, active, disabled, loading, error), token bindings by role, and accessibility notes (roles, labels, focus order). Pattern catalog: `references/component-architecture.md`.

## Developer handoff

Fill `assets/design_system_doc_template.md` with the generated tables, the decision log (why this ratio, why this unit), file paths for tokens, and the one-command rebuild instruction. Packet criteria and review meeting agenda: `references/developer-handoff.md`.

## Quality bar before delivery

- [ ] `tokens.json` validates as JSON and every leaf has `$value` plus `$type`.
- [ ] Contrast pairs in the file pass WCAG 2.2 AA for their stated use (body, large text, UI).
- [ ] Scale and space outputs are pure functions of the flags; re-running reproduces identical bytes.
- [ ] No hex literals appear in component docs; docs reference token paths only.
- [ ] `python -m py_compile scripts/design_token_generator.py` passes.

## Anti-patterns

- Forking a second source of truth in CSS variables that drift from `tokens.json`.
- Naming tokens after hues (`blue500`) instead of roles (`color.action.primary`); aliases may map role to hue, but consumers bind roles.
- Shipping a dark theme as inverted light values without rechecking text contrast on each surface step.
- Expanding the scale ratio mid-project; pick the ratio once and record it in the handoff log.
