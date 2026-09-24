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
| `security` | `security-mcp` | [AbrahamOO/security-mcp](https://github.com/AbrahamOO/security-mcp) | MIT | audit |
| `narsil` | `narsil-mcp` | [postrv/narsil-mcp](https://github.com/postrv/narsil-mcp) | MIT OR Apache-2.0 | code, review |
| `context7` | `@upstash/context7-mcp` | [upstash/context7](https://github.com/upstash/context7) | MIT | code |
| `cron` | `scheduler-mcp` (local venv) | [PhialsBasement/scheduler-mcp](https://github.com/PhialsBasement/scheduler-mcp) | MIT | devops |
| `novahiz` | local (`mcp/novahiz-tools`) | [novahiz/novahiz](https://github.com/novahiz/novahiz) | Apache-2.0 | code, planning |
| `dart` | `dart mcp-server` (Dart SDK) | [dart-lang/ai · dart_mcp_server](https://github.com/dart-lang/ai/tree/main/pkgs/dart_mcp_server) | BSD-3-Clause | code, debug, design-ui, flutter |

`cron` runs `scheduler-mcp` (MIT) from a local clone at `C:/Users/hiz/.local/share/mcp-scheduler` with its own virtualenv. It replaced the former AGPL `mcp-cron` npm package; there is no npm install step for it.

`dart` requires the Dart SDK on `PATH` (`requires: ["dart"]`). Without it the MCP entry still registers, but the server fails to start; disable it or install the SDK.

Skill and command packs:

| Id | Install command | Upstream | License | Categories |
| --- | --- | --- | --- | --- |
| `flutter-skills` | `npx skills add flutter/agent-plugins --skill '*' -g -a opencode -y` | [flutter/agent-plugins](https://github.com/flutter/agent-plugins) | BSD-3-Clause | code, design-ui, flutter |
| `dart-skills` | `npx skills add dart-lang/skills --skill '*' -g -a opencode -y` | [dart-lang/skills](https://github.com/dart-lang/skills) | BSD-3-Clause | code, debug, flutter |
| `expo-skills` | `npx skills add expo/skills --skill expo-overview ... -g -a opencode -y` | [expo/skills](https://github.com/expo/skills) | MIT | code, expo |

Installed skills land under `~/.agents/skills` for OpenCode. They are referenced by install command, never vendored in this repository. `dart-lang/skills` is a subset of `flutter/agent-plugins` (same 15 Dart skills); both are listed for provenance.

`expo-skills` names the 17 `expo-*` skills explicitly; the 7 `eas-*` skills (paid EAS services) are excluded. When `npx skills add` cannot reach the repo (git clone failures), fetch the tarball from `codeload.github.com` and copy the skill folders into `~/.agents/skills`, then run `Novahiz sync` — that fallback was used on this machine.

Design and text skills ship as ordinary Novahiz skills under `skills/`, not as providers.

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
    "disabled": ["cron"]
  }
}
```

- `autoRegister`: register missing MCP servers on startup.
- `autoInstall`: run the official install commands during `node install/install.mjs`.
- `disabled`: provider ids to skip.

Run the install commands on demand:

```
node src/cli.ts providers --install
node install/install.mjs --install-providers
```

Installation is opt-in on purpose. The commands download third-party packages, including a large Rust binary for `narsil`, so `autoInstall` defaults to `false`. Enabling it means you trust each upstream listed in `source`.

## Dependencies

Each provider declares its prerequisites in `requires` (the executable it needs) and, when it can be bootstrapped, a per-platform `bootstrap` command. No provider currently declares a `bootstrap`; `Novahiz deps --install` supports the field for future entries.

- `npx` based providers need `npx`, which ships with Node.
- `dart` needs the Dart SDK on `PATH` (`dart --version`). Flutter installs ship it.

`Novahiz deps` checks every prerequisite and reports what is missing. `Novahiz deps --install` first bootstraps a missing prerequisite through its official installer, then runs each provider's install command. The installer runs the check on every install and, when `providers.autoInstall` is true or `--install-providers` is passed, runs the installs too.

## Troubleshooting

Check the `narsil` binary before wiring it into a harness:

```
narsil-mcp --version
narsil-mcp tools list
```

Run `tools list` instead of the bare command. Without a subcommand `narsil-mcp` starts a stdio MCP server and blocks the shell, which looks like a hang.

Common fixes:

- Stale index: rerun with `--reindex`, or clear the default index directory at `~/.cache/narsil-mcp` and reindex. On Windows that directory sits under your user profile.
- Wrong tree: pass `--repos <path>` or set `NARSIL_REPOS`, and use `--discover <dir>` when you do not know the path.
- Cache noise while debugging: `--no-cache` skips the cache, and `--cache-ttl <seconds>` moves the default 1800 second window.
- Slow startup: `--preset minimal` trims the tool surface. The default preset exposes the full set.

Confirm the tool count with `narsil-mcp tools list` afterwards, then rerun `Novahiz deps` to recheck the prerequisite.

## Tools

- `Novahiz providers` lists providers, optionally by `--category` or a query.
- `Novahiz providers --mcp-json` prints the MCP entry map.
- `Novahiz providers --install` runs the official install commands.
- `Novahiz deps [--install]` checks prerequisites and bootstraps or installs missing ones.
- MCP `novahiz_providers` and `novahiz_deps` expose the list and the dependency status over stdio.
- `Novahiz report` lists the provider ids.
