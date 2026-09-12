# Install

Novahiz needs Node.js 22.18 or later. There are no runtime dependencies.

## Quick install

Clone the repository into the Novahiz home and run the installer:

```
git clone https://github.com/novahiz/novahiz ~/.config/novahiz
node ~/.config/novahiz/install/install.mjs
```

On Windows, the same command works in PowerShell. If you cloned somewhere else, pass the target home:

```
node /path/to/novahiz/install/install.mjs --home ~/.config/novahiz
```

The installer runs `git`-free and never deletes your files. When run in a terminal it is interactive: it prints the plan and the provider list, then asks before writing anything or installing packages. It:

1. Copies the core, the bundled skills, and the plugin into place.
2. Merges `skills/` into your opencode skills directory, skipping any skill that another scanned root already provides.
3. Drops the opencode plugin into the plugins directory.
4. Writes `novahiz.config.json` only if it does not exist.
5. Builds the catalog with `sync`.
6. Verifies provider dependencies, and installs them when you confirm or `--install-providers` is set.
7. When `~/.claude` exists, installs the bundled skills into `~/.claude/skills/`, the slash commands into `~/.claude/commands/`, and the agent into `~/.claude/agents/novahiz.md`.
8. Detects Claude Code and Codex and, after your confirmation, installs their hooks and registers the Novahiz MCP server.

Restart opencode afterward. The plugin registers the Novahiz MCP server automatically, so you do not edit `opencode.jsonc` by hand. See [HARNESSES.md](HARNESSES.md) for the exact paths per harness.

## Options

- `--home <path>` installs the core to a custom location.
- `--scope project` targets `./.opencode` instead of the global config.
- `--dry-run` prints the actions and writes nothing.
- `--no-skills` skips the bundled skills.
- `--no-claude` skips the Claude Code skills, slash commands, and agent.
- `--force-skills` recopies a bundled skill even when another scanned root already provides it.
- `--install-providers` runs the provider dependency bootstrap and install commands.
- `--harness claude,codex` configures the named harnesses without prompting.
- `--force` rewrites `novahiz.config.json` (the previous file is backed up as `novahiz.config.json.novahiz-bak`).
- `--yes` skips every prompt. Use it in scripts and CI, where there is no terminal to answer.
- `--interactive` forces the prompts even when the output is not a terminal.

## What it touches

The installer merges `skills/` into your opencode skills directory and writes the plugin. It skips a skill that already exists in `~/.claude/skills`, `~/.agents/skills`, or another root the catalog scans, because two copies of one skill make the catalog describe one version while the harness loads the other. Pass `--force-skills` to copy anyway. When `~/.claude` exists it installs the same skills there, plus the four slash commands and the agent, so Claude Code runs the same pipeline; `--no-claude` skips that part. The Claude copy only skips a skill already present in `~/.agents/skills`, because Claude Code does not read the opencode skills directory. Any file it overwrites is copied first to `<file>.novahiz-bak`, and the list is stored in `.novahiz-install.json`. It never deletes a file it did not create.

## Maintenance

Two commands keep the install healthy:

```
node ~/.config/novahiz/src/cli.ts doctor
node ~/.config/novahiz/src/cli.ts clean --dry-run
```

`doctor` runs eight checks: Node version, `npx`, the installed-skills index, the referenced skills, the external CLIs the skills call, a gate smoke test, the ledger database, and whether the installed plugin copy matches the source. It exits non-zero when a blocking check fails, so it works as a pre-flight in scripts.

`clean` trims old rows from the ledger, `novahiz.sqlite`. Targets are `logs` (default), `roadmap`, `sessions`, `tasks`, and `all`; flags are `--days N` (default 30), `--dry-run`, `--apply`, `--vacuum`, and `--json`. Without `--apply` on a terminal it prints the plan and asks; without a terminal it prints the plan and exits 1, so a script cannot delete by accident.

Both accept `--json` for a machine-readable result and `--pretty` to force the human layout; with neither, they detect a terminal.

Any key you omit from `novahiz.config.json` falls back to its default, so a file that sets only `skillRoots` is valid. `novahiz.config.example.json` lists every key with its default and stays a superset of what you normally write.

## Verify

```
node ~/.config/novahiz/src/cli.ts check
node ~/.config/novahiz/src/cli.ts classify "ajoute une migration supabase avec une policy rls"
node ~/.config/novahiz/src/cli.ts gate --file src/hero.css --tool edit
```

The last command should report missing skills and exit with code 2.

## Update

```
cd ~/.config/novahiz
git pull
node install/install.mjs
```

## Uninstall

```
node ~/.config/novahiz/install/uninstall.mjs
```

The uninstaller restores the files it backed up, deletes the files it created (based on `.novahiz-install.json`), and prunes the directories it emptied. Options:

- `--keep-config` keeps `novahiz.config.json`.
- `--purge` also removes the Novahiz home directory when the installer created it.
- `--dry-run` prints the actions and removes nothing.

## Other harnesses

### Claude Code

Install a blocking `PreToolUse` hook into `~/.claude/settings.json`:

```
node ~/.config/novahiz/install/hooks.mjs --harness claude
```

The installer backs up the existing file and merges its hook group. Restart Claude Code to load it. Edits and shell writes then pass through `novahiz hook --harness claude` and are denied when a required skill is missing.

### Codex

```
node ~/.config/novahiz/install/hooks.mjs --harness codex
```

This writes `~/.codex/hooks.json`. Codex hooks fire before the edit (`PreToolUse`) and on `Stop`; because the CLI only emits a hard deny for Claude, the Codex verdict is advisory, not a block.

### MCP only

Any harness with a stdio MCP client can use the server for `classify`, `list_skills`, and `gate`:

```
node ~/.config/novahiz/mcp/novahiz-tools/index.mjs
```

See [adapters/README.md](../adapters/README.md) for the full picture.

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
