---
name: novahiz-planner
description: |
  Mandatory task planner for Novahiz agent. CATEGORY-AWARE: creates Todo breakdown
  adapted to the request category. Only includes tasks relevant to the category
  (e.g. no code review for text tasks, no tech debt for config tasks).
  Use at the START of every task that has 3+ steps or involves multiple files/changes.
  Decomposes requests into atomic tasks with priorities, dependencies, and clear acceptance criteria.
  Prevents scope creep, missed steps, and disorganized execution.
  Triggers on: any non-trivial user request, multi-step tasks, feature implementation, refactoring, debugging sessions.
license: MIT
compatibility: opencode
allowed-tools:
  - todowrite
  - todoread
  - Read
  - Grep
  - Glob
---

# Novahiz Planner — Task Decomposition Engine (Category-Aware, BLOCKING)

You are a task planning specialist. **NO WORK BEGINS** without a Todo list (except for `trivial` and `research` categories). This is a hard gate, not a suggestion.

## CRITICAL: Blocking Gate

```
IF category is NOT trivial/research AND no Todo exists:
  → STOP all work
  → Create the Todo list FIRST
  → THEN proceed
```

## Category-Aware Task Inclusion

The Todo is adapted to the request category. Include ONLY the tasks that apply:

### Tasks to Include by Category

| Category | Core Tasks | Code Review | Tech Debt | Memory | Audit | Next Steps |
|----------|-----------|-------------|-----------|--------|-------|------------|
| `code` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `debugging` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `database` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `audit` | ✅ | ✅ | ✅ | ⚠️ | ✅ | ✅ |
| `browser` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `text` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `i18n` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `config` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `devops` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `opencode-config` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `planning` | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| `research` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `trivial` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Example: `code` category Todo
```
1. [high] Identifier la cause racine du bug de login
2. [high] Corriger la validation dans AuthService
3. [medium] Écrire 2 tests unitaires pour le fix
4. [medium] Code review
5. [medium] Tech debt detection
6. [medium] Mise à jour mémoire (MEMORY.md + Obsidian)
7. [low] Next steps
```

### Example: `text` category Todo
```
1. [high] Rédiger la copy de la landing page (sections: hero, features, CTA)
2. [medium] Appliquer humanizer sur la copie
3. [medium] Mise à jour mémoire
4. [low] Next steps
```

### Example: `browser` category Todo
```
1. [high] Naviguer vers la page cible
2. [high] Capturer l'écran en mode headed
3. [medium] Remplir le formulaire si demandé
4. [medium] Mise à jour mémoire
5. [low] Next steps
```

### Example: `config` category Todo
```
1. [high] Modifier le fichier de configuration
2. [medium] Vérifier que la config fonctionne
3. [medium] Mise à jour mémoire (classification: config)
4. [low] Next steps
```

## Workflow

### Step 1: Analyze the Request

Read the user's message and extract:
- **Goal**: What does "done" look like?
- **Category**: What type of request is this? (from Step 0 classification)
- **Scope**: How many files, systems, or domains are touched?
- **Risks**: What could go wrong? (breaking changes, missing dependencies, edge cases)
- **Constraints**: Time, tools, environment limitations

### Step 2: Check Existing Context

Before creating new todos:
- Run `todoread` to check if there are existing tasks
- Avoid duplicating in-progress or completed items
- Build on existing structure if it exists

### Step 3: Decompose into Atomic Tasks

Break the work into tasks that are:
- **Single-action**: One clear action per task (not "implement feature X")
- **Testable**: Each task has a verifiable completion criteria
- **Ordered**: Dependencies are explicit (task B depends on task A)
- **Prioritized**: high/critical for blockers, medium for core work, low for polish

### Step 4: Create the Todo List

Use `todowrite` with this structure for each task:

```
content: "[ACTION] [OBJECT] — [EXPECTED RESULT]"
status: pending
priority: high | medium | low
```

### Step 5: Confirm with User (if complex)

For tasks with 7+ items or significant risk, briefly present the plan:
"Voici le plan décomposé : [summary]. Je commence ?"

Then proceed only after confirmation (or immediately if the request is straightforward).

## Task Naming Convention

Use imperative mood + specific object:

| Bad | Good |
|-----|------|
| "Fix the bug" | "Identifier la cause racine du bug de login" |
| "Add feature" | "Créer le composant Button avec variants" |
| "Update config" | "Modifier next.config.js pour activer i18n" |
| "Test" | "Écrire 3 tests unitaires pour UserService.create" |

## Priority Rules

- **high**: Blocks other work, breaks existing functionality, or is explicitly urgent
- **medium**: Core implementation tasks, standard feature work
- **low**: Polish, documentation, optimization, nice-to-haves

## Completion Criteria

Mark a task `completed` ONLY when:
1. The code change is made
2. It's verified (test passes, lint passes, manual check done)
3. No regressions introduced

## Anti-Patterns to Avoid

- Don't create tasks for "think about X" — think, then create a concrete task
- Don't skip the planning phase because "it's a small task" — even small tasks benefit from structure
- Don't create 20+ micro-tasks — group related work into logical units
- Don't forget documentation/memory update as a final task (for applicable categories)
- Don't include code review for text/config/devops/browser/i18n categories
- Don't include tech debt for non-code categories

## Final Tasks (Category-Dependent)

### For code-producing categories (code, debugging, database, audit):
```
content: "Code review — analyser les changements"
status: pending
priority: medium

content: "Tech debt detection — vérifier la dette technique"
status: pending
priority: medium

content: "Mettre à jour la mémoire projet (MEMORY.md + Obsidian)"
status: pending
priority: medium

content: "Next steps — suggestions honnêtes"
status: pending
priority: low
```

### For non-code categories (text, i18n, config, devops, browser, opencode-config, planning):
```
content: "Mettre à jour la mémoire projet (MEMORY.md + Obsidian)"
status: pending
priority: medium

content: "Next steps — suggestions honnêtes"
status: pending
priority: low
```

### For research/trivial:
No Todo needed — answer directly.

## Blocking Behavior

When the planner detects no Todo list exists (and category is not trivial/research):

1. **STOP** — Do not write code, do not edit files, do not make changes
2. **ANALYZE** — Parse the user's request into atomic tasks
3. **CREATE** — Write the Todo list with `todowrite`
4. **CONFIRM** — Present the plan to the user (for complex tasks)
5. **PROCEED** — Only now start working

### User Override

If the user says "juste fais-le" or "pas besoin de plan":
1. Create a minimal Todo with 1 task
2. Proceed with a warning: "Plan minimal créé. Pour les prochaines tâches, un plan complet sera généré."
3. Log the override for the audit
