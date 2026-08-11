---
name: novahiz-memory
description: |
  Mandatory memory persistence skill for Novahiz agent. CATEGORY-AWARE: only updates
  memory for categories that require it (skips research/trivial). Updates project memory
  (MEMORY.md) AND Obsidian vault after every completed task that made changes.
  Maintains dual-write consistency between local project directory and Obsidian vault at
  C:\Users\tawhi\Documents\novahiz. Use at the END of every task that made changes.
  Triggers on: task completion, significant code changes, architectural decisions,
  bug fixes, feature additions, refactoring sessions.
license: MIT
compatibility: opencode
allowed-tools:
  - todoread
  - todowrite
  - Read
  - Glob
  - Grep
---

# Novahiz Memory — Dual-Write Persistence (Category-Aware)

You are the memory persistence engine. Every completed task that made changes MUST be recorded in two places: the local `MEMORY.md` file AND the Obsidian vault.

## CATEGORY-AWARE: When to Skip

The gate's Memory Necessity Engine (MNE) dynamically determines if memory update is needed based on real mutation evidence, not just category. The MNE verdicts map to memory actions:

| MNE Verdict | Memory Action | Gate Result |
|-------------|--------------|-------------|
| `done` | Already written — skip | PASS |
| `skip` | No mutations — skip | PASS |
| `likely-skip` | Weak bash hints only — skip with note | PASS |
| `override` | User declared via `mem:*` — follow declared class | PASS |
| `required` | Mutations exist, debt active — MUST write | FAIL until settled |

**Skip memory update entirely when:**
- MNE verdict is `done`, `skip`, or `likely-skip`
- Category is `research` or `trivial` (matrix exempts)

**Full memory update when:**
- MNE verdict is `required` and category is `code`, `debugging`, `database`, `text`, `i18n`, `devops`
- MNE suggestedClass is `major`

**Partial update when:**
- MNE suggestedClass is `minor` → changelog + log only
- MNE suggestedClass is `config` → 1-line log only

### mem:* Prefix Override

When the user prefixes with `mem:<class>`, the gate sets `memoryOverride` and clears debt for `mem:trivial`/`mem:config`. The agent MUST follow the declared class:

| Prefix | Action | Obsidian |
|--------|--------|----------|
| `mem:trivial` | MEMORY.md only | Skip |
| `mem:config` | 1-line log only | 1-line log |
| `mem:minor` | Changelog + log | Changelog + log |
| `mem:full` | Full update | Full update |

### Memory Debt Settlement

When gate FAILS with `required` verdict (memory debt active):
1. Execute memory update per MNE suggestedClass
2. Write to `MEMORY.md` AND Obsidian vault
3. Enforcer auto-detects the write → `mutationsSinceMemoryWrite` resets to 0 → `memoryDebt` clears
4. Next gate check passes

Alternative: `novahiz_log(rule=\"memory_classified\", detail=\"mem:trivial\")` to declare debt not needed.

## MEMORY.md Format

```markdown
# {ProjectName} — Mémoire

## Dernière mise à jour
{ISO date}

## Contexte
{1-2 sentences: what this project does, current state}

## Clé technique
- Langage: {language}
- Framework: {framework}
- Package manager: {npm/pnpm/yarn}
- Environnement: {Node/Bun/Deno}

## Tâches récentes
| Date | Tâche | Fichiers modifiés | Statut |
|------|-------|-------------------|--------|
| {date} | {task description} | {file list} | ✅ |

## Décisions d'architecture
- {date}: {decision and rationale}

## Bugs corrigés
- {date}: {bug description} → {solution}

## TODO / Prochaines étapes
- [ ] {honest next step — behavioral rule, no skill}
```

## Obsidian Vault Format

The Obsidian vault lives at `C:\Users\tawhi\Documents\novahiz`. It uses Obsidian-flavored Markdown with wikilinks.

### File Structure

Canonical protocol, formats, append-only rules, and maintenance: `agent/novahiz-engine.md` §3 (single source of truth).

```
novahiz/
├── index.md                        # Hub: links to all other notes
├── 01-Projects/
│   └── {category}/
│       └── {project-name}/
│           ├── 00-README.md        # Overview, architecture summary, quick links
│           ├── 01-Architecture.md  # Tech decisions, patterns, diagrams
│           ├── 02-Decisions.md     # ADRs (APPEND-ONLY)
│           ├── 03-Changelog.md     # Chronological changes (APPEND-ONLY)
│           ├── 04-Issues.md        # Known bugs, limitations, tech debt
│           └── 05-Snippets.md      # Reusable code with context
└── 08-System/
    └── log.md                      # Agent activity log
```

### Wikilink Convention

Every note must reference related notes using `[[wikilinks]]`:
- Changelog entries reference decisions: `[[02-Decisions#YYYY-MM-DD-title]]`
- Issues reference changelog entries: `[[03-Changelog#YYYY-MM-DD]]`
- `00-README.md` links to all project files

### Dual-Write Procedure

After EVERY completed task:

1. **Update MEMORY.md** (local project file)
2. **Create/Update Obsidian notes** (vault)
3. **Cross-reference** with wikilinks

Example:
```markdown
# MEMORY.md update
## Tâches récentes
| 2026-07-23 | Fixed login validation bug | src/auth.ts, src/validators.ts | ✅ |

# Obsidian: 01-Projects/code/my-app/03-Changelog.md
## 2026-07-23
- **Fixed**: Login validation bug — `[[src/auth.ts]]`, `[[src/validators.ts]]`
- **Decision**: Used zod schema instead of manual validation
- **Related**: [[02-Decisions#2026-07-23-validation-approach]]
```

### Classification Rules (aligned with MNE suggestedClass)

| Category | MNE suggestedClass | MEMORY.md | Obsidian | Tags |
|----------|-------------------|-----------|----------|------|
| code | major | Full update | Full update | #code #feature |
| debugging | major | Full update | Full update | #debug #bugfix |
| database | major | Full update | Full update | #database #schema |
| audit | minor | Changelog + log | Full update | #audit |
| browser | minor | Log only | Log only | #browser #automation |
| text | major | Full update | Full update | #copywriting #content |
| i18n | major | Full update | Full update | #i18n #localization |
| config | config | 1-line log | 1-line log | #config |
| devops | major | Full update | Full update | #devops #infra |
| opencode-config | config | 1-line log | 1-line log | #config #opencode |
| planning | minor | Log only | Log only | #planning |
| research | — | Skip | Skip | — |
| trivial | — | Skip | Skip | — |

## Memory Buffer System

### Buffer Rules
- Buffer max: 5 entries per memory category
- Flush trigger: buffer full, session end, or user says "flush"
- Flush target: MEMORY.md (local project)

### Manual Buffer Management
```
novahiz_log(rule="memory_buffer_add", status="pass", detail="{category}: {summary}")
novahiz_log(rule="memory_buffer_flush", status="pass", detail="flushed {count} entries")
```

## Anti-Patterns

- Never create a new MEMORY.md if one exists — update it
- Never overwrite MEMORY.md — append or modify sections
- Never skip Obsidian vault update if category requires it
- Never forget cross-references with wikilinks
- Never create orphan notes in Obsidian — every note must be referenced
- Never skip memory update for code/debugging/audit tasks
- Never ignore memory debt — gate will block all writes until settled
- Never use `mem:trivial` to dodge legitimate memory requirements (gate logs the override)
