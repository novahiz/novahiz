---
name: "token-economy"
description: "Spend the context window only on what decides the next action. Rules for reading less (grep/glob before read, offsets, log tails), batching tool calls, delegating exploration to subagents, surgical edits, short replies, and recovering from truncated tool output. Use when a session runs long, context fills up, tool outputs flood the transcript, or the user asks to save tokens, cut cost, or work faster without losing quality."
license: "Apache-2.0"
metadata:
  author: Novahiz
  organization: Novahiz
  version: "1.0.0"
  date: October 2026
---

# token-economy

Cut the tokens that carry no decision. Never cut the ones that carry proof.

Compression loses information, and lost information becomes a wrong edit, a
skipped test, or a re-derived fact. Every rule below is written so the work
stays as strong as it was unconstrained. When a rule and the evidence
disagree, the evidence wins.

## Read the smallest thing that answers the question

- `grep` / `glob` before `read`. Locate the line, then read around it.
- `read` with `offset` and `limit`. A 4000-line file is rarely what you need;
  you need lines 120-180.
- Tail first on logs and build output: the failure is at the end, the banner
  is at the start.
- Never re-read a file you already read in full this session. Quote the line
  you remember, or re-read the narrow range only.
- Prefer signatures over bodies: `lodestone_excerpt` returns definitions,
  exports and imports without the implementation.
- Do not open a second file to answer what the first one already answered.

## Batch, then interpret

- Independent calls go in one turn: a `read`, a `grep` and a `glob` that do
  not depend on each other cost one round trip together, three round trips
  apart.
- One narrow query beats three broad ones. Filter in the tool (`path`,
  `include`, `limit`), not in your head after the fact.
- Do not re-run a command whose output you already have. Store the value, not
  the command.

## Send exploration out of the main transcript

Long reconnaissance belongs in a subagent: its reads, greps and false starts
stay in its own context and come back as a conclusion.

- Delegate "find where X is handled", "map this directory", "compare these
  two implementations" to an explore agent with a stated thoroughness level.
- Keep in the main session only the decision the exploration feeds.
- Ask for file paths in the answer, not pasted source.

## Edit surgically

- `edit` with a tight `oldString` / `newString`. A whole-file rewrite spends
  the entire file in tokens and risks unrelated drift.
- Touch only what the task requires. Out-of-scope cleanup is a new todo, not
  an edit folded into this one.
- Never truncate, summarize or "compressed-copy" code you are about to edit
  exactly. Exact text in, exact text out.

## Answer in paths, not pastes

- Cite `path:line`, do not reproduce the block you just read.
- State the result of a command, not its transcript: `531/531 tests, exit 0`.
- No restating the plan that is already on screen, no summarizing what the
  tool output said before the conclusion drawn from it.
- One finding per sentence. A paragraph that says the same thing twice costs
  twice.

## When tool output comes back truncated

The Novahiz token-economy plugin (opt-in, `NOVAHIZ_TOKEN_ECONOMY=1`) keeps the
head of large tool outputs and writes the full text to
`<NOVAHIZ_HOME>/tmp/tool-output/`.

- The footer of the truncated result names the dump file. Grep that file
  instead of re-running the command.
- Re-running a command that already succeeded is the most expensive way to
  recover information you were merely shown the path to.
- If the dump file is missing, re-run once and report it.

## Keep the durable stores small

- Memory slots are 8000 chars / 200 lines: write the decision and the proof,
  never the document behind them.
- Ledger proofs are one command and its result, not a narrative.
- Handoffs carry paths and decisions; the reader can open the code.

## What is never worth saving

Do not economize on: proofs, tests and their real output, security-relevant
code, exact error messages being debugged, acceptance criteria, or anything
the user explicitly asked to see in full. A shorter session that must be
repeated costs more than the tokens it saved.

## Measure

- `/novahiz-tokens` — bytes and estimated tokens saved this session, posted
  by the plugin without a model call.
- `novahiz tokens` — enforcement-derived savings recorded in the local
  database.
