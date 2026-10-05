# Token economy

Novahiz spends fewer tokens without weakening the work: an agent-facing skill
that reads less, a harness-facing plugin that trims bulky tool output, and two
readouts that show what was saved. Compression is only worth it when the
evidence survives, so every lever here is opt-in, bounded, and reversible.

## The three levers

| Lever | Where | Direction |
|-------|-------|-----------|
| `token-economy` skill | `skills/token-economy/SKILL.md` | Agent side: read the smallest thing that answers the question, batch calls, delegate exploration, edit surgically, answer in paths. |
| `novahiz-token-economy` plugin | `adapters/opencode/novahiz-token-economy.ts` | Harness side: trim oversized tool output before it reaches the model. |
| `novahiz tokens` | `src/commands/tokens.ts` | Accounting: savings derived from the enforcement database. |

## What the plugin does

- **Trims tool output** (`tool.execute.after`). When a log-shaped tool result
  (`shell`, `execute`, `bash`, `webfetch`, `grep`, `glob`) exceeds the line or
  byte budget, the plugin keeps the head and writes the full text to disk
  first. Tools that carry content to edit - `read`, `edit`, `write`, `skill`,
  memory and ledger tools - are never trimmed.
- **Points at the full output.** The trimmed result ends with a footer naming
  the dump file, so the model greps the file instead of re-running the
  command. A re-run costs more than the trim saved.
- **Reports the saving.** `/novahiz-tokens` posts bytes and estimated tokens
  saved for the session as a synthetic message - no model call - and logs the
  same line to the opencode log.

It stays inert until it is switched on. Installing novahiz changes nothing for
a default setup.

## Configuration

Environment variables:

| Variable | Default | Meaning |
|----------|---------|---------|
| `NOVAHIZ_TOKEN_ECONOMY` | unset (off) | Master switch. `1` / `true` / `on` enables the plugin. |
| `NOVAHIZ_TE_MAX_LINES` | `120` | Lines kept from the head of one tool output. |
| `NOVAHIZ_TE_MAX_BYTES` | `16384` | Bytes kept from the head of one tool output. |
| `NOVAHIZ_TE_TOOLS` | `shell,execute,bash,webfetch,grep,glob` | Comma-separated list of tools eligible for trimming. |
| `NOVAHIZ_TE_DUMP_DIR` | `<NOVAHIZ_HOME>/tmp/tool-output` | Where full outputs are written. |

```bash
export NOVAHIZ_TOKEN_ECONOMY=1   # opt in for this session
```

Opencode loads plugins from `<config dir>/plugins/*.ts`, which is where
`novahiz setup` copies both plugin files. Restart opencode after installing
or changing an environment variable.

## What the model sees

```
... first 120 lines of the command output ...
[Novahiz token-economy] truncated shell: kept 120 of 843 lines (16.0 KB of 214.3 KB, ~62000 tokens saved). Full output: C:\Users\me\.config\novahiz\tmp\tool-output\shell-call42.txt - grep that file instead of re-running the command.
```

## Reading the savings

```
/novahiz-tokens
```

```
[Novahiz token-economy] ON
outputs truncated: 1
bytes kept: 214.3 KB -> 16.0 KB
estimated saved: 198.3 KB (~61969 tokens, 3.2 bytes/token)
```

```
novahiz tokens [--format json|text]
```

`novahiz tokens` reports a different, complementary figure: the bytes and
tokens avoided by gate refusals and by the skill/memory machinery, counted
from the local enforcement database.

## Limits

- `~tokens` is an estimate at 3.2 bytes per token (the same convention as
  `novahiz tokens`: 80 bytes and 25 tokens per line). It is a magnitude, not
  an invoice.
- Opencode already truncates tool output at 2000 lines / 50 KB on its own.
  This plugin's budget is deliberately lower, and it never fights that layer:
  an output the runtime already flagged as truncated is left alone.
- The plugin fails open. Any error it meets is logged and the tool result
  passes through untouched.
- What is never trimmed: proofs, tests and their real output, exact error
  messages under debug, security-relevant code, or anything the user asked to
  see in full. The skill states that guardrail; the plugin enforces it by
  tool list.

## Not implemented

`novahiz.config.example.json` still carries a `tokens` block (`enabled`,
`trimOutputs`, `keepHeadLines`, `keepTailLines`, `keepErrorLines`,
`dedupeReads`, `capOutputTokens`, `trimTools`, `readTools`). No code reads it:
it is a leftover of a layer that was never shipped, and neither the plugin nor
`novahiz tokens` consumes it. Configure the plugin with the environment
variables above instead.
