# opencode Plugin

The opencode adapter is a thin plugin that bridges the Novahiz core with the opencode harness. It lives at `adapters/opencode/novahiz.ts` and is copied to `~/.config/opencode/plugins/novahiz.ts` during installation.

The harness runs OpenCode V2, whose plugin API takes a default-exported `{ id, setup }` definition. The adapter declares `export default novahizPlugin` and registers every hook inside `setup(ctx)`; hook callbacks throw to deny a tool call, exactly as the V1 hooks did.

## Plugin lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                  OPENCODE STARTUP                           │
│                                                             │
│  1. Plugin loads                                            │
│  2. Read novahiz.config.json                           │
│  3. Check DISABLED flag (env escape or config)              │
│  4. Register hooks (OpenCode V2 plugin API):                │
│     • mcp.transform → inject MCP server + providers          │
│     • event.subscribe → session.deleted cleanup;            │
│               session.idle → flush autodocs (fail-open)     │
│     • session.hook(prompt) → classify, build enforcement     │
│     • session.hook(context) → inject into prompt             │
│     • tool.hook(execute.before) → gate check on edits        │
│     • tool.hook(execute.after) → mark major path dirty       │
└─────────────────────────────────────────────────────────────┘
```

The plugin is self-contained: prompt rewriting and autodocs helpers are inlined so the installed copy under `~/.config/opencode/plugins/` does not depend on `../../src/*` (that path does not resolve after install).

## Hooks

### `mcp.transform`

Registers the Novahiz MCP server and any additional providers from `catalog/providers.json`. Runs once at startup. The CLI output is read *before* the transform, because transform callbacks must stay synchronous:

```typescript
const providers = run(["providers", "--mcp-json"]); // read first
await ctx.mcp.transform((editor) => {
  // Register Novahiz MCP server unless the user configured one already
  if (!editor.get("novahiz")) {
    editor.set("novahiz", {
      type: "local",
      command: [NODE, join(HOME, "mcp", "novahiz-tools", "index.mjs")]
    });
  }
  // ... auto-register providers from catalog, skipping names already present
});
```

### `session.hook("prompt")`

Classifies every user prompt and builds the enforcement block:

```
┌─────────────────────────────────────────────────────────────┐
│  USER: "corrige le bug de login"                            │
│                                                             │
│  1. Read the prompt text (event.prompt.text)                │
│  2. Run: Novahiz classify "corrige le bug de login"    │
│  3. Parse JSON output:                                      │
│     categories: ["debug"]                                   │
│     primary: "debug"                                        │
│     enforcedSkills: ["novahiz-plan",                   │
│                      "novahiz-analyse",                │
│                      "novahiz-implement",              │
│                      "novahiz-converge"]               │
│     roadmaps: [{ id: "bugfix", steps: [...] }]             │
│  4. Build enforcement block:                                │
│     [Novahiz enforcement]                              │
│     Categories detectees: debug (primaire: debug)           │
│     Roadmap bugfix:                                         │
│       1. [advisory] Reproduce the bug                       │
│       2. [advisory] Isolate the root cause                  │
│       3. [skill] Set the fix direction (novahiz-plan)  │
│       4. [skill] Analyze the code (novahiz-analyse)    │
│       5. [edit] Fix (novahiz-implement)                │
│       6. [verify] Verify the fix (novahiz-converge)    │
│       7. [advisory] Prevent recurrence                      │
│     Skills requis (roadmap): novahiz-plan, ...         │
│     Le gate bloque edit/write/patch tant que les skills     │
│     requis ne sont pas charges.                             │
│  5. Store enforcement block for this session                │
└─────────────────────────────────────────────────────────────┘
```

### `session.hook("context")`

Injects the enforcement block into the system prompt on every agent model turn:

```typescript
await ctx.session.hook("context", async (event) => {
  const block = enforcementBySession.get(event.sessionID);
  if (!block) return;
  // Replace, never stack: one fresh block per prompt, stale copies dropped.
  for (let i = event.system.length - 1; i >= 0; i--) {
    const entry = event.system[i];
    if (entry.type === "text" && entry.text.startsWith("[Novahiz enforcement]")) {
      event.system.splice(i, 1);
    }
  }
  event.system.push({ type: "text", text: block });
});
```

### `tool.hook("execute.before")`

The core enforcement hook. Intercepts tool calls and runs the gate:

```
┌─────────────────────────────────────────────────────────────┐
│  MODEL calls: edit(file="src/hero.tsx", content="...")      │
│                                                             │
│  1. Is this a skill load? → Record it, continue             │
│  2. Is this a gated tool? (edit/write/patch/bash/shell)     │
│  3. Run: Novahiz gate \                                │
│       --tool edit \                                         │
│       --args-stdin \                                        │
│       --categories debug \                                  │
│       --loaded novahiz-plan,novahiz-analyse \     │
│       --session <id>                                        │
│  4. stdin: {"file":"src/hero.tsx","newString":"..."}        │
│                                                             │
│  Gate output:                                               │
│  • exit 0 → allow                                           │
│  • exit 2 → BLOCK (throw error with missing skills list)    │
│  • exit != 0 → BLOCK (fail-closed, same as spawn error)      │
└─────────────────────────────────────────────────────────────┘
```

### `event.subscribe`

Two event types, consumed from the subscription started in `setup` (aborted when the plugin unloads):

| Event | Behavior |
|-------|----------|
| `session.deleted` | Forget in-memory session state |
| `session.idle` | If autodocs is enabled and state is dirty, spawn `novahiz autodocs --flush` (fail-open, unref'd child) |

### `tool.hook("execute.after")`

After an edit-like tool succeeds, if the path is a major source file (`src/…`, `package.json`, `.ts`, …), call the inlined `markDirty` so the next `session.idle` can flush docs. Non-edit tools and non-major paths are ignored. Never throws.

## Session state

The plugin maintains per-session state in memory:

| Map | Purpose |
|-----|---------|
| `loadedBySession` | Skills loaded via `skill()` tool calls |
| `categoriesBySession` | Categories from last classification |
| `enforcementBySession` | Enforcement text block for system prompt |
| `lastSeenBySession` | Timestamp for TTL-based cleanup |

Sessions are pruned after 4 hours of inactivity.

## Skill loading

When the model calls `skill({id: "novahiz-humanizer"})`:

1. The plugin records `"humanizer"` in `loadedBySession`
2. Runs `Novahiz session-load --session <id> --skill humanizer`
3. The skill is now "loaded" for gate checks

## Disabled state

The plugin can be disabled via:

1. **Environment variable**: `NOVAHIZ_GATE=off` (or `0`, `false`, `no`, `disabled`)
2. **Config**: `gate.enabled: false` in `novahiz.config.json`

When disabled, all hooks return early without doing anything.

## Error handling

- If `classify` fails → warning logged, no enforcement injected
- If `gate` fails with spawn error → tool call **blocked** (fail-closed)
- If `gate` exits non-zero non-two → tool call **blocked** (fail-closed)
- If `gate` exits 2 → error thrown, tool call blocked
- Autodocs flush on `session.idle` and `tool.execute.after` are fail-open
