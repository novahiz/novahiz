# Install

skillenforce needs Node.js 22.18 or later. There are no runtime dependencies.

## Quick install

Clone the repository into the skillenforce home and run the installer:

```
git clone https://github.com/skillenforce/skillenforce ~/.config/skillenforce
node ~/.config/skillenforce/install/install.mjs
```

On Windows, the same command works in PowerShell. If you cloned somewhere else, pass the target home:

```
node /path/to/skillenforce/install/install.mjs --home ~/.config/skillenforce
```

The installer runs `git`-free and never deletes your files. When run in a terminal it is interactive: it prints the plan and the provider list, then asks before writing anything or installing packages. It:

1. Copies the core, the bundled skills, and the plugin into place.
2. Merges `skills/` into your opencode skills directory, skipping any skill that another scanned root already provides.
3. Drops the opencode plugin into the plugins directory.
4. Writes `skillenforce.config.json` only if it does not exist.
5. Builds the catalog with `sync`.
6. Verifies provider dependencies, and installs them when you confirm or `--install-providers` is set.
7. Installs the skillenforce agent into `~/.config/opencode/agent/skillenforce-agent.md` and the four slash commands into `~/.config/opencode/commands/`.

Restart opencode afterward. The plugin registers the skillenforce MCP server automatically, so you do not edit `opencode.jsonc` by hand. See [HARNESSES.md](HARNESSES.md) for the exact paths.

## Options

- `--home <path>` installs the core to a custom location.
- `--scope project` targets `./.opencode` instead of the global config.
- `--dry-run` prints the actions and writes nothing.
- `--no-skills` skips the bundled skills.
- `--force-skills` recopies a bundled skill even when another scanned root already provides it.
- `--install-providers` runs the provider dependency bootstrap and install commands.
- `--force` rewrites `skillenforce.config.json` (the previous file is backed up as `skillenforce.config.json.skillenforce-bak`).
- `--yes` skips every prompt. Use it in scripts and CI, where there is no terminal to answer.
- `--interactive` forces the prompts even when the output is not a terminal.

## What it touches

The installer merges `skills/` into your opencode skills directory, then writes the plugin, the agent, and the slash commands. It skips a skill that already exists in `~/.agents/skills` or another root the catalog scans, because two copies of one skill make the catalog describe one version while the harness loads the other. Pass `--force-skills` to copy anyway. Any file it overwrites is copied first to `<file>.skillenforce-bak`, and the list is stored in `.skillenforce-install.json`. It never deletes a file it did not create. `node install/uninstall.mjs` restores the backups and removes what the installer created; `--only <dir>` scopes that to one directory, and `--purge` also removes the skillenforce home.

## Maintenance

Two commands keep the install healthy:

```
node ~/.config/skillenforce/src/cli.ts doctor
node ~/.config/skillenforce/src/cli.ts clean --dry-run
```

`doctor` runs nine checks: Node version, `npx`, the installed-skills index, the referenced skills, the external CLIs the skills call, a gate smoke test, the ledger database, whether the installed plugin copy matches the source, and whether the installed agent grants the `question` tool. It exits non-zero when a blocking check fails, so it works as a pre-flight in scripts.

`clean` trims old rows from the ledger, `skillenforce.sqlite`. Targets are `logs` (default), `roadmap`, `sessions`, `tasks`, and `all`; flags are `--days N` (default 30), `--dry-run`, `--apply`, `--vacuum`, and `--json`. Without `--apply` on a terminal it prints the plan and asks; without a terminal it prints the plan and exits 1, so a script cannot delete by accident.

Both accept `--json` for a machine-readable result and `--pretty` to force the human layout; with neither, they detect a terminal.

Any key you omit from `skillenforce.config.json` falls back to its default, so a file that sets only `skillRoots` is valid. `skillenforce.config.example.json` lists every key with its default and stays a superset of what you normally write.

## Verify

```
node ~/.config/skillenforce/src/cli.ts check
node ~/.config/skillenforce/src/cli.ts classify "ajoute une migration supabase avec une policy rls"
node ~/.config/skillenforce/src/cli.ts gate --file src/hero.css --tool edit
```

The last command should report missing skills and exit with code 2.

### Exit codes

`skillenforce` uses three. `0` means success. `1` means the command failed, and the reason goes to stderr on a single line prefixed with `skillenforce:`, whether the cause is a missing config, a corrupt database, an unknown command, or a numeric flag out of range. `2` means the gate refused an edit and listed the skills it wants loaded.

## Update

```
cd ~/.config/skillenforce
git pull
node install/install.mjs
```

## Uninstall

```
node ~/.config/skillenforce/install/uninstall.mjs
```

The uninstaller restores the files it backed up, deletes the files it created (based on `.skillenforce-install.json`), and prunes the directories it emptied. Options:

- `--only <dir>` scopes the whole run to one directory, so removing one integration leaves the others and their manifest entries untouched.
- `--keep-config` keeps `skillenforce.config.json`.
- `--purge` also removes the skillenforce home directory when the installer created it.
- `--dry-run` prints the actions and removes nothing.

## Other clients

Any harness with a stdio MCP client can use the server for `classify`, `list_skills`, and `gate`:

```
node ~/.config/skillenforce/mcp/skillenforce-tools/index.mjs
```

Register it with that client's own MCP command. skillenforce does not write another harness's configuration, so there is no hook to install and no gate outside opencode. See [adapters/README.md](../adapters/README.md) for the full picture.

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
