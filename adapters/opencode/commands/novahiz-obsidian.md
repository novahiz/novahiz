---
description: Initialize Obsidian vault structure for the active project. Arguments: $ARGUMENTS
---

1. Locate the Novahiz home: `NOVAHIZ_HOME` if set, otherwise `~/.config/novahiz`. The CLI is `<home>/src/cli.ts`.

2. If `$ARGUMENTS` is `init` (or empty), first run the preview from the project directory (the active project — its cwd gives the name, its dependencies the routing):

   `node src/cli.ts second-memory project-init --dry-run --json`

   Show the routed chain and the mirrored files. Unless the user only wanted the preview, run it for real:

   `node src/cli.ts second-memory project-init --json`

   Extra flags when the routing must be forced: `--project <name>`, `--domain <Domain> --branch <Branch>` (both together).

3. What it does — additive and idempotent, nothing existing is overwritten:
   - creates the project chain `Code/<branch>/{memory,docs}/<project>/` (folders, `_MOC.md` links at every level, `INDEX.md` entry, domain activated whole);
   - writes the routing binding in a `vault.json` sidecar at the memory root `sync` uses
   (`project-memory/vault.json` in the project, or `~/.config/project-memory/` when that
   global root exists — future `second-memory sync` runs send this project's slots and doc
   mirror to the bound chain instead of guessing by content keywords);
   - mirrors `novahiz-docs/*.md` into the docs chain (source of truth stays the repo).

4. Exit codes: 0 created or nothing to do; 1 when the vault is absent (run `node src/cli.ts second-memory init` first), when routing is impossible from the project signal (rerun with `--domain`/`--branch`), or on an unknown flag.

5. Report the bound chain (`Code/.../<project>/`), the binding line, and every file created or mirrored. If the branch picked by the keywords looks wrong, rerun with `--domain <D> --branch <B>` before any note exists. Never claim a folder you did not create.
