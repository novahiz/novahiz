# Developer handoff packet

What to put in the folder (or PR) when design hands a system to engineering, and how to run the kickoff review so questions get answered once.

## Packet contents

1. **Token file** (`tokens.json`) plus the exact generator command that produced it.
2. **Scale tables** rendered as markdown: type steps, space steps, radius set, motion durations.
3. **Component docs** following `component-architecture.md`, one file or one story per component.
4. **Decision log**: ratio choice, spacing unit, palette rationale, anything deliberately rejected.
5. **Screenshots** at 320, 768, 1280, and one wide width for each primary screen.
6. **Accessibility notes**: contrast results, focus order sketches, reduced-motion behavior.

Template to fill: `assets/design_system_doc_template.md`.

## Decision log format

Short bullets, no adjectives without a reason:

```text
- Type ratio 1.25: product UI needs tight steps between body and label.
- Space unit 8: matches existing chart grid; 4 allowed only inside icon+text groups.
- Accent #FF6B35: primary actions only; semantic colors never reuse the accent.
- Rejected purple gradient hero: conflicts with anti-AI-design rule R13.
```

## Rebuild contract

Engineering must be able to regenerate tokens without design in the loop:

```bash
python scripts/design_token_generator.py --brand "#0B5FFF" --accent "#FF6B35" --out tokens.json
```

Pin Python 3.x in the README of the consuming repo. No third-party packages. CI job: regenerate, diff against committed `tokens.json`, fail on drift.

## Kickoff agenda (30 minutes)

| Minutes | Topic |
|---|---|
| 0-5 | Product surfaces covered by this drop |
| 5-15 | Walk the token groups; flag any name that confuses |
| 15-25 | Component-by-component: what is new vs restyled |
| 25-30 | Open questions, owners, dates for gaps |

Bring the decision log on screen. Arguments about taste usually resolve when the reason is visible.

## Definition of done for handoff

- [ ] Generator runs clean; JSON validates; contrast gate passes.
- [ ] Every interactive component in scope has a filled state matrix.
- [ ] Screenshots match the implementation at the four widths, or diffs are filed as tickets.
- [ ] Decision log has an owner and a date.
- [ ] Consuming repo README links to the token file and the rebuild command.
- [ ] Outstanding risks listed (missing dark theme, untested locale, pending brand review).

## Common failure modes

- Shipping screenshots without the token file: engineers eyedropper colors and the system forks on day one.
- A "final" Figma with variants that never appear in the state matrix: pick one source of truth and delete the other.
- Handoff that skips reduced-motion and focus rings: those land in the accessibility backlog anyway, later and more expensively.
