---
name: token-economy
description: |
  Token economy — minimize token usage across multi-step tasks. Use before starting
  any multi-step task, when context grows large, when noticing repetitive tool calls,
  or before delegating to sub-agents. Referenced by Novahiz INVENTORY as mandatory.
license: MIT
compatibility: opencode
---

# Token Economy Skill

> Context is finite. Every token must earn its place.

## When to Use

- Before starting any multi-step task
- When context is growing large
- When you notice repetitive tool calls
- Before delegating to sub-agents

## Core Principles

### 1. Context Is a Budget

| Action | Approximate Cost |
|--------|-----------------|
| System prompt + rules | ~2K-5K tokens |
| File read (full) | 50-500 tokens per file |
| Tool output | 100-2000 tokens per call |
| Your response | 100-2000 tokens |
| Conversation history | Accumulates every turn |

**Rule**: If context exceeds 60% of model window, compress before continuing.

### 2. Reading Strategy

```
WRONG: Read entire 500-line file to find one function
RIGHT: Grep for the function name, then read only that section
```

**Mandatory parameters on every file read:**
- `head: N` — Read only first N lines
- `tail: N` — Read only last N lines  
- `offset: M` — Start reading from line M
- `limit: N` — Maximum lines to return

**Never**: Read entire files without limits unless you genuinely need the whole file.

### 3. Tool Output Management

**After every tool call, ask:**
1. Did I extract the information I need?
2. Can I discard the raw output now?
3. Is there anything worth keeping in context?

**Prune aggressively:**
- Bash command outputs → extract result, discard logs
- File reads → extract relevant lines, discard rest
- Grep results → note file:line, discard output
- Web searches → extract key facts, discard HTML

### 4. Response Discipline

| Instead of... | Do this... |
|---------------|-----------|
| Pasting entire file | Show only changed lines with line numbers |
| Explaining what you'll do | Just do it, then show result |
| Play-by-play narration | One summary sentence after completion |
| Repeating user's code | Reference file:line |
| Long explanations | Bullet points or code blocks |

### 5. Compression Triggers

**Compress when:**
- Context > 60% of model window
- Completed a research phase
- Finished implementing a feature
- Moving to a new task
- Old tool outputs are no longer needed

**What to keep in compressed summary:**
- Decisions made and rationale
- File paths and line numbers
- Error patterns and solutions
- User's original intent
- Code diffs (not full files)
- Architecture choices

**What to discard:**
- Raw tool outputs
- Verbose logs
- Intermediate exploration dead-ends
- Repeated file reads
- Generic explanations

### 6. Sub-Agent Token Rules

When delegating to sub-agents:
- Pass specific instructions, not vague requests
- Request summaries, not raw data
- Tell sub-agents to use head/tail/offset
- Limit sub-agent output to actionable findings
- Don't let sub-agent output duplicate existing context

### 7. Memory File Management

**MEMORY.md rules:**
- Keep under 200 lines
- Use structured sections: Tech Stack, Architecture, Decisions, Issues
- Compress with `caveman-compress` when over limit
- Update incrementally, don't rewrite entire file

**AGENTS.md rules:**
- Keep under 50 lines
- Reference detailed rules in separate files
- One line per rule, no explanations

### 8. Session Lifecycle

```
Task Start:
  1. Load only needed skills
  2. Read only needed files
  3. Plan with Todo

During Task:
  4. Prune tool outputs after processing
  5. Compress completed sections
  6. Use head/tail/offset on all reads

Task End:
  7. Compress entire task into summary
  8. Update memory files (incremental)
  9. Report result concisely
```

## Quick Checklist

Before every action, verify:

- [ ] Am I reading only what I need?
- [ ] Am I using head/tail/offset?
- [ ] Can I prune old tool outputs?
- [ ] Is my response concise?
- [ ] Am I avoiding redundant reads?
- [ ] Is context approaching 60%?
- [ ] Should I compress now?

## Token-Saving Patterns

### Pattern: Grep Then Read
```
1. Grep for "function calculateTotal" → src/utils.ts:42
2. Read src/utils.ts with offset:35 limit:20
3. Extract function, discard rest
```

### Pattern: Parallel Batch
```
WRONG: Read file1.ts → Read file2.ts → Read file3.ts
RIGHT: Read [file1.ts, file2.ts, file3.ts] in one call
```

### Pattern: Selective Delegation
```
1. Delegate exploration to sub-agent
2. Sub-agent returns: "Found X at file:line. Recommendation: Y"
3. You use the recommendation, not the raw exploration
```

### Pattern: Incremental Memory
```
WRONG: Rewrite entire MEMORY.md every time
RIGHT: Append new section, update existing entries
```
