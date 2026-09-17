---
description: Clean up old Novahiz database data. Arguments: $ARGUMENTS
---

1. Locate the Novahiz home: `NOVAHIZ_HOME` if set, otherwise `~/.config/novahiz`. The CLI is `<home>/src/cli.ts`.

2. Default to `--dry-run` if no arguments are provided.

3. Present a table: target, age, rows per table, total to remove.

4. Ask the user for explicit confirmation before proceeding.

5. If confirmed, re-run the same command with `--apply` instead of `--dry-run`, then report the rows actually removed and the size before and after.

Targets: `logs` (default), `roadmap`, `sessions`, `tasks`, `all`. Flags: `--days N` (default 30), `--vacuum`, `--target <target>`.
