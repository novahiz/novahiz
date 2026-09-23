# Accessibility audit report

**Target:** <files / URL / routes>
**Claim level:** WCAG 2.2 Level <A | AA>
**Date:** <YYYY-MM-DD>
**Auditor:** <agent / person>

## Summary

| Metric | Value |
|--------|-------|
| SC in claim | 55 (31 A + 24 AA) or scoped subset |
| PASS | N |
| FAIL | N |
| PARTIAL | N |
| Not tested | N |

## Per-criteria results

| SC | Name | Level | Status | Evidence |
|----|------|-------|--------|----------|
| 1.1.1 | Non-text Content | A | PASS | … |
| 1.4.3 | Contrast (Minimum) | AA | FAIL | `src/a.css:12`: 2.8:1 measured |

Status values: `PASS`, `FAIL`, `PARTIAL`, `NT` (not tested).

## Findings

### \<severity>: \<SC\>: \<short title\>

- **Location:** `file:line` or DOM selector
- **Evidence:** measured value, screenshot ref, or keyboard observation
- **Fix:** concrete change
- **After (re-test):** PASS / FAIL with proof

## Manual tests performed

- [ ] Keyboard-only traversal (Tab, Shift+Tab, Enter, Space, Esc)
- [ ] Focus visibility on every interactive control
- [ ] Heading and landmark outline
- [ ] Contrast (script: `scripts/contrast.mjs`)
- [ ] Reflow and zoom (320 px width, 200% text)
- [ ] Screen reader smoke test when available: \<tool + page\>

## Residual risks and exceptions

| SC | Reason | Justification |
|----|--------|---------------|
| … | … | … |

## Sign-off

Automated coverage alone does not justify an AA claim.

Remaining FAIL items block release when severity is critical or major under product policy.
