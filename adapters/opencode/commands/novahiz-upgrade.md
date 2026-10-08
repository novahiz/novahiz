---
description: Check for a new Novahiz version and update it via npm. Arguments: $ARGUMENTS
---

1. Run the version check. Prefer the global CLI when available: `novahiz upgrade`. If `novahiz` is not on PATH, locate the Novahiz home (`NOVAHIZ_HOME` if set, otherwise `~/.config/novahiz`) and run `node src/cli.ts upgrade` from there.

2. If the output reports "up to date", confirm it in one sentence and stop.

3. If an update is available, report the installed -> latest versions, then ask the user for explicit approval. Never run the update without that approval (skip this confirmation only when `$ARGUMENTS` contains `--yes`).

4. After approval, run `novahiz upgrade --apply` (same CLI used in step 1). This runs `npm install -g novahiz@latest` for npm installs, or `git pull --ff-only` plus a catalog rebuild for source checkouts. Report the exact result, including any npm/git error verbatim — never claim success you did not observe.

5. Finish by telling the user to restart OpenCode completely so the new version loads. Offer `novahiz doctor` as the follow-up check.
