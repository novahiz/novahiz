---
name: novahiz-docs
description: |
  novahiz-docs manages the project documentation lifecycle: init creates the structure,
  update keeps it current, check reports drift. Use to set up project documentation or keep
  existing docs in sync with the codebase.
  Triggers on: "init docs", "documentation structure", "sync docs", "docs drift",
  "project documentation".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-docs

Documentation for a project that evolves with its code. Three commands drive the lifecycle: init, update, check through converge.

## Commands

### init

Creates `novahiz-docs/` with four files:

```
novahiz-docs/
  ARCHITECTURE.md    system shape, components, data flow
  CONVENTIONS.md     naming, style, patterns in force
  DECISIONS.md       ADR log
  STANDARDS.md       quality, testing, security bar
```

Process:

1. Scan manifests, tree, configs, and any existing docs.
2. Detect stack, patterns, and conventions already in the code.
3. Fill each template with observed facts only.
4. Show the result for confirmation before writing.

Detection sources:

| File | Where the facts come from |
|---|---|
| ARCHITECTURE.md | directory layout, entry points, imports, configs |
| CONVENTIONS.md | code patterns, lint config, naming styles |
| DECISIONS.md | empty at creation, grows as decisions land |
| STANDARDS.md | test framework, CI config, security tools present |

### update

Runs a manual refresh against the current project state.

1. Read what the docs say today.
2. Scan the project as it stands.
3. Diff the two: changed, new, stale.
4. Propose the edits through the `question` tool.
5. Apply only what the user accepts.

### Drift check through converge

When `novahiz-converge` runs and `novahiz-docs/` exists, it looks for architectural drift (new modules, dependencies, patterns), flags stale sections, and adds proposals to the convergence report. Nothing is written without user confirmation. If the folder is absent, the check is skipped.

## Template contents

Each template ships as a file under `templates/` with section headers and fill-in comments. The sections are:

- **ARCHITECTURE.md**: overview, components table, data flow, dependencies, entry points.
- **CONVENTIONS.md**: naming table, code style, testing, git habits.
- **DECISIONS.md**: one ADR block per decision (date, status, context, decision, consequences).
- **STANDARDS.md**: quality bar, security practices, performance budgets, documentation duties.

## Pitfalls

- Docs nobody opens. Write what a new contributor must know, not a mirror of the code.
- Describing what the code does instead of why the shape is this way.
- Letting the files drift until the next big rewrite forces a cleanup.
- Building a doc structure heavier than the project itself.
