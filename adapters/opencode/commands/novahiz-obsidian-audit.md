---
description: Audit AND auto-fix the whole Obsidian data arborescence: structure, links, coherence. Runs doctor --apply (category by category), then sync --apply, then lint. Arguments: $ARGUMENTS
---

1. Locate the Novahiz home: `NOVAHIZ_HOME` if set, otherwise `~/.config/novahiz`. The CLI is `<home>/src/cli.ts`.

2. Run `node src/cli.ts second-memory doctor --apply $ARGUMENTS` from the Novahiz home. This **auto-fixes** everything category by category: missing folders created, MOCs created, links repaired, root notes relocated, naming fixed. Every moved file is backed up first. Pass `--no-plugins` to skip the mandatory plugin check, `--json` for structured output.

3. The command exits 1 while issues remain and 0 when the vault is clean. For each `[fail]` check:
    - `skeleton` — the vault is missing `INDEX.md`, `STRUCTURE.md` or a system folder: auto-recreated by `doctor --apply`.
    - `arborescence` — a note sits at the vault root, a folder has no `_MOC.md`, a child MOC is not linked from its parent, a domain is only partially materialised, or `INDEX.md → ## Categories` does not list exactly the active domains. Auto-fixed by `doctor --apply`.
    - `links` — broken wikilinks or orphans: auto-fixed by `doctor --apply` (runs the `fix` repairs).
    - `plugins` — a mandatory community plugin is missing or disabled: auto-fixed by `doctor --apply`.
    - `outside-tree folders` (warn) — a top-level folder is not in `catalog/vault-structure.json`. Doctor does not move folders: report them and migrate their notes by hand.
    - `memory` (warn) — project memory has pending changes: auto-fixed by `sync --apply` below.

4. Then the **global coherence pass** — from the project directory, beyond what doctor checks structurally:
    - `node src/cli.ts second-memory sync --apply`: pending slot pulls/pushes AND `novahiz-docs/` mirror drift are auto-applied. Mirror drift means the repo docs moved ahead of the vault.
    - Verify the active project's binding exists (`vault.json` at the memory root `sync` uses —
    `project-memory/vault.json` or `~/.config/project-memory/vault.json`) and its chain is
    materialised (`Code/<branch>/<project>/{docs,journal,decisions}/`). A memory root without a binding
    means `project-init` never ran: notes then fall back to content-keyword routing and may
    land in `Inbox` or a wrong branch. Report every note found outside the bound chain, but
    NEVER move a note automatically — propose the move and wait for consent.
    - Consistency across the three layers (repo `novahiz-docs/` ↔ vault `docs/` chain ↔ vault `memory/` chain): same project folder spelling everywhere, no duplicate project folders (a leftover `general/` or old-chain folder next to the real one), no empty bound folder left after a rebind.
    - When doctor passes but something still looks off, run the strict pass: `node src/cli.ts second-memory lint`.

5. Report what the audit found, what was actually repaired (with the backup location), what remains — including coherence suggestions you did not apply. Never claim a repair you did not run.
