---
description: Reinstall every optional skill pack (dart, flutter, expo, impeccable) cleanly from their official providers. Arguments: $ARGUMENTS
---

1. Locate the Novahiz home: `NOVAHIZ_HOME` if set, otherwise `~/.config/novahiz`.

2. Confirm `git` is on the PATH (`git --version`). The official skills CLI
   behind every skill provider needs it; without it the install fails
   silently. If git is missing, tell the user to install it first
   (Windows: `winget install Git.Git`) and stop.

3. Reinstall/update every provider from the official registry
   (`catalog/providers.json` - dart-lang/skills, flutter/agent-plugins,
   expo/skills, pbakaus/impeccable, plus the provider MCP servers):

   `node <home>/src/cli.ts deps --install --yes`

4. Refresh the Impeccable CLI and engine from npm (official package):

   `npm install -g impeccable`
   `impeccable install --global --yes --force`

5. Realign the skill index:

   `node <home>/src/cli.ts sync`

6. Verify with `node <home>/src/cli.ts doctor`: the `Referenced skills` row
   must show every pack present (the 7 `eas-*` paid-service skills stay
   excluded by design). Report what was reinstalled.
