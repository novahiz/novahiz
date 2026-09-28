# WCAG 2.2 success criteria at Level A and AA (55)

AA conformance covers 31 Level A criteria and 24 Level AA criteria. Levels are cumulative: failing any A criterion breaks an AA claim. The criteria introduced in WCAG 2.2 (October 2023) are marked **[new 2.2]**. Six of them sit at A or AA: 2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8. SC 4.1.1 Parsing was removed and must not appear on a 2.2 checklist.

Conformance is judged per page: one failing criterion fails that page. The tables below follow POUR.

---

## 1. Perceivable (20 criteria)

### Guideline 1.1 Text alternatives

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 1.1.1 | A | Non-text Content | Informative images carry meaningful alt; decorative ones use `alt=""`; controls have accessible names |

### Guideline 1.2 Time-based media

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 1.2.1 | A | Audio-only and Video-only (Prerecorded) | An alternative for audio; captions or an audio track for video-only |
| 1.2.2 | A | Captions (Prerecorded) | Synchronized captions on prerecorded video with audio |
| 1.2.3 | A | Audio Description or Media Alternative | Audio description or a full text alternative for video |
| 1.2.4 | AA | Captions (Live) | Captions on live audio in synchronized media |
| 1.2.5 | AA | Audio Description (Prerecorded) | Audio description for prerecorded video |

### Guideline 1.3 Adaptable

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 1.3.1 | A | Info and Relationships | Structure is available programmatically: headings, lists, tables, labels |
| 1.3.2 | A | Meaningful Sequence | DOM reading order matches visual order |
| 1.3.3 | A | Sensory Characteristics | Instructions do not lean only on shape, size, position, or sound |
| 1.3.4 | AA | Orientation | Not locked to portrait or landscape alone |
| 1.3.5 | AA | Identify Input Purpose | `autocomplete` on common personal and transaction inputs |

### Guideline 1.4 Distinguishable

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 1.4.1 | A | Use of Color | Color never carries meaning alone |
| 1.4.2 | A | Audio Control | Auto-playing audio can be paused, stopped, or volume-controlled on its own |
| 1.4.3 | AA | Contrast (Minimum) | At least 4.5:1 for normal text; at least 3:1 for large text (18pt, or 14pt bold) |
| 1.4.4 | AA | Resize Text | 200% zoom keeps content and function intact |
| 1.4.5 | AA | Images of Text | Real text instead of images of text, with listed exceptions |
| 1.4.10 | AA | Reflow | No 2-D scroll at 320 CSS px, which is about 400% zoom at 1280 |
| 1.4.11 | AA | Non-text Contrast | UI components and meaningful graphics reach 3:1 |
| 1.4.12 | AA | Text Spacing | No loss with line-height 1.5×, paragraph 2×, letter 0.12em, word 0.16em |
| 1.4.13 | AA | Content on Hover or Focus | Dismissible, hoverable, persistent |

---

## 2. Operable (20 criteria)

### Guideline 2.1 Keyboard

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 2.1.1 | A | Keyboard | Every function works through the keyboard |
| 2.1.2 | A | No Keyboard Trap | Focus can leave every component |
| 2.1.4 | AA | Character Key Shortcuts | Single-character shortcuts can be remapped or turned off |

### Guideline 2.2 Enough time

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 2.2.1 | A | Timing Adjustable | Time limits can be extended or switched off, with listed exceptions |
| 2.2.2 | A | Pause, Stop, Hide | Motion longer than five seconds can be paused |

### Guideline 2.3 Seizures

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 2.3.1 | A | Three Flashes or Below Threshold | No flash more than three times per second, or under threshold |

### Guideline 2.4 Navigable

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 2.4.1 | A | Bypass Blocks | Skip link or correct landmarks for repeated blocks |
| 2.4.2 | A | Page Titled | Descriptive and unique title |
| 2.4.3 | A | Focus Order | Tab order is logical and keeps meaning |
| 2.4.4 | A | Link Purpose (In Context) | Purpose clear from link text or context |
| 2.4.5 | AA | Multiple Ways | More than one route to a page, with process steps excepted |
| 2.4.6 | AA | Headings and Labels | Headings and labels describe topic or purpose |
| 2.4.7 | AA | Focus Visible | Keyboard focus indicator is visible |
| 2.4.11 | AA | **[new 2.2]** Focus Not Obscured (Minimum) | Focused element stays at least partly visible under sticky UI |

### Guideline 2.5 Input modalities

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 2.5.1 | A | Pointer Gestures | Multipoint or path gestures have a single-pointer alternative |
| 2.5.2 | A | Pointer Cancellation | Action fires on up-event; abort or undo available on down-event |
| 2.5.3 | A | Label in Name | Visible label text appears inside the accessible name |
| 2.5.4 | A | Motion Actuation | Motion-controlled features have UI alternatives |
| 2.5.7 | AA | **[new 2.2]** Dragging Movements | Dragging has a single-pointer alternative |
| 2.5.8 | AA | **[new 2.2]** Target Size (Minimum) | Targets reach 24×24 CSS px, with spacing, inline, and equivalent exceptions |

---

## 3. Understandable (13 criteria)

### Guideline 3.1 Readable

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 3.1.1 | A | Language of Page | `lang` on `<html>` |
| 3.1.2 | AA | Language of Parts | `lang` on language changes inside content |

### Guideline 3.2 Predictable

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 3.2.1 | A | On Focus | Focus alone does not change context |
| 3.2.2 | A | On Input | Input alone does not change context unless the user was warned |
| 3.2.3 | AA | Consistent Navigation | Repeated nav sits in the same relative order |
| 3.2.4 | AA | Consistent Identification | Same function, same label across pages |
| 3.2.6 | A | **[new 2.2]** Consistent Help | Help mechanisms sit in the same relative order |

### Guideline 3.3 Input assistance

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 3.3.1 | A | Error Identification | Errors identified in text |
| 3.3.2 | A | Labels or Instructions | Inputs carry labels or instructions when needed |
| 3.3.3 | AA | Error Suggestion | Correction suggested when known, except legal or financial entries |
| 3.3.4 | AA | Error Prevention (Legal, Financial, Data) | Reversible, checked, or confirmed |
| 3.3.7 | A | **[new 2.2]** Redundant Entry | Prior entries stay available without re-typing |
| 3.3.8 | AA | **[new 2.2]** Accessible Authentication (Minimum) | No cognitive function test for the password step, with exceptions for alternatives, object recognition, and personal content |

---

## 4. Robust (2 criteria)

| SC | Level | Name | What passing looks like |
|----|-------|------|-------------------------|
| 4.1.2 | A | Name, Role, Value | Every UI component exposes correct name, role, and state |
| 4.1.3 | AA | Status Messages | Statuses announce without stealing focus (`aria-live`, roles) |

---

## Quick severity defaults

- **critical**: 2.1.1, 2.1.2, 1.1.1 when informative, 4.1.2, and 3.3.1 when submit is blocked
- **major**: 1.4.3, 1.4.11, 2.4.7, 2.4.11, 1.3.1, 3.3.2, 2.5.8
- **minor**: 3.2.4, 1.4.12, and 3.3.3 when the error is still recoverable

Adjust for product risk and record any override in the report.

## Source

W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*, W3C Recommendation. Check edge cases against the official Understanding documents before a formal conformance claim.
