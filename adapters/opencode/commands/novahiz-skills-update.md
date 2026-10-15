---
description: Install any missing skill pack and refresh every installed pack (dart, flutter, expo, impeccable) from their official providers. Arguments: $ARGUMENTS
---

1. Locate the Novahiz home: `NOVAHIZ_HOME` if set, otherwise `~/.config/novahiz`.

2. Confirm `git` is on the PATH (`git --version`). The official skills CLI
   behind every skill provider needs it; without it the install fails
   silently. If git is missing, tell the user to install it first
   (Windows: `winget install Git.Git`) and stop.

3. Install whatever pack is missing from the official registry
   (`catalog/providers.json` - dart-lang/skills, flutter/skills,
   expo/skills, pbakaus/impeccable, plus the provider MCP servers):

   `node <home>/src/cli.ts deps --install --yes`

   This step only *fills gaps*. Every pack already on disk is skipped by
   design (`installedWhen` satisfied), so it can never bring an installed
   pack up to date — that is what step 4 is for.

4. Refresh the installed packs from upstream. This is the real update: it
   runs each provider's `update` command, which for the skills CLI is the
   upstream `skills update -g -y` subcommand and covers dart, flutter, expo
   and impeccable in one pass:

   `node <home>/src/cli.ts deps --install --update --yes`

   Confirm the JSON reports `"step": "update"` with `"ok": true` (a shared
   command lists every provider under `covers`). If it reports
   `"step": "install"` instead, the `--update` flag did not reach the CLI —
   stop and say so rather than reporting an update that never ran.

5. Refresh the Impeccable CLI and engine from npm (official package):

   `npm install -g impeccable`
   `impeccable install --global --yes --force`

6. Realign the skill index:

   `node <home>/src/cli.ts sync`

7. Verify with `node <home>/src/cli.ts doctor`: the `Referenced skills` row
   must show every pack present (the 7 `eas-*` paid-service skills stay
   excluded by design). Report what was installed and what was updated,
   separately — never call a skipped pack an update.
