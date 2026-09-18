---
description: Report Novahiz status. Arguments: $ARGUMENTS
---

1. Locate the Novahiz home: `NOVAHIZ_HOME` if set, otherwise `~/.config/skillenforce`. The CLI is `<home>/src/cli.ts`.

2. Run `node src/cli.ts doctor` from the Novahiz home. If it fails, report the error and stop.

3. Measure the size of `skillenforce.sqlite` and the last write date of `build/installed-skills.json`.

4. Present a short summary: blocking anomalies first, then key numbers (journal rows, invocations, database size, indexed skills).
