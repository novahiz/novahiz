# Harnesses

Novahiz keeps its decisions in the CLI. A harness integration is a thin adapter that calls it. opencode and Claude Code are the supported harnesses (Codex gets grounding hooks), and the MCP server stays usable from any other client.

## opencode

- Skill and plugin: `~/.config/opencode/skills/` and `~/.config/opencode/plugins/`.
- Slash commands: `~/.config/opencode/commands/` (`novahiz-plan`, `novahiz-clean`, `novahiz-doctor`, `novahiz-status`).
- MCP: the plugin registers the Novahiz server through the plugin `config` hook, so `opencode.jsonc` is not edited.
- Gate: the plugin calls `novahiz gate` on `edit`, `write`, `patch`, `apply_patch`, `bash`, and `shell`.

The plugin exists twice. `adapters/opencode/novahiz.ts` in the repository is the source; `~/.config/opencode/plugins/novahiz.ts` is what opencode runs. Editing the source changes nothing until the installer recopies it, and a stale copy keeps the old behaviour without an error. After an update, run the installer and restart opencode. `novahiz doctor` reports this as the `adapter` check.

The agent exists twice as well: `adapters/opencode/agent/novahiz.md` is the source and `~/.config/opencode/agent/novahiz.md` is what opencode loads. Both are compared by the `agent` check.

opencode denies the `question` tool to every agent by default. Only the built-in `build` and `plan` agents re-allow it, so a custom primary agent inherits the denial unless it asks. the `novahiz` agent therefore carries `permission: { question: allow, plan_enter: allow }`. Drop that block and the pipeline can no longer ask a clarifying question or validate a plan, and the `agent` check fails.

Source: opencode plugin docs (`~/.config/opencode/plugins/`).

### Third-party opencode plugins

Besides the Novahiz adapter, no third-party plugin is installed. The bootstrap and installer no longer pin any package under `plugin[]` — these were removed on 2026-09-26 and must not come back:

| Package | Repository | License | Status |
| --- | --- | --- | --- |
| `@mohak34/opencode-notifier` | https://github.com/mohak34/opencode-notifier | MIT | removed 2026-09-26 |
| `@tarquinen/opencode-dcp` | https://github.com/Opencode-DCP/opencode-dynamic-context-pruning | AGPL-3.0-or-later | removed 2026-09-26 |

Full provider MCP provenance lives in [PROVIDERS.md](PROVIDERS.md) and `catalog/providers.json`.

### Official Flutter / Dart providers

The installer can register the Dart MCP (`dart mcp-server`) and, with `--flutter-skills`, install the official skill packs into `~/.agents/skills` (merged into `skills.paths`). Nothing is vendored here; commands and licences are in [PROVIDERS.md](PROVIDERS.md) and `NOTICE.md`. After a config change, restart opencode so the new MCP entry is read at import.

## Claude Code

- Skills: `~/.claude/skills/<name>/SKILL.md`, commands: `~/.claude/commands/*.md`, agent: `~/.claude/agents/novahiz.md`. The agent source is `adapters/claude/agent/novahiz.md`; the `claude-agent` doctor check compares both copies.
- Gate: `install/hooks.mjs --harness claude` merges a `PreToolUse` handler into `settings.json` (matcher `Skill|Read|Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|mcp__novahiz__cron_*`) that runs `novahiz hook --harness claude`. Foreign groups in the same file are kept untouched; rerunning the installer replaces only the novahiz group, and the previous file is saved as `settings.json.novahiz-bak`.
- MCP: the same hook registers the Novahiz server with `claude mcp add` when the `claude` CLI is on PATH, and skips cleanly when it is not.
- Kill-switch: `NOVAHIZ_GATE=off` allows every tool call, exactly like opencode.
- `CLAUDE_CONFIG_DIR` redirects every path above when set.
- `novahiz doctor` adds four non-blocking rows (`claude-hooks`, `claude-agent`, `claude-skills`, `claude-commands`) only when a Claude config directory exists; a machine without Claude Code never sees them.
- Auto-install: when Claude Code is selected at install time and entirely absent (no config directory and no binary), the installer runs `npm install -g @anthropic-ai/claude-code` (non-blocking).

## Codex

Codex is grounded on `PreToolUse` blocking hooks: `install/hooks.mjs --harness codex` merges the novahiz group into `hooks.json` under `CODEX_HOME` (or `~/.codex`) and registers the MCP server with `codex mcp`. Merge semantics match Claude Code: foreign entries stay, novahiz entries are replaced. When codex is selected and absent, the installer runs `npm install -g @openai/codex` (non-blocking).

## Other clients

Any harness with a stdio MCP client can use the same server, `mcp/novahiz-tools/index.mjs`, for `classify`, `catalog`, `roadmap`, `providers`, `deps`, `step`, `list_skills`, `gate`, `task`, and `dispatch`. Register it with that client's own MCP command. Beyond the supported harnesses above, Novahiz writes no other harness's configuration.

## What the installer does

`node install/install.mjs` installs the selected harnesses:

- Interactive runs end with a harness select (`opencode`, `claude`, `codex`) where the detected ones come pre-checked; `--harness claude,codex` forces a list, and `--yes` (or any non-interactive run) takes every detected harness, falling back to `opencode` when none is present.
- opencode selected: skills into `~/.config/opencode/skills/`, the plugin into `~/.config/opencode/plugins/`, the agent into `~/.config/opencode/agent/`, the four slash commands into `~/.config/opencode/commands/`, and `opencode.jsonc` when missing.
- Claude Code selected: skills into `~/.claude/skills/`, commands into `~/.claude/commands/`, the agent into `~/.claude/agents/`, then the `settings.json` hook and the MCP registration.
- Codex selected: the `hooks.json` hook and the MCP registration.
- Each selected harness that is entirely absent (no config directory and no binary) gets its CLI installed with `npm install -g …`, non-blocking. A harness that was not selected is never installed nor configured.
- The Novahiz MCP server on opencode is registered by the plugin at startup rather than written into `opencode.jsonc`.
- A skill that already exists in `~/.agents/skills` or another scanned root is skipped rather than copied twice, because two copies make it describe one version while the harness loads the other. `--force-skills` overrides.

Run it non-interactively:

```
node install/install.mjs --yes
node install/install.mjs --yes --harness claude
```

Every file the installer writes is backed up first as `<file>.novahiz-bak` and tracked in `.novahiz-install.json`. `node install/uninstall.mjs` restores the backups and removes what it created. `--only <dir>` scopes that to one directory, and `--purge` also removes the Novahiz home.
