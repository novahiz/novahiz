---
description: Initialize Novahiz in this project (memory, docs, analysis, reviewed cleanup)
---

Load the `novahiz-init` skill and follow its pipeline from the current working directory.

1. Run `novahiz init --dry-run --json` and show the plan.
2. Unless the user only wanted a preview, run `novahiz init --json`.
3. Deep-read the project (`novahiz-analyse`), fill `novahiz-docs/`, seed memory.
4. Offer cleanup only after listing candidates; apply solely on explicit consent.
