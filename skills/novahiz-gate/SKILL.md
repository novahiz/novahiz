---
name: novahiz-gate
description: |
  Workflow enforcement gate for Novahiz agent. CATEGORY-AWARE: only checks rules
  relevant to the current request category. Verifies rules before allowing work to proceed.
  Checks: Todo exists, browser headed (Edge DevTools), humanizer loaded for text, code review scheduled,
  tech debt detector loaded, INVENTORY consulted, code ordering (skills before first code write),
  memory update — but ONLY for categories that require them.
  Rule #5 (memory) uses the Memory Necessity Engine: evidence-based verdict from real
  mutation tracking, not static category proxy. Memory debt blocks gate until settled.
  If any required rule fails, BLOCKS execution and reports what's missing.
  Use at the START of every task and BEFORE every significant action.
  This is the zero-simulation guarantee — rules are enforced, not just documented.
license: MIT
compatibility: opencode
allowed-tools:
  - todoread
  - Read
  - Glob
  - Grep
---

# Novahiz Gate — Zero-Simulation Enforcement (Category-Aware)

You are the enforcement gate. Before any work proceeds, you verify that ALL applicable Novahiz rules are satisfied. The gate is now CATEGORY-AWARE — it only checks rules that matter for the current request type.

## The 13 Request Categories

| # | Category | Full Pipeline? |
|---|----------|---------------|
| 1 | `code` | Yes — all rules |
| 2 | `audit` | Yes — all rules |
| 3 | `research` | Minimal — gate pass only |
| 4 | `browser` | Gate + PW headed + memory |
| 5 | `text` | Gate + humanizer + memory |
| 6 | `config` | Gate + memory |
| 7 | `planning` | Gate + humanizer + memory |
| 8 | `trivial` | Skip everything |
| 9 | `debugging` | Yes — all rules |
| 10 | `devops` | Gate + memory |
| 11 | `database` | Yes — all rules |
| 12 | `opencode-config` | Gate + memory |
| 13 | `i18n` | Gate + humanizer + memory |

## Category → Rule Matrix

| Rule | code | audit | research | browser | text | config | planning | trivial | debugging | devops | database | opencode-config | i18n |
|------|------|-------|----------|---------|------|--------|----------|---------|-----------|--------|----------|-----------------|------|
| 1. Todo | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2. Browser headed | — | — | ❌ | ✅ | — | — | — | — | — | — | — | — | — |
| 3. Humanizer | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 4. Code review | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| 5. Memory¹ | ✅ | ⚠️ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6. INVENTORY | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 7. Tech debt | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| 8. Code ordering | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |

¹ Rule #5 (Memory) is **dynamic** — verdict computed by the Memory Necessity Engine from real mutation evidence, not static category proxy. See §Memory Necessity Engine.

### Universal Rules (apply to ALL categories, enforced regardless of matrix)

| Rule | Applies to | Enforcement |
|------|-----------|-------------|
| Rule #0 — Category classified | Every non-trivial request | `novahiz_log(rule="request_classified")` before gate; FAIL otherwise |
| Gate TTL | Every gate pass | Expires after `GATE_TTL` ms (default 15 min, `NOVAHIZ_GATE_TTL` env) |
| Gate revocation on category change | Every session | Category change revokes `gatePassed` (CHECK 6) |
| Session audit | END OF SESSION, all categories | `novahiz_audit` behavioral rule |

## How Detection Works

The enforcer plugin (`novahiz-enforcer.ts`) intercepts tool calls via `tool.execute.after`:

- **`skill(name=...)`** → updates `sessionState.skillsLoaded[]`; first load sets `skillsLoadedAt`
- **code write (`write`/`edit`/`filesystem_write_*` on code files)** → sets `firstCodeWriteAt` (Rule #8 ordering check; CHECK 3 hard-blocks the write if review skills missing)
- **`read/filesystem_read_*(filePath=...INVENTORY...)`** → sets `sessionState.inventoryConsulted = true`
- **`navigate_page/click/etc`** → sets `sessionState.browserUsed = true`, chrome-devtools-mcp via Edge = headed by default
- **`todowrite(todos=...)`** → detects code review / tech debt in todo content
- **`novahiz_log(rule="request_classified", detail="{category}")`** → sets `sessionState.requestCategory`
- **`novahiz_log(rule="memory_classified", detail="mem:*")`** → sets `sessionState.memoryOverride`
- **Mutation tracking** (file writes, Obsidian writes, bash hints) → feeds Memory Necessity Engine

The gate tool (`novahiz_gate`) reads this session state and reports real status, adapted to the category.

## Memory Necessity Engine

Rule #5 is no longer a binary "category says yes → PENDING". It uses a **Memory Necessity Engine (MNE)** that fuses three signals into a verdict:

### Signals

| Signal | Source | Weight |
|--------|--------|--------|
| **A: Mutation evidence** | Enforcer after-hook tracking (file writes, Obsidian writes, bash hints) | Primary |
| **B: Category prior** | Rule matrix `memory: true/false` | Baseline (skip if false) |
| **C: User override** | `novahiz_log(rule="memory_classified", detail="mem:*")` | Highest priority |

### Signal A: Detailed Detection

**Bash mutation detection (3-tier):**
| Tier | Pattern | Examples | Weight |
|------|---------|----------|--------|
| Strong + paths | File-write commands with extractable paths | `Set-Content path`, `echo > file`, `New-Item -Type File`, `Out-File`, `tee` | Confirmed mutation — paths added to `filesModified`, `mutationCount++` |
| Strong (no path) | File-write commands but path extraction failed | `Out-File` without clear path | `bashMutationHints += 2` |
| Weak | Package managers, scaffolding | `npm install`, `npx create-`, `pip install`, `git add`, `cargo new` | `bashMutationHints += 1` |

Path extraction handles: `-Path`, `-FilePath`, `>`/`>>`/`2>` redirections, `git add` args.

**Content hashing (no-op detection):**
Before counting a file mutation, the enforcer hashes the content and compares with the stored hash for that path. If identical (`isNoop=true`), the write is skipped — no `mutationCount` increment, no debt. This prevents false debt from re-writes, formatting-only changes, and `filesystem_write_file` calls with identical content.

Hashes use SHA-256 truncated to 12 hex chars. Binary files (`.iso`, `.exe`) are skipped. The `contentHashes` map is stored in `GateSessionState`.

### Verdict Levels

| Level | Meaning | Gate behavior |
|-------|---------|---------------|
| `done` | Memory written after all mutations | PASS |
| `skip` | No mutations detected — nothing to document | PASS |
| `likely-skip` | Only bash hints (weak signal) — cannot confirm mutations | PASS with note |
| `override` | User declared via `mem:*` prefix | PASS |
| `required` | Mutations exist since last memory write → **debt** | **FAIL** — blocks gate |

### Memory Debt (Option B)

When the engine returns `required`:
1. **Gate FAILS** — `allPass = false`, `gatePassed = false`
2. **All write tools blocked** by enforcer CHECK 1
3. **Settlement options** (only two):
   - Write to `MEMORY.md` / Obsidian (auto-detected — always exempt from CHECK 1 block)
   - `novahiz_log(rule="memory_classified", detail="mem:<class>")` to declare not needed

### Classification Hints

When verdict is `required`, the engine infers `suggestedClass` from evidence:
- Code files modified (`.ts`, `.js`, `.py`, etc.) → `major`
- >5 files modified → `major`
- Single file modified → `minor`
- Config files only (`.json`, `.yaml`, etc.) → `config`
- Default → `major` (safe)

### Flow

```
rules.memory == false?  ──YES──→ PASS (category exempts)
         │
         NO
         │
computeMemoryNecessity(state)
         │
    ┌────┴────┐
    │  level  │
    └────┬────┘
         │
done/skip/likely-skip/override → PASS
required → FAIL (memory debt)
```

## Workflow

### Step 0: CLASSIFY (MANDATORY — before gate)

Before calling the gate, the agent MUST classify the request:
```
novahiz_log(rule="request_classified", status="pass", detail="{category}")
```

### Pre-Task Gate (MANDATORY for non-trivial)

Before starting work (except `trivial`), call `novahiz_gate`. It will:
1. Read `sessionState.requestCategory`
2. Apply the category-specific rule matrix
3. Only check rules marked ✅ for the current category
4. Report PASS/FAIL per applicable rule

### Gate Output Format

When a rule fails:
```
🚨 GATE CHECK FAILED

Catégorie: {category}
Règle #X: [rule description]
Statut: ÉCHOUÉ
Action requise: [what needs to happen]

[Automatic fix if possible, or instruction to user]
```

When all rules pass:
```
GATE CHECK PASSED — All rules satisfied for category {category}. Work authorized.
```

### Self-Healing

When a rule fails and the fix is automatic:
1. Apply the fix (add missing task, load missing skill)
2. Re-run the gate check
3. If still failing → report to user

Example:
```
🚨 GATE: Règle #4 — Code review non planifié (catégorie: code)
→ Ajout automatique de la tâche 'Code review' au Todo
✅ GATE: Règle #4 — Corrigé
```

## AUDIT TRAIL (MANDATORY)

The enforcer automatically logs compliance events via `tool.execute.after`. Manual logging via `novahiz_log` supplements this for rules not automatically detected.

- Rule failure (before self-heal or block) → status="fail"
- Hard block (no automatic fix) → status="block"
- User override → status="skip"
- All rules pass → status="pass"
- Category classified → log with detail="{category}"

This log feeds `novahiz-compliance.json` and the daily `novahiz-validate.ts` script.

## Anti-Patterns

- NEVER skip the gate check because "it's a small task"
- NEVER bypass the gate because "I already know the rules"
- NEVER assume the gate passed without checking
- NEVER let work proceed with a failed gate without explicit user override
- NEVER skip tech debt detection during code reviews — it's now mandatory
- NEVER write code before loading code-review-excellence + tech-debt-detector — CHECK 3 blocks the write
- NEVER let code written without a scheduled review pass the gate — Rule #4 is a hard FAIL once code exists
- NEVER apply full pipeline rules to trivial/research requests — waste of tokens

## User Override

If the user explicitly says "passe le gate" or "skip la vérification":
1. Log the override
2. Proceed with a warning
3. Still perform post-task verification

This is the ONLY way to bypass the gate. Agent judgment is NOT a valid bypass.
