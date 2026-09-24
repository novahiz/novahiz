---
name: novahiz-init
description: |
  novahiz-init bootstraps Novahiz inside a project: memory skeleton, novahiz-docs/,
  deep read of the codebase, documentation fill-in, and a reviewed cleanup list.
  Use when the user says "/novahiz init", "init novahiz", "initialize novahiz in this project",
  "set up project docs and memory", or wants a one-shot project onboarding.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
---

# novahiz-init

One entry point to bring Novahiz into the current project: scaffold first, then deepen with an agent read.

## When to run

- `/novahiz init` or `novahiz init` in the project root
- A new repo needs docs + `project-memory/`
- Docs or memory are missing after a clone

Do **not** use this to install Novahiz on the machine. That stays `novahiz setup` / `install.mjs`.

## Pipeline

```
1. CLI scaffold     novahiz init [--dry-run] [--docs-only|--memory-only]
2. Deep read        novahiz-analyse on the real code
3. Fill docs        novahiz-docs templates already created by CLI
4. Seed memory      memory_write a baseline slot from findings
5. Cleanup review   confirm list, then novahiz init --apply --json
```

### 1. Scaffold (CLI, deterministic)

From the project root:

```
novahiz init --dry-run --json
```

Review the plan, then run without `--dry-run` unless the user only wanted a preview.

Flags:

| Flag | Effect |
|---|---|
| `--dry-run` | Print steps and cleanup candidates, write nothing |
| `--docs-only` | Only `novahiz-docs/` |
| `--memory-only` | Only `project-memory/` |
| `--no-seed` | Create memory root without the baseline slot |
| `--apply` | Delete the listed cleanup candidates (never without review) |
| `--json` | Machine-readable result |

The CLI creates:

- `project-memory/index.json` + `slots/` (plus one baseline slot unless `--no-seed`)
- `novahiz-docs/{ARCHITECTURE,CONVENTIONS,DECISIONS,STANDARDS}.md` from the `novahiz-docs` templates when the folder is absent
- A cleanup candidate list (logs, `*.orig`, `*.novahiz-bak`, …). Nothing is deleted without `--apply`.

### 2. Deep read

Load `novahiz-analyse` and walk manifests, entry points, and data flow. Every claim cites a path. This step is agent work; the CLI does not invent architecture.

### 3. Fill documentation

Edit only the four files under `novahiz-docs/`:

- Replace HTML comment placeholders with observed facts
- Keep DECISIONS.md empty until a real decision exists
- If older docs live in `README.md` or `docs/`, migrate unique facts into the right file, then leave a pointer in the README. Do not delete the README.

On frontend design docs or style copy, load `novahiz-humanizer` (R13). Outside design it is not required by the gate.

### 4. Seed memory

After docs are filled, append one slot via MCP `memory_write` or `novahiz init` baseline (already written by CLI):

- stack and markers
- entry points
- where docs live
- open unknowns

### 5. Cleanup (optional, reviewed)

1. Show the CLI cleanup list to the user.
2. Use the `question` tool: apply all, apply none, or hand-pick.
3. Only after an explicit choice:

```
novahiz init --apply --json
```

`--yes` alone is never enough to delete files the user has not seen.

## Exit criteria

- `novahiz init --json` has `failed: []`
- `novahiz-docs/` has four files with no remaining fill-in comments on architecture/conventions/standards
- `project-memory/` has at least one slot
- Cleanup either applied with consent or left unapplied on purpose

## Pitfalls

- Running `novahiz init` thinking it installs the global tool (`setup` does that).
- Filling templates with guessed architecture instead of a real read.
- Deleting cleanup candidates without showing the list.
- Duplicating content that already belongs in `novahiz-docs` update / converge.
