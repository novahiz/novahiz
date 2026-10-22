# Install

Novahiz needs Node.js 22.18 or later. There are no runtime dependencies.

## Quick install

```
npm install -g novahiz
novahiz doctor
```

`npm install -g` puts the CLI on your PATH. The first real `novahiz` command finishes the setup, in two passes:

1. **core** — local only: the Novahiz home, skills, plugin, agent, slash commands, config, catalog. No network, no `sudo`.
2. **extras** — providers and toolchain, global MCP servers, the Obsidian vault, the npm refresh. This is the part that downloads and installs.

npm 11.16 and later refuse to run a package's install scripts unless the package is explicitly allowed, and a global install has no `package.json` to record that approval in. The postinstall may therefore be skipped; the first-run pass covers it. To have the setup happen inside the npm install instead:

```
npm install -g --allow-scripts=novahiz novahiz
```

The two passes run the same code either way. Skip the extras with `NOVAHIZ_NO_EXTRAS=1`, skip both passes with `NOVAHIZ_AUTOINSTALL=0`.

### From a checkout

```
git clone https://github.com/novahiz/novahiz ~/.config/novahiz
node ~/.config/novahiz/install/install.mjs
```

Without a flag the installer does everything in one interactive run, as it always has. On Windows the same command works in PowerShell. If you cloned somewhere else, pass the target home:

```
node /path/to/novahiz/install/install.mjs --home ~/.config/novahiz
```

The installer runs `git`-free and never deletes your files. When run in a terminal it is interactive: it prints the plan and the provider list, then asks before writing anything or installing packages. It:

1. Copies the core, the skills, and the plugin into place.
2. Merges `skills/` into your opencode skills directory, skipping any skill that another scanned root already provides.
3. Drops the opencode plugin into the plugins directory.
4. Writes `novahiz.config.json` only if it does not exist.
5. Builds the catalog with `sync`.
6. Verifies provider dependencies, and installs them when you confirm or `--install-providers` is set.
7. Installs the Novahiz agent into `~/.config/opencode/agent/novahiz.md` and the four slash commands into `~/.config/opencode/commands/`.
8. Installs the global MCP servers and creates or verifies the Obsidian vault at `~/Documents/second-memory` — both are extras, so they run at the first CLI call when the install was core-only.

Nothing privileged is ever executed. Commands that need `sudo`, or that pipe a downloaded script into a shell, are printed with the exact line to run; the installer does not ask for a password and does not execute them. This is what makes `--core` safe to run from a postinstall, a CI job, or an agent with no terminal.

Restart opencode afterward. The plugin in `~/.config/opencode/plugins/novahiz-plugin.ts` is auto-discovered (confirmed by `opencode debug config`: `file:///…/plugins/novahiz-plugin.ts`, scope local), so it is not listed in `plugin[]` and you do not edit `opencode.jsonc` by hand. See [HARNESSES.md](HARNESSES.md) for the exact paths.

## Options

- `--core` runs only the local half: home, skills, plugin, agent, commands, config, catalog. No network, no `sudo`. This is what the npm postinstall and the first-run pass use.
- `--extras` runs only the network/system half: providers and toolchain, global MCP servers, docs index seed, Obsidian vault, npm refresh. Replay it any time with `novahiz-install --extras`.
- `--home <path>` installs the core to a custom location.
- `--scope project` targets `./.opencode` instead of the global config.
- `--dry-run` prints the actions and writes nothing. The step list tells you which steps the current mode would skip.
- `--no-skills` skips the skills copy.
- `--force-skills` recopies a skill even when another scanned root already provides it.
- `--install-providers` runs the provider dependency bootstrap and install commands.
- `--flutter-skills` installs the official skill packs from `flutter/skills` and `dart-lang/skills` via `npx skills add -g -a opencode` (upstream licences apply; nothing is vendored).
- `--force` rewrites `novahiz.config.json` (the previous file is backed up as `novahiz.config.json.novahiz-bak`).
- `--yes` skips every prompt. Use it in scripts and CI, where there is no terminal to answer.
- `--interactive` forces the prompts even when the output is not a terminal.

`--core` and `--extras` together mean "everything", which is also the behaviour when neither is given.

## What it touches

The installer configures opencode — the only harness Novahiz supports — merging `skills/` into your opencode skills directory and writing the plugin, the agent, and the slash commands; `--yes` accepts the detected configuration. It skips a skill that already exists in `~/.agents/skills` or another root the catalog scans, because two copies of one skill make the catalog describe one version while the harness loads the other. Pass `--force-skills` to copy anyway. Any file it overwrites is copied first to `<file>.novahiz-bak`, and the list is stored in `.novahiz-install.json`. It never deletes a file it did not create. `node install/uninstall.mjs` restores the backups and removes what the installer created; `--only <dir>` scopes that to one directory, and `--purge` also removes the Novahiz home.

## Maintenance

Two commands keep the install healthy:

```
node ~/.config/novahiz/src/cli.ts doctor
node ~/.config/novahiz/src/cli.ts clean --dry-run
```

`doctor` runs thirteen checks (fourteen with `--deep`): Node 22.18+, `npx`, the installed-skills index, the referenced skills, the external CLIs the skills call, a gate smoke test, the registry database, the schema version, whether the installed plugin copy matches the source, the memory module limits, the five MCP `memory_*` tools, whether the installed agent is in sync and grants the `question` tool, and the MCP config (every `opencode.jsonc` server entry resolved against the catalog). With `--deep` it additionally live-probes each configured MCP server with a JSON-RPC `initialize` handshake — all probes run in parallel, 10 s budget each. It exits non-zero when a blocking check fails, so it works as a pre-flight in scripts.

The gate kill-switch environment variable is `NOVAHIZ_GATE` (`off`, `0`, `false`, `no`, or `disabled`). The config key `gate.envEscape` exists only for schema compatibility: it cannot rename the variable. See [CONFIGURATION.md](CONFIGURATION.md).

`clean` trims old rows from the ledger, `novahiz.sqlite`. Targets are `logs` (default), `roadmap`, `sessions`, `tasks`, and `all`; flags are `--days N` (default 30), `--dry-run`, `--apply`, `--vacuum`, and `--json`. Without `--apply` on a terminal it prints the plan and asks; without a terminal it prints the plan and exits 1, so a script cannot delete by accident.

Both accept `--json` for a machine-readable result and `--pretty` to force the human layout; with neither, they detect a terminal.

Any key you omit from `novahiz.config.json` falls back to its default, so a file that sets only `skillRoots` is valid. `novahiz.config.example.json` lists every key with its default and stays a superset of what you normally write.

## Verify

```
node ~/.config/novahiz/src/cli.ts check
node ~/.config/novahiz/src/cli.ts classify "add a supabase migration with an rls policy"
node ~/.config/novahiz/src/cli.ts gate --file src/hero.css --tool edit
```

The last command should report missing skills and exit with code 2.

### Exit codes

`Novahiz` uses three. `0` means success. `1` means the command failed, and the reason goes to stderr on a single line prefixed with `Novahiz:`, whether the cause is a missing config, a corrupt database, an unknown command, or a numeric flag out of range. `2` means the gate refused an edit and listed the skills it wants loaded.

## Update

```
cd ~/.config/novahiz
git pull
node install/install.mjs
```

Do not run `novahiz upgrade` from the globally installed npm package on a machine whose plugin and adapter copies carry local migration work: it overwrites them with the published 0.3.8 files. Update from this repo with the commands above, or rerun `node install/install.mjs` afterwards to restore the local migration.

## Uninstall

```
node ~/.config/novahiz/install/uninstall.mjs
```

The uninstaller restores the files it backed up, deletes the files it created (based on `.novahiz-install.json`), and prunes the directories it emptied. Options:

- `--only <dir>` scopes the whole run to one directory, so removing one integration leaves the others and their manifest entries untouched.
- `--keep-config` keeps `novahiz.config.json`.
- `--purge` also removes the Novahiz home directory when the installer created it.
- `--dry-run` prints the actions and removes nothing.

## Other clients

Any harness with a stdio MCP client can use the core server for `classify`, `list_skills`, and the rest of the catalog, plus the gate server for `novahiz_gate`:

```
node ~/.config/novahiz/mcp/novahiz-tools/index.mjs   # novahiz-core
node ~/.config/novahiz/mcp/novahiz-gate/index.mjs    # novahiz-gate
```

Register them with that client's own MCP command. Novahiz writes configuration for opencode only — the plugin registers both servers there. See [adapters/README.md](../adapters/README.md) for the full picture.

## Publish

The package is ready for npm. Tag a release to publish:

```
git tag v0.1.0
git push origin v0.1.0
```

The release workflow runs the tests and publishes with provenance. It needs an `NPM_TOKEN` repository secret. To publish by hand instead:

```
npm publish --access public
```
