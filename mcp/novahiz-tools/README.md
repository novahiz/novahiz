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
- `memory_list` lists project-memory slots from `index.json`, with optional `status` / `tag` / `limit` filters and `preview` summaries.
- `memory_get` reads one slot (frontmatter, Résumé, Détails) — `section=meta|summary` returns only part of it.
- `memory_search` ranks slots against a free-text query (fold + IDF over title, description, tags, Résumé, Détails) and returns scored results with `confidence` and a `snippet`.
- `memory_write` appends a dated entry to the matching slot, rotating when full; routing weighs stopwords-filtered tokens, IDF over active slots and the Résumé; identical blocks are deduplicated (`duplicate: true`); the result exposes routing `confidence` (`high` / `medium` / `low`).
- `memory_update` edits an existing slot (`replace` / `append` on Détails, `summary` rewrites the bounded Résumé) — archived slots are refused.
- `memory_archive` marks a slot as archived (idempotent, no data deletion; skipped by routing and search unless `includeArchived`).
- `memory_rebuild` regenerates `index.json` from the slot markdown files.
- `snap_log` lists ledger snapshots newest first (or one manifest, by id or unambiguous prefix).
- `snap_status` reports the snapshot store: location, count, newest snapshot, size, retention, deferred captures.
- `snap_diff` compares a snapshot with another snapshot or the live ledger, row by row — read-only.
- `snap_restore` puts the ledger back to a snapshot: it rewrites rows inside one transaction (the file is never replaced, so open connections keep working), writes a safety backup first, then snapshots the restored state. It refuses unless `force` is `true`.
- `graph_find` locates symbol declarations by name in the auto-indexed workspace: exact match first, then case-insensitive, then substring — each hit carries file, span, enclosing scope and a whitespace-collapsed signature (replaces `graft_find_code`).
- `graph_find_all` returns every masked occurrence of an identifier — strings, comments, template text and regex literals excluded — grep-like, with per-file counts and line numbers (replaces `graft_find_all`).
- `graph_trace` walks the call graph from one symbol: callers and/or callees over N hops, direct edges carrying their confidence (`local`/`import`/`unique`/`method`, uncertain flagged), module-level call sites listed separately, ambiguous names returned as candidates instead of a guess (replaces `graft_trace_calls`).
- `graph_file_api` renders the signatures-only view of one file: every definition with span and enclosing scope, plus exports and raw import specifiers resolved against the workspace (replaces `graft_file_api`).
- `graph_repo_map` returns the aggregated tree of the workspace — directories and files with symbol and line counts, aggregates complete below the depth cut — with workspace-level call statistics (replaces `graft_repo_map`).
- `graph_freshness` reports whether the stored graph matches the workspace (added/changed/removed files, stat-only, never writes unless `rebuild: true` is passed) (replaces `graft_check_freshness`).

The six `graph_*` tools accept an optional `root` (default: process cwd), auto-index on first use, and share their store with `novahiz graph` — see [docs/GRAPH.md](../../docs/GRAPH.md) for the architecture and precision rules.

It speaks newline-delimited JSON-RPC over stdio. No npm install is needed.

Run it directly:

```
node mcp/novahiz-tools/index.mjs
```

Register it in a harness with a stdio server pointing at that command. The opencode plugin registers it automatically through the plugin `config` hook.
