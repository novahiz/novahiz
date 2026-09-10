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

The installer runs `git`-free and never deletes your files. It:

1. Copies the core, the bundled skills, and the plugin into place.
2. Merges `skills/` into your opencode skills directory.
3. Drops the opencode plugin into the plugins directory.
4. Writes `novahiz.config.json` only if it does not exist.
5. Builds the catalog with `sync`.

Restart opencode afterward. The plugin registers the Novahiz MCP server automatically, so you do not edit `opencode.jsonc` by hand.

## Options

- `--home <path>` installs the core to a custom location.
- `--scope project` targets `./.opencode` instead of the global config.
- `--dry-run` prints the actions and writes nothing.
- `--no-skills` skips the bundled skills.
- `--force` rewrites `novahiz.config.json` (the previous file is backed up as `novahiz.config.json.novahiz-bak`).
- `--yes` runs without prompts. This is the default; the flag is accepted for scripts.

## What it touches

The installer merges `skills/` into your opencode skills directory and writes the plugin. Any file it overwrites is copied first to `<file>.novahiz-bak`, and the list is stored in `.novahiz-install.json`. It never deletes a file it did not create.

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

The MCP server works with any harness that supports stdio MCP servers. Point it at:

```
node ~/.config/novahiz/mcp/novahiz-tools/index.mjs
```

Dedicated adapters for Claude Code, Codex, and Cursor are planned. Until then those harnesses get the classifier and the MCP tools, without the blocking gate.
