---
description: Run Novahiz diagnostics. Arguments: $ARGUMENTS
---

1. Locate the Novahiz home: `NOVAHIZ_HOME` if set, otherwise `~/.config/novahiz`. The CLI is `<home>/src/cli.ts`.

2. Run `node src/cli.ts doctor` from the Novahiz home.

3. For each failing check, provide the exact fix to run based on the returned details. For example `node src/cli.ts sync` when the index is stale, or reinstall a missing skill when `referenced` fails.
