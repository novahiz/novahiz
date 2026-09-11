# Providers

Novahiz treats external MCP tool servers as first-class providers. The registry tells Novahiz which servers exist, what they do, and which categories they serve. The classifier then surfaces the relevant servers for a task, and the opencode plugin registers the missing ones automatically.

## Registry

`catalog/providers.json` is the versioned source of truth. Each entry:

```json
{
  "id": "playwright",
  "label": "Playwright browser",
  "transport": "local",
  "command": ["playwright-mcp"],
  "purpose": "Navigate, screenshot, and interact with web pages.",
  "categories": ["browser", "design-ui"]
}
```

Fields:

- `id`: the MCP server key. The plugin never overwrites an existing key of the same name.
- `transport`: `local` (a command) or `remote` (a URL).
- `command` or `url`: how to start or reach the server.
- `purpose`: one line, injected by the enforcer and shown by `novahiz providers`.
- `categories`: the categories this provider serves. This drives the mapping from a prompt to its tooling.

Bundled providers: `playwright` (browser, design-ui), `security` (audit), `narsil` (code, debug, review, audit), `context7` (code, research), `sequential-thinking` (planning, debug, audit), `cron` (devops, general).

## Mapping

`classify` returns a `providers` list: the union of the providers whose categories intersect the selected categories. The opencode enforcer injects that list, so the model knows which tool servers fit the task. Check it from the CLI:

```
node src/cli.ts classify "ouvre la page web et capture un screenshot"
node src/cli.ts providers --category audit
```

## Registration

The opencode plugin registers every enabled provider through the plugin `config` hook, calling `novahiz providers --mcp-json` and merging any server whose key is not already present. Existing configuration always wins. The plugin's own `novahiz` server is registered the same way.

Control it in `novahiz.config.json`:

```json
{
  "providers": {
    "autoRegister": true,
    "disabled": ["cron"]
  }
}
```

- `autoRegister`: set to `false` to register nothing.
- `disabled`: server ids to skip.

Host-specific settings, such as a Chrome profile path for Playwright, belong in the harness config, not in the registry. The registry keeps a portable default command; the harness entry overrides it because the plugin does not overwrite existing keys.

## Tools

- `novahiz providers` lists providers, optionally by `--category` or a query.
- `novahiz providers --mcp-json` prints the MCP entry map.
- MCP `novahiz_providers` exposes the same over stdio.
- `novahiz report` lists the provider ids.
