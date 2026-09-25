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
- `novahiz_deps` reports provider dependency status.
- `novahiz_task` drives the durable task ledger (create, plan, todo, start, done, block, review, amend, insert, drop, reorder, signals, status, resume, current).
- `novahiz_dispatch` turns pending todos into work packets and reports file-ownership conflicts.
- `memory_init` creates the `project-memory/` skeleton (index + slots) under a project root.
- `memory_list` lists project-memory slots from `index.json`.
- `memory_get` reads one slot (frontmatter, Résumé, Détails).
- `memory_write` appends a dated entry to the matching slot, rotating when full.
- `memory_rebuild` regenerates `index.json` from the slot markdown files.

It speaks newline-delimited JSON-RPC over stdio. No npm install is needed.

Run it directly:

```
node mcp/novahiz-tools/index.mjs
```

Register it in a harness with a stdio server pointing at that command. The opencode plugin registers it automatically through the plugin `config` hook.
