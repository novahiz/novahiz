# Adapters

Novahiz keeps every decision in the CLI. An adapter only translates a harness event into a `skillenforce` call.

## opencode

`adapters/opencode/skillenforce.ts` is a plugin. It classifies each user message, injects the roadmap checklist and expected skills, tracks loaded skills per session, and calls `skillenforce gate` on `edit`, `write`, `patch`, `apply_patch`, `bash`, and `shell`. The gate is content-aware, so `humanizer` and `impeccable` are required only when the change contains prose or style. It registers the MCP server through the plugin `config` hook, and persists every skill launch with `skillenforce session-load`.

`adapters/opencode/agent/skillenforce-agent.md` is the primary agent. It carries `permission: { question: allow, plan_enter: allow }`, because opencode denies `question` to every agent by default and only its built-in `build` and `plan` agents re-allow it.

## Other clients

Any harness with a stdio MCP client can use `mcp/skillenforce-tools/index.mjs` for `classify`, `catalog`, `roadmap`, `step`, `list_skills`, and `gate`. Register it with that client's own MCP command; Novahiz writes no other harness's configuration. There is no gate outside opencode, so those clients get the catalog and the ledger without enforcement.
