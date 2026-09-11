# novahiz-tools

A dependency-free MCP server that exposes the Novahiz core as tools.

Tools:

- `novahiz_classify` classifies a prompt and returns the required skills and roadmaps.
- `novahiz_catalog` ranks catalogued skills by relevance to a query.
- `novahiz_roadmap` returns the roadmap for a category or a prompt.
- `novahiz_providers` lists the registered MCP providers, optionally for a category or a prompt.
- `novahiz_step` records or lists roadmap step progress for a session.
- `novahiz_list_skills` lists installed skills, optionally by category.
- `novahiz_gate` checks a file edit against the rules and returns the verdict.

It speaks newline-delimited JSON-RPC over stdio. No npm install is needed.

Run it directly:

```
node mcp/novahiz-tools/index.mjs
```

Register it in a harness with a stdio server pointing at that command. The opencode plugin registers it automatically through the plugin `config` hook.
