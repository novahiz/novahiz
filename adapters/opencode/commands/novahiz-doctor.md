---
description: Run Novahiz diagnostics. Arguments: $ARGUMENTS
---

1. Locate the Novahiz home: `NOVAHIZ_HOME` if set, otherwise `~/.config/novahiz`. The CLI is `<home>/src/cli.ts`.

2. Run `node src/cli.ts doctor` from the Novahiz home.

3. For each failing check, provide the exact fix to run based on the returned details. For example `npm install -g defuddle` when an external CLI is missing, or `node src/cli.ts sync` when the index is stale.
