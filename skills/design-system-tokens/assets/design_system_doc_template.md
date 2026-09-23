# Design system documentation packet

Fill every section before the kickoff review. Keep token paths in code format; never paste raw hex where a path exists.

---

## Cover

| Field | Value |
|---|---|
| System name | |
| Version | |
| Owner (design) | |
| Owner (engineering) | |
| Date | |
| Consuming product(s) | |

## Rebuild contract

```bash
python scripts/design_token_generator.py --brand "#..." --accent "#..." --out tokens.json
```

| Field | Value |
|---|---|
| Python version | |
| Committed token path | |
| CI drift check | yes / no |

## Type scale

| Step | Size | Intended use |
|---|---|---|
| 0 | | body |
| 1 | | small body / caption |
| 2 | | |
| ... | | |
| 10 | | display |

| Property | Value |
|---|---|
| Family (UI) | |
| Family (mono) | |
| Ratio | |
| Line-height display | |
| Line-height body | |

## Space scale

| Step | Value | Typical use |
|---|---|---|
| 0 | | reset |
| 1 | | icon gap |
| 2 | | |
| ... | | |
| 12 | | section padding |

## Color roles

| Role | Token path | Notes |
|---|---|---|
| Page background | `color.surface.page` | |
| Raised surface | `color.surface.raised` | |
| Body text | `color.text.primary` | |
| Secondary text | `color.text.secondary` | |
| Primary action | `color.accent.default` | |
| On-brand text | `color.text.inverse` | |
| Border | `color.border.subtle` | |
| Success | `color.semantic.success` | |
| Warning | `color.semantic.warning` | |
| Danger | `color.semantic.danger` | |
| Info | `color.semantic.info` | |

Contrast spot checks (paste generator or `hig_checker` output):

```text
-
```

## Radius, shadow, motion

| Group | Token | Value |
|---|---|---|
| radius | `radius.sm` | |
| radius | `radius.md` | |
| radius | `radius.lg` | |
| radius | `radius.pill` | |
| shadow | `shadow.elevation1` | |
| shadow | `shadow.elevation2` | |
| motion | `motion.duration.fast` | |
| motion | `motion.duration.base` | |
| motion | `motion.duration.slow` | |
| motion | `motion.easing.standard` | |

## Component index

| Component | Doc path or story | Status |
|---|---|---|
| | | ready / draft / blocked |

State-matrix coverage: list any interactive component still missing empty, loading, error, disabled, or focus rows.

## Decision log

```text
-
```

## Screenshots

| Screen | 320 | 768 | 1280 | Wide |
|---|---|---|---|---|
| | | | | |

## Accessibility summary

| Check | Result |
|---|---|
| Body text contrast AA | |
| Large text / UI contrast 3:1 | |
| Focus visible on every surface | |
| Reduced-motion path exists | |
| Touch targets >= 44x44 CSS px | |

## Open risks and owners

| Risk | Owner | Target date |
|---|---|---|
| | | |
