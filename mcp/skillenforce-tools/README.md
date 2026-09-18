# skillenforce-tools

A dependency-free MCP server that exposes the Novahiz core as tools.

Tools:

- `skillenforce_classify` classifies a prompt and returns the required skills and roadmaps.
- `skillenforce_catalog` ranks catalogued skills by relevance to a query.
- `skillenforce_roadmap` returns the roadmap for a category or a prompt.
- `skillenforce_providers` lists the registered MCP providers, optionally for a category or a prompt.
- `skillenforce_step` records or lists roadmap step progress for a session.
- `skillenforce_list_skills` lists installed skills, optionally by category.
- `skillenforce_gate` checks a file edit against the rules and returns the verdict.
- `skillenforce_deps` reports provider dependency status.
- `skillenforce_task` drives the durable task ledger (create, plan, todo, start, done, block, review, amend, insert, drop, reorder, signals, status, resume, current).
- `skillenforce_dispatch` turns pending todos into work packets and reports file-ownership conflicts.

It speaks newline-delimited JSON-RPC over stdio. No npm install is needed.

Run it directly:

```
node mcp/skillenforce-tools/index.mjs
```

Register it in a harness with a stdio server pointing at that command. The opencode plugin registers it automatically through the plugin `config` hook.
