---
name: novahiz-wcag-audit
description: |
  novahiz-wcag-audit runs a WCAG 2.2 Level A/AA accessibility audit across source code,
  live pages, and structured reports. Use when auditing web accessibility, checking WCAG
  compliance, fixing contrast, keyboard, ARIA, or screen-reader issues, or producing an
  accessibility audit report.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-wcag-audit

End-to-end WCAG 2.2 A/AA audit: scan the source, check the live page, fix what fails, then produce a cited report.

## Pick a path

| Input | Path |
|-------|------|
| Files only, no running app | Scan, Fix, Verify in code |
| URL or running app | Scan, Live audit, Fix, Re-verify |
| User asks for a report | Run both paths, then Report |

## Workflow

**1. Scope.** Confirm the target (files, folder, URL), the claim level (AA by default), and what is out of scope.

**2. Scan.** Review the source against [references/wcag22-aa.md](references/wcag22-aa.md) in this order: structure and semantics, then keyboard and focus, then forms and errors, then images, media, and ARIA, then color and contrast with `scripts/contrast.mjs`. Record each finding with SC id, severity, `file:line`, evidence, and a proposed fix.

**3. Live audit** when a page is available. Playwright MCP only. Never Chrome or Chromium; the Edge profile rules apply.

- Keyboard pass with Tab and Shift+Tab: focus visibility and traps.
- Landmarks and heading order from the accessibility tree or snapshot.
- Contrast from computed styles fed to the contrast script, plus reflow at 320 CSS px and 200% text zoom.
- Optional axe-core only if the page already loads it. No heavy npm install for a one-off audit.

Automated tools catch a fraction of the problems. Keyboard and screen-reader checks are mandatory before claiming AA.

**4. Fix.** Prefer semantic HTML over ARIA. Work by severity: blockers first, then significant barriers, then friction. Keep every change minimal and reversible.

**5. Verify.** Re-run the contrast script on every color pair you touched. Re-check the keyboard path on changed components. Flip each SC line to pass only with evidence attached.

**6. Report.** Use `scripts/report.mjs` or [references/report-template.md](references/report-template.md). The minimum content is scope and claim level, a per-SC PASS/FAIL table with evidence, findings with severity and before/after, the manual tests you ran, and residual risks.

## Scripts

```bash
node scripts/contrast.mjs "#767676" "#ffffff"
node scripts/contrast.mjs "#767676" "#ffffff" --level large
node scripts/contrast.mjs "#767676" "#ffffff" --level aaa --text normal
node scripts/report.mjs findings.json > report.md
```

Contrast exits 0 on pass, 1 on fail, 2 on usage or parse error. Findings JSON shape: `{ "sc", "status", "severity", "location", "evidence", "fix" }`. A filled sample sits at [references/findings.example.json](references/findings.example.json).

## Severity

| Severity | Meaning | Action |
|----------|---------|--------|
| critical | Blocks access: no keyboard, no alt, no accessible name | Before release |
| major | Significant barrier: contrast, focus, labels | Current sprint |
| minor | Friction: redundant ARIA, heading gaps | Backlog with a written justification |

## Red flags

- Claiming AA from automated scans alone.
- `aria-label` that does not match the visible label (2.5.3).
- `tabindex` greater than 0.
- Color as the only signal (1.4.1).
- Focus outline removed with nothing in its place.
- Decorative `alt` left on informative images.

## Deep reference

All 55 Level A and AA criteria: [references/wcag22-aa.md](references/wcag22-aa.md).
