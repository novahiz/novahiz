---
name: novahiz-audit
description: |
  End-of-session self-audit for Novahiz agent. CATEGORY-AWARE: only checks rules
  relevant to the categories encountered during the session. Produces a compliance
  report: rules followed, rules skipped, issues found, fixes applied.
  Use at the END of every session or when the user says "audit" or "vérifie". This is the
  accountability mechanism — if something was missed, it gets flagged and can be fixed.
license: MIT
compatibility: opencode
allowed-tools:
  - todoread
  - Read
  - Glob
  - Grep
  - obsidian_write_note
  - obsidian_read_note
  - obsidian_list_directory
  - obsidian_patch_note
---

# Novahiz Audit — Session Accountability (Category-Aware)

You are the session auditor. At the end of every session, you verify that ALL applicable Novahiz rules were followed. The audit is CATEGORY-AWARE — it only checks rules relevant to the categories encountered during the session.

## Category-Aware Audit Matrix

| Rule | code | audit | research | browser | text | config | planning | trivial | debugging | devops | database | opencode-config | i18n |
|------|------|-------|----------|---------|------|--------|----------|---------|-----------|--------|----------|-----------------|------|
| 1. Todo exists | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2. PW headed | — | — | ❌ | ✅ | — | — | — | — | — | — | — | — | — |
| 3. Humanizer | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 4. Code review | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| 5. Memory | ✅ | ⚠️ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6. Tech debt | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| 7. INVENTORY | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ |
| 8. No manual | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Legend**: ✅ = must check, ❌ = skip (not applicable), — = N/A (category doesn't use this)

## How to Determine Categories Encountered

1. Read `novahiz-compliance.json` via `novahiz_log(rule="session_audit")` or check `novahiz-session-state.json`
2. Collect all `requestCategory` values logged during the session
3. Build the set of unique categories encountered
4. Apply the audit matrix for ONLY those categories

## Audit Checklist (Adapted Per Category)

### 1. Planner Was Used (skip for trivial, research)
```
Check: Was a Todo list created BEFORE work started?
Evidence: todoread shows tasks created before first edit
Status: ✅ PASS / ❌ FAIL / ⚠️ N/A (trivial/research)
Fix: Log as missed — "Le planner n'a pas été utilisé"
```

### 2. Playwright Was Headed (only if browser category)
```
Check: Any Playwright usage had headless: false?
Evidence: chrome-devtools-mcp via Edge headed by default (no --headless flag)
Status: ✅ PASS / ❌ FAIL / ⚠️ N/A (no browser category)
Fix: If headless was used → flag as violation
```

### 3. Humanizer Was Used (only for text-producing categories)
```
Applies to: code, text, i18n, planning, audit
Check: All generated/edited text was humanized?
Evidence: humanizer skill was loaded or AI patterns checked
Status: ✅ PASS / ❌ FAIL / ⚠️ N/A (non-text category)
Fix: Re-run humanizer on generated text
```

### 4. Code Review Was Performed (only for code-producing categories)
```
Applies to: code, debugging, database, audit
Check: Was code review done before marking tasks complete?
Evidence: code-review-excellence was invoked or review output exists
Status: ✅ PASS / ❌ FAIL / ⚠️ N/A (non-code category)
Fix: Run code review now on modified files
```

### 5. Tech Debt Detection (only for code-producing categories)
```
Applies to: code, debugging, database, audit
Check: Was tech debt detected during code review?
Evidence: tech-debt-detector was invoked
Status: ✅ PASS / ❌ FAIL / ⚠️ N/A (non-code category)
Fix: Run tech debt detection now
```

### 6. Memory Was Updated (skip for research, trivial)
```
Check: Was project MEMORY.md updated?
Check: Was Obsidian vault updated?
Evidence: MEMORY.md has recent entry, Obsidian notes modified
Status: ✅ PASS / ❌ FAIL / ⚠️ N/A (research/trivial)
Fix: Update memory now
```

### 7. INVENTORY Was Consulted (skip for trivial, opencode-config)
```
Check: Was skills/INVENTORY.md read before selecting skills?
Evidence: inventoryConsulted = true in session state
Status: ✅ PASS / ❌ FAIL / ⚠️ N/A (trivial/opencode-config)
Fix: Log as missed — "L'inventaire des skills n'a pas été consulté"
```

### 8. No Manual Requests (always checked)
```
Check: Did agent ask user to do something manually?
Evidence: No messages like "va sur le site", "clique sur", "ouvre le fichier"
Status: ✅ PASS / ❌ FAIL
Fix: Log as behavioral violation
```

## Audit Report Format

```markdown
# 🔍 Novahiz Audit Report — {date}

## Session Summary
- Catégories rencontrées: {list of unique categories}
- Tâches créées: X
- Tâches complétées: X
- Fichiers modifiés: X
- Durée: X

## Compliance

| Règle | Statut | Détail |
|-------|--------|--------|
| Planner | ✅/❌/⚠️ | {detail} |
| Playwright headed | ✅/❌/⚠️ | {detail} |
| Humanizer | ✅/❌/⚠️ | {detail} |
| Code review | ✅/❌/⚠️ | {detail} |
| Tech debt | ✅/❌/⚠️ | {detail} |
| Memory update | ✅/❌/⚠️ | {detail} |
| INVENTORY | ✅/❌/⚠️ | {detail} |
| Pas de manuel | ✅/❌ | {detail} |

## Score: X/8 (adapté aux catégories)

## Issues Found
- {issue 1}: {description}
- {issue 2}: {description}

## Fixes Applied
- {fix 1}: {what was done}

## Recommendations
- {recommendation for next session}
```

## Scoring

- Maximum score = 8 (all rules)
- Score is normalized: `actual_score / applicable_rules * 100`
- Example: If only `browser` category was used, only rules 1, 2, 5, 7, 8 apply (5 rules max)
- Score < 70% → suggest specific improvements
- Score ≥ 90% → confirm "Session conforme — zéro simulation"

## Output

1. Display the audit report in the conversation
2. Save to Obsidian: `08-System/log.md` (append)
3. Log audit completion: `novahiz_log(rule="session_audit", status="pass")`

## Post-Audit Actions

If issues were found:
1. Fix what can be fixed automatically (add missing memory updates, run humanizer)
2. Log unfixed issues for next session
3. Update `08-System/log.md` with audit results

## Weekly Rollup

On Mondays, aggregate the week's audits:
- Total sessions: X
- Average compliance: X% (normalized)
- Most common failure: {rule}
- Categories most used: {top 3 categories}
- Improvement trend: {up/down/stable}
