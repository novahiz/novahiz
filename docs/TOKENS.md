# Token economy

Novahiz trims what the model reads, so a long session spends fewer tokens without losing the content that matters. The layer runs in the opencode adapter through three hooks and reports what it removed.

## What it does

- **Trim tool output** (`tool.execute.after`). When a `read`, `bash`, or `shell` output exceeds the byte or line budget, the adapter keeps the head, the tail, and the lines that look like errors, then replaces the middle with a marker. Tool outputs that are already the payload (`grep`, `glob`, `webfetch`, MCP JSON) are never trimmed.
- **Deduplicate stale reads** (`experimental.chat.messages.transform`). When the same file is read more than once with the same range, only the last read stays intact. Earlier reads become a one-line stub. The key is path plus offset plus limit, so two different ranges of one file are both kept.
- **Cap output tokens** (`chat.params`). When `capOutputTokens` is greater than 0 and the model left `maxOutputTokens` unset, the adapter sets it. It is 0 by default, which leaves the cap off.

## Configuration

The `tokens` block of `novahiz.config.json`:

```json
{
  "tokens": {
    "enabled": true,
    "trimOutputs": true,
    "maxOutputBytes": 40000,
    "keepHeadLines": 120,
    "keepTailLines": 40,
    "keepErrorLines": 40,
    "dedupeReads": true,
    "capOutputTokens": 0,
    "trimTools": ["read", "bash", "shell"],
    "readTools": ["read"]
  }
}
```

`NOVAHIZ_TOKENS=off` disables the whole layer for a session.

## Reading the savings

```
novahiz tokens [--format json|text] [--since <Nd|Nh|ISO>] [--session id] [--calibrate]
```

- Default output is JSON. `--format text` prints a short summary.
- `--since 1d` or `--since 2026-09-11` limits the window. `--session <id>` limits to one session.
- `--calibrate` adds the distribution of trimmed events: removed bytes and tokens (min, median, max), the bytes-per-token ratio over instrumented trims, and the count of re-reads.

The adapter appends one JSON line per event to `build/token-savings.jsonl`. The file rotates once it grows past 4 MB, keeping the last 20000 lines.

## Limits

`~tokens` is an estimate: it divides the removed character count by four. It tracks the real provider tokenizer closely on ordinary text but it is not the tokenizer itself, so treat the number as a magnitude, not an invoice. The cap lever is off by default and has not been exercised against a live session.
