# Adapters

Novahiz keeps every decision in the CLI. An adapter only translates a harness event into a `novahiz` call.

## opencode

`adapters/opencode/novahiz.ts` is a plugin. It classifies each user message, injects the roadmap checklist and expected skills, tracks loaded skills per session, and calls `novahiz gate` on `edit`, `write`, `patch`, `apply_patch`, and `bash`. The gate is content-aware, so `humanizer` and `impeccable` are required only when the change contains prose or style. It also registers the MCP server through the plugin `config` hook.

## Claude Code

Claude Code supports blocking `PreToolUse` hooks. `install/hooks.mjs` writes a `PreToolUse` group into `~/.claude/settings.json` that calls:

```
node <home>/src/cli.ts hook --harness claude --event PreToolUse
```

The CLI reads the hook JSON on stdin, maps `tool_name` and `tool_input`, evaluates the gate, and returns a `permissionDecision: "deny"` payload when a required skill is missing. This is a real block.

## Codex

Codex exposes `PostToolUse` and `Stop` hooks. `install/hooks.mjs` writes them into `~/.codex/hooks.json`. Because these fire after the edit, Codex gets an advisory verdict, not a block. The CLI prints a message and logs the enforcement; it cannot undo an edit that already happened.

## Other harnesses

Any harness with a stdio MCP client can use `mcp/novahiz-tools/index.mjs` for `classify`, `list_skills`, and `gate`. Harnesses with a pre-tool hook that can abort a call can reuse the same `novahiz hook --harness <name>` path. The tool mapping lives in `src/hook.ts` and is easy to extend.
