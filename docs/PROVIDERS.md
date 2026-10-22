# Providers

A provider is an external component Novahiz can provision and reference: an MCP server, a skill pack, or a command pack. Novahiz does not vendor them. It stores the official install command and, when you ask, runs it during installation.

## Licensing

Novahiz references providers, it never vendors them. Each entry lists the upstream `license`, and the installer runs the official install command on your machine, so you install the upstream package under its own terms. That holds for every open-source license, copyleft included.

## Registry

`catalog/providers.json` is the versioned source of truth. Each entry:

```json
{
  "id": "playwright",
  "label": "Playwright browser",
  "kind": "mcp",
  "transport": "local",
  "command": ["npx", "-y", "@playwright/mcp@latest"],
  "install": ["npx", "-y", "@playwright/mcp@latest", "--help"],
  "source": "https://github.com/microsoft/playwright-mcp",
  "license": "Apache-2.0",
  "categories": ["browser", "design-ui"],
  "purpose": "Navigate, screenshot, and interact with web pages in a real browser."
}
```

- `kind`: `mcp`, `skill`, or `commands`.
- `command` and `transport`: for `mcp` providers, how to start or reach the server. The opencode plugin registers these.
- `install`: the official install or warm-up command. This is what the installer runs.
- `source`: the upstream project.
- `license`: the upstream SPDX identifier.
- `categories`: which categories the provider serves. This drives the mapping from a prompt to its tooling.

## Bundled providers

MCP servers, with provenance from `catalog/providers.json`:

| Id | Package | Upstream | License | Categories |
| --- | --- | --- | --- | --- |
| `playwright` | `@playwright/mcp` | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Apache-2.0 | browser, design-ui |
| `novahiz-search` | local `mcp/lodestone` | [novahiz/novahiz](https://github.com/novahiz/novahiz) | Apache-2.0 | code, review |
| `novahiz-docs` | local `mcp/novahiz-docs` | [novahiz/novahiz](https://github.com/novahiz/novahiz) | Apache-2.0 | code |
| `novahiz-scheduler` | local `mcp/clepsydre` | [novahiz/novahiz](https://github.com/novahiz/novahiz) | Apache-2.0 | devops |
| `novahiz-core` | local (`mcp/novahiz-tools`) | [novahiz/novahiz](https://github.com/novahiz/novahiz) | Apache-2.0 | code, planning |
| `novahiz-gate` | local (`mcp/novahiz-gate`) | [novahiz/novahiz](https://github.com/novahiz/novahiz) | Apache-2.0 | code, planning |
| `novahiz-scan` | local `mcp/argus` | [novahiz/novahiz](https://github.com/novahiz/novahiz) | MIT | audit |
| `dart` | `dart mcp-server` (Dart SDK) | [dart-lang/ai · dart_mcp_server](https://github.com/dart-lang/ai/tree/main/pkgs/dart_mcp_server) | BSD-3-Clause | code, debug, design-ui, flutter |

> Server ids follow the `novahiz-<function>` convention — `novahiz-search` (workspace index, folder `mcp/lodestone`), `novahiz-scheduler` (folder `mcp/clepsydre`), `novahiz-scan` (folder `mcp/argus`), `novahiz-core` (folder `mcp/novahiz-tools`), `novahiz-gate`, `novahiz-docs`. Folders keep their historical names; tool names are unchanged.

`novahiz-scheduler` is the local scheduler (own cron parser, atomic JSON store, stdio MCP server) written in this repository under `mcp/clepsydre`. It has zero npm dependency and no install step: the `command` points straight at `index.mjs`. It replaced the former AGPL `mcp-cron` package and the `scheduler-mcp` venv clone — no third-party scheduler code is used or vendored.

`security` (`security-mcp`) has been removed and must never be reinstalled — explicit user decision, 2026-10-05 ("jamais réinstallés"). The entry is gone from `catalog/providers.json`; `install.mjs` keeps its MCP install list empty and purges any trace of `security-mcp` or `mcp-cron` (shim and global package) on every run; `providers.disabled` in `novahiz.config.json` keeps the id out of the registry. The `audit` category is served by `novahiz-scan` (house, clean-room).

`dart` requires the Dart SDK on `PATH` (`requires: ["dart"]`). Without it the MCP entry still registers, but the server fails to start; disable it or install the SDK.

Known limitation (single instance): `dart mcp-server` serves one running instance per machine. The connect at opencode boot succeeds, but every in-session reconnect times out (`Request timed out`) while that instance holds the server — a second process started beside it stays silent on stdin/stdout, confirmed with a direct `dart.exe mcp-server` probe. When dart's reconnect fails, restart opencode instead of expecting the retry to succeed; the boot connection is the reliable one.

Skill and command packs:

| Id | Install command | Update command | Upstream | License | Categories |
| --- | --- | --- | --- | --- | --- |
| `flutter-skills` | `npx skills add flutter/skills --skill '*' -g -a opencode -y` | `npx skills update -g -y` | [flutter/skills](https://github.com/flutter/skills) | BSD-3-Clause | code, design-ui, flutter |
| `dart-skills` | `npx skills add dart-lang/skills --skill '*' -g -a opencode -y` | `npx skills update -g -y` | [dart-lang/skills](https://github.com/dart-lang/skills) | BSD-3-Clause | code, debug, flutter |
| `expo-skills` | `npx skills add expo/skills --skill expo-overview ... -g -a opencode -y` | `npx skills update -g -y` | [expo/skills](https://github.com/expo/skills) | MIT | code, expo |
| `impeccable` | `npx skills add pbakaus/impeccable --skill impeccable -g -a opencode -y` | `npx skills update -g -y` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache-2.0 | design-ui |

Installed skills land under `~/.agents/skills` for OpenCode. They are referenced by install command, never vendored in this repository. `dart-lang/skills` is a subset of `flutter/skills` (same 15 Dart skills); both are listed for provenance.

The Flutter upstream is named `flutter/skills`, as announced in the Flutter blog post *Introducing Skills for Dart and Flutter*. The older `flutter/agent-plugins` reference resolves to the same repository — identical `main` HEAD (`0ef3972`) and identical branch list — so it is a naming alias, not a fork. Novahiz records the official name.

The three flags deviate from the plain upstream command on purpose: `-g` installs at user level instead of project level, `-a opencode` targets the OpenCode agent rather than every detected agent, and `-y` makes the run non-interactive so it can be automated. Everything else follows upstream, including the CLI version pin (`skills@1.7.0`, which already ships the `update` subcommand).

`expo-skills` names the 19 `expo-*` skills explicitly; the 7 `eas-*` skills (paid EAS services) are excluded. When `npx skills add` cannot reach the repo (git clone failures), fetch the tarball from `codeload.github.com` and copy the skill folders into `~/.agents/skills`, then run `Novahiz sync` — that fallback was used on this machine.

`impeccable` is the one design skill referenced as a provider: gate rule R14 requires it, and it installs from upstream under its own Apache-2.0 terms instead of being vendored. The other design and text skills ship as ordinary Novahiz skills under `skills/`, not as providers.

## Mapping

`classify` returns a `providers` list: every provider whose categories intersect the selected categories (any kind). The opencode enforcer injects that list under `Outils pour cette tache`.

```
node src/cli.ts classify "ouvre la page web et capture un screenshot"
node src/cli.ts providers --category design-ui
```

## Registration and install

- MCP servers: the opencode plugin registers every enabled `mcp` provider through the plugin `config` hook, calling `Novahiz providers --mcp-json` and merging any server whose key is missing. Existing configuration always wins, so host-specific settings (a Chrome profile path, for example) are preserved.
- Skill and command packs: Novahiz runs their official `install` command, it does not reimplement it.

Control it in `novahiz.config.json`:

```json
{
  "providers": {
    "autoRegister": true,
    "autoInstall": false,
    "disabled": []
  }
}
```

- `autoRegister`: register missing MCP servers on startup.
- `autoInstall`: run the official install commands during `node install/install.mjs`.
- `disabled`: provider ids to skip. Empty by default — every bundled server (`novahiz-scheduler` included) runs locally with no setup.

Run the install commands on demand:

```
node src/cli.ts providers --install --yes
node install/install.mjs --install-providers
```

Installation is opt-in on purpose. The commands download third-party packages, so `autoInstall` defaults to `false`. Enabling it means you trust each upstream listed in `source`. `novahiz-search` itself downloads nothing: it is a local file run through `node` with zero npm dependencies.

`providers --install` and `deps --install` print the plan and execute nothing until `--yes` is passed. Whatever runs then goes through a binary allowlist (`node`, `npm`, `npx`, `uv`, `uvx`, `python`, `py`) — the same one bootstrap uses — so a tampered `providers.json` cannot execute an arbitrary program.

### Install is idempotent, so it cannot refresh

`deps --install` computes its plan from `pendingInstallCommands`, which drops every pack whose `installedWhen` skills are all already on disk. A second run therefore installs nothing — that is the point, since re-running `npx skills add` for 45 present skills would be pure cost.

The same rule means `deps --install` can never bring an installed pack up to date: upstream additions and edits are simply invisible to it. `/novahiz-skills-update` used to call exactly that command, so it refreshed nothing in practice.

`deps --install --update` is the refresh path. It builds its plan from `updateCommands` instead, which reads the provider's `update` command and — unlike install — applies no `installedWhen` gate, because refreshing an up-to-date pack is precisely what was asked. Providers without an `update` fall back to re-running their install command, which re-syncs from upstream anyway.

```
node src/cli.ts deps --install           # fills gaps only
node src/cli.ts deps --install --update  # refreshes every pack
```

One global `skills update -g -y` genuinely refreshes all four sources in a single pass, so `updateCommands` deduplicates an identical argv across providers and records the ones it covers under `covers` in the plan and in the result. A plan line reading `step: "install"` with no `covers` is the old behaviour, not a refresh.

## Dependencies

Each provider declares its prerequisites in `requires` (the executable it needs) and, when it can be bootstrapped, a per-platform `bootstrap` command. No provider currently declares a `bootstrap`; `Novahiz deps --install` supports the field for future entries.

- `npx` based providers need `npx`, which ships with Node.
- `dart` needs the Dart SDK on `PATH` (`dart --version`). Flutter installs ship it.

`Novahiz deps` checks every prerequisite and reports what is missing. `Novahiz deps --install` prints the plan (bootstrap and install steps) and runs nothing; with `--yes` it first bootstraps a missing prerequisite when the command is a structured package-manager argv (`brew`, `winget`), then runs each provider's install command. Commands that need `sudo` or pipe a downloaded script into a shell are printed as `manual … - run: …` and never executed: the installer has no terminal to answer a password prompt. The installer runs the check on every install and, when `providers.autoInstall` is true or `--install-providers` is passed, runs the installs with `--yes` too.

## Troubleshooting

Check the `novahiz-search` server before wiring it into a harness:

```
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node <home>/mcp/lodestone/index.mjs
```

Run it over stdio (one JSON-RPC message per line). Without input the server waits on stdin, which looks like a hang.

Common fixes:

- No results: the index may be stale — call `lodestone_reindex`, or check with `lodestone_status` (it reports added/changed/removed files and never writes).
- Stale index storage: the FTS5 database lives in `.search/<sha12(root)>/` under the workspace; delete that folder and reindex to start clean.
- Wrong tree: pass `root` on each tool call (an existing directory), or omit it to use the server's working directory.
- Empty `tools/list`: the entry in `opencode.jsonc` is read at import — restart the harness after editing it.

Confirm the tool count (8 `lodestone_*` tools) with the `tools/list` call above, then rerun `Novahiz deps` to recheck the prerequisite.

## Tools

- `Novahiz providers` lists providers, optionally by `--category` or a query.
- `Novahiz providers --mcp-json` prints the MCP entry map.
- `Novahiz providers --install [--yes]` plans the official install commands; `--yes` executes them.
- `Novahiz deps [--install] [--yes]` checks prerequisites and plans or runs the bootstrap/install commands (privileged or downloaded-script bootstraps are printed, never run).
- MCP `novahiz_providers` and `novahiz_deps` expose the list and the dependency status over stdio.
- `Novahiz report` lists the provider ids.
