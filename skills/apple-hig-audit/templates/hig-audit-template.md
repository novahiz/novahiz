# HIG audit report

Copy this file per app or major flow. Cite the HIG section next to every fail or concern; open questions go in the last table.

---

## Cover

| Field | Value |
|---|---|
| App name | |
| Platforms audited | iOS / macOS / watchOS / visionOS (circle) |
| Minimum OS | |
| Audit date | |
| Auditor | |
| Context file (if any) | `product-context.md` / `ios-design-context.md` / none |

## Automated checks

Paste `python scripts/hig_checker.py ...` output here.

```text
-
```

## Screen inventory

| # | Screen / flow | Mode (design / audit) | Highest severity found |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

## Findings

Severity: **Fail** (explicit requirement broken), **Concern** (discouraged or fragile), **Note** (polish).

| ID | Screen | Severity | Finding | HIG section / URL | Evidence | Suggested fix |
|---|---|---|---|---|---|---|
| HIG-001 | | | | | | |
| HIG-002 | | | | | | |

## Required screens walkthrough

### Launch and first run

| Check | Result | Notes |
|---|---|---|
| Launch screen matches first UI moment | | |
| Permission prompts only after context | | |
| Onboarding skippable where content allows | | |

### Primary task

| Check | Result | Notes |
|---|---|---|
| Navigation back path always available | | |
| Primary action reachable one-handed on phone | | |
| States: empty / loading / error present | | |
| VoiceOver pass on this flow | | |

### Settings and system integration

| Check | Result | Notes |
|---|---|---|
| Settings use standard panes where possible | | |
| Deep links and handoff behave on relaunch | | |
| Dark mode and Reduce Motion verified | | |

## Accessibility summary

| Area | Result | Evidence |
|---|---|---|
| Contrast (script) | | |
| Type sizes / Dynamic Type | | |
| Hit targets | | |
| VoiceOver labels and order | | |
| Focus / keyboard (macOS, iPad) | | |
| Reduce Motion | | |
| Color independence | | |

## Liquid Glass / materials

| Check | Result | Notes |
|---|---|---|
| System materials used (or documented fallback) | | |
| Legibility of text on translucent surfaces | | |
| Pre-26 fallback listed when deployment target requires it | | |

## Severity counts

| Severity | Count |
|---|---|
| Fail | |
| Concern | |
| Note | |

## Verdict

| Field | Value |
|---|---|
| Ship recommendation | ship / ship with notes / fix first |
| Automated checks overall | PASS / FAIL |
| Human judgment overall | |
| Top three fixes (ordered) | 1. 2. 3. |

## Open questions

| Question | Needs live HIG page? | Owner |
|---|---|---|
| | | |

## Freshness statement

State whether live HIG pages for Liquid Glass, navigation, and materials were re-opened on the audit date. If a `references/` claim disagreed with the live page, note which and that the live page won.
