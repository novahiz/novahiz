# Harnesses

Novahiz keeps its decisions in the CLI. Every harness integration is a thin adapter that calls it. This page lists the exact paths and commands for each supported harness, taken from the official documentation.

## opencode

- Skill and plugin: `~/.config/opencode/skills/` and `~/.config/opencode/plugins/`.
- Slash commands: `~/.config/opencode/commands/` (`novahiz-plan`, `novahiz-clean`, `novahiz-doctor`, `novahiz-status`).
- MCP: the plugin registers the Novahiz server through the plugin `config` hook, so `opencode.jsonc` is not edited.
- Gate: the plugin calls `novahiz gate` on `edit`, `write`, `patch`, `apply_patch`, `bash`, and `shell`.

The plugin exists twice. `adapters/opencode/novahiz.ts` in the repository is the source; `~/.config/opencode/plugins/novahiz.ts` is what opencode runs. Editing the source changes nothing until the installer recopies it, and a stale copy keeps the old behaviour without an error. After an update, run the installer and restart opencode. `novahiz doctor` reports this as the `adapter` check.

Source: opencode plugin docs (`~/.config/opencode/plugins/`).

## Claude Code

- Skills, commands, agent: `~/.claude/skills/`, `~/.claude/commands/` (`novahiz-plan`, `novahiz-clean`, `novahiz-doctor`, `novahiz-status`), and `~/.claude/agents/novahiz.md`.
- Hooks: `~/.claude/settings.json` (user) or `.claude/settings.json` (project). A `PreToolUse` group matches `Read`, the edit tools, and the shell tools, then runs `novahiz hook --harness claude --event PreToolUse`. On an edit it prints a `permissionDecision: "deny"` payload, which blocks the call. `Read` is in the matcher because it is the only skill-load signal Claude Code produces: the agent opens `<...>/skills/<name>/SKILL.md`, and the hook records that as the load.
- MCP: register the server once with the CLI:

```
claude mcp add --scope user novahiz -- node ~/.config/novahiz/mcp/novahiz-tools/index.mjs
```

For a team, put the same entry under `mcpServers` in a project `.mcp.json` and commit it. Stdio arguments sit after `--`, so `-y` and similar flags go to the server command, not to `claude`.

Sources: Claude Code hooks reference and MCP reference (`docs.claude.com`).

## Codex

- Hooks: `~/.codex/hooks.json` (user) or `<repo>/.codex/hooks.json` (project, trusted projects only). Hooks use the same event schema as `[hooks]` in `config.toml`. `PreToolUse` fires before the call, but Codex still gets an advisory verdict, not a block (`novahiz hook` only emits a deny payload for Claude). `matcher` is a regex that filters the tool name: `Bash` for shell, `apply_patch` for patches (also matched by `Edit` and `Write`), and `mcp__<server>__<tool>` for MCP tools. `timeout` is in seconds.
- Hook trust: Codex requires you to review and trust non-managed hooks. Run `/hooks` once to approve the Novahiz hooks. Until then Codex skips them.
- MCP: add the server with the CLI:

```
codex mcp add novahiz -- node ~/.config/novahiz/mcp/novahiz-tools/index.mjs
```

Or write it into `~/.codex/config.toml`:

```toml
[mcp_servers.novahiz]
command = "node"
args = ["/home/you/.config/novahiz/mcp/novahiz-tools/index.mjs"]
```

Sources: Codex hooks guide and MCP guide (`developers.openai.com/codex`).

## Other harnesses

Any harness with a stdio MCP client can use the same server, `mcp/novahiz-tools/index.mjs`, for `classify`, `catalog`, `roadmap`, `providers`, `deps`, `step`, `list_skills`, `gate`, `task`, and `dispatch`. Harnesses with a pre-tool hook that can abort a call can reuse `novahiz hook --harness <name>`. The tool mapping lives in `src/hook.ts` and is easy to extend: add a case to `normalizeTool`.

## What the installer does

`node install/install.mjs` detects the harnesses present on the machine and, after your confirmation, configures them:

- Claude Code, when `~/.claude` exists: copies the bundled skills to `~/.claude/skills/`, the slash commands to `~/.claude/commands/`, the agent to `~/.claude/agents/novahiz.md`, merges the `PreToolUse` hook into `~/.claude/settings.json`, and runs `claude mcp add --scope user`. `--no-claude` skips the whole block.
- Codex, when `~/.codex` exists: writes `~/.codex/hooks.json` and runs `codex mcp add`.

Run it non-interactively with an explicit list:

```
node install/install.mjs --yes --harness claude,codex
```

Every file the installer writes is backed up first as `<file>.novahiz-bak` and tracked in `.novahiz-install.json`. The `claude mcp add` and `codex mcp add` commands are skipped when the CLI is not on the PATH.
