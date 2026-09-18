# Harnesses

skillenforce keeps its decisions in the CLI. A harness integration is a thin adapter that calls it. opencode is the supported harness; the MCP server stays usable from any other client.

## opencode

- Skill and plugin: `~/.config/opencode/skills/` and `~/.config/opencode/plugins/`.
- Slash commands: `~/.config/opencode/commands/` (`skillenforce-plan`, `skillenforce-clean`, `skillenforce-doctor`, `skillenforce-status`).
- MCP: the plugin registers the skillenforce server through the plugin `config` hook, so `opencode.jsonc` is not edited.
- Gate: the plugin calls `skillenforce gate` on `edit`, `write`, `patch`, `apply_patch`, `bash`, and `shell`.

The plugin exists twice. `adapters/opencode/skillenforce.ts` in the repository is the source; `~/.config/opencode/plugins/skillenforce.ts` is what opencode runs. Editing the source changes nothing until the installer recopies it, and a stale copy keeps the old behaviour without an error. After an update, run the installer and restart opencode. `skillenforce doctor` reports this as the `adapter` check.

The agent exists twice as well: `adapters/opencode/agent/skillenforce-agent.md` is the source and `~/.config/opencode/agent/skillenforce-agent.md` is what opencode loads. Both are compared by the `agent` check.

opencode denies the `question` tool to every agent by default. Only the built-in `build` and `plan` agents re-allow it, so a custom primary agent inherits the denial unless it asks. `skillenforce-agent` therefore carries `permission: { question: allow, plan_enter: allow }`. Drop that block and the pipeline can no longer ask a clarifying question or validate a plan, and the `agent` check fails.

Source: opencode plugin docs (`~/.config/opencode/plugins/`).

## Other clients

Any harness with a stdio MCP client can use the same server, `mcp/skillenforce-tools/index.mjs`, for `classify`, `catalog`, `roadmap`, `providers`, `deps`, `step`, `list_skills`, `gate`, `task`, and `dispatch`. Register it with that client's own MCP command. skillenforce writes no other harness's configuration.

## What the installer does

`node install/install.mjs` installs the opencode integration:

- Skills into `~/.config/opencode/skills/`, the plugin into `~/.config/opencode/plugins/`, the agent into `~/.config/opencode/agent/`, and the four slash commands into `~/.config/opencode/commands/`.
- The skillenforce MCP server, registered by the plugin at startup rather than written into `opencode.jsonc`.
- A skill that already exists in `~/.agents/skills` is skipped rather than copied twice, because the catalog scans both roots and two copies make it describe one version while the harness loads the other. `--force-skills` overrides.

Run it non-interactively:

```
node install/install.mjs --yes
```

Every file the installer writes is backed up first as `<file>.skillenforce-bak` and tracked in `.skillenforce-install.json`. `node install/uninstall.mjs` restores the backups and removes what it created. `--only <dir>` scopes that to one directory, and `--purge` also removes the skillenforce home.
