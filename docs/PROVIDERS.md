# Providers

A provider is an external component Novahiz can provision and reference: an MCP server, a skill pack, or a command pack. Novahiz does not vendor them. It stores the official install command and, when you ask, runs it during installation.

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
  "categories": ["browser", "design-ui"],
  "purpose": "Navigate, screenshot, and interact with web pages in a real browser."
}
```

- `kind`: `mcp`, `skill`, or `commands`.
- `command` and `transport`: for `mcp` providers, how to start or reach the server. The opencode plugin registers these.
- `install`: the official install or warm-up command. This is what the installer runs.
- `source`: the upstream project.
- `categories`: which categories the provider serves. This drives the mapping from a prompt to its tooling.

## Bundled providers

MCP servers:

| Id | Purpose | Categories |
| --- | --- | --- |
| `playwright` | Browser automation | browser, design-ui |
| `security` | SAST/DAST and compliance | audit |
| `narsil` | Code intelligence | code, debug, review, audit |
| `context7` | Library docs | code, research |
| `sequential-thinking` | Structured reasoning | planning, debug, audit |
| `cron` | Scheduling | devops, general |

Skill and command packs:

| Id | Kind | Install | Categories |
| --- | --- | --- | --- |
| `impeccable` | skill | `npx -y impeccable install --providers=opencode --scope=global` | design-ui |
| `speckit` | commands | `uv tool install specify-cli` | planning, code |

`speckit` installs the Spec Kit CLI only. Initializing a project is a separate, per-project step (`specify init`). It needs `uv` on the PATH.

## Mapping

`classify` returns a `providers` list: every provider whose categories intersect the selected categories (any kind). The opencode enforcer injects that list under `Outils pour cette tache`.

```
node src/cli.ts classify "ouvre la page web et capture un screenshot"
node src/cli.ts providers --category design-ui
```

## Registration and install

- MCP servers: the opencode plugin registers every enabled `mcp` provider through the plugin `config` hook, calling `novahiz providers --mcp-json` and merging any server whose key is missing. Existing configuration always wins, so host-specific settings (a Chrome profile path, for example) are preserved.
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

## Tools

- `novahiz providers` lists providers, optionally by `--category` or a query.
- `novahiz providers --mcp-json` prints the MCP entry map.
- `novahiz providers --install` runs the official install commands.
- MCP `novahiz_providers` exposes the list over stdio.
- `novahiz report` lists the provider ids.
