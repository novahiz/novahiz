# opencode Plugin

The opencode adapter is a thin plugin that bridges the skillenforce core with the opencode harness. It lives at `adapters/opencode/skillenforce.ts` and is copied to `~/.config/opencode/plugins/skillenforce.ts` during installation.

## Plugin lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                  OPENCODE STARTUP                           │
│                                                             │
│  1. Plugin loads                                            │
│  2. Read skillenforce.config.json                           │
│  3. Check DISABLED flag (env escape or config)              │
│  4. Register hooks:                                         │
│     • config → inject MCP server + providers                │
│     • event → clean up session state on session.deleted     │
│     • chat.message → classify prompt, build enforcement     │
│     • experimental.chat.system.transform → inject into prompt│
│     • tool.execute.before → gate check on edits             │
└─────────────────────────────────────────────────────────────┘
```

## Hooks

### `config`

Registers the skillenforce MCP server and any additional providers from `catalog/providers.json`. Runs once at startup.

```typescript
config: async (input) => {
  // Register skillenforce MCP server
  config.mcp.skillenforce = {
    type: "local",
    command: [NODE, join(HOME, "mcp", "skillenforce-tools", "index.mjs")],
    enabled: true
  };
  // Auto-register providers from catalog
  const providers = run(["providers", "--mcp-json"]);
  // ... merge into config.mcp
}
```

### `chat.message`

Classifies every user message and builds the enforcement block:

```
┌─────────────────────────────────────────────────────────────┐
│  USER: "corrige le bug de login"                            │
│                                                             │
│  1. Extract text from message parts                         │
│  2. Run: skillenforce classify "corrige le bug de login"    │
│  3. Parse JSON output:                                      │
│     categories: ["debug"]                                   │
│     primary: "debug"                                        │
│     enforcedSkills: ["skillenforce-plan",                   │
│                      "skillenforce-analyse",                │
│                      "skillenforce-implement",              │
│                      "skillenforce-converge"]               │
│     roadmaps: [{ id: "bugfix", steps: [...] }]             │
│  4. Build enforcement block:                                │
│     [Skillenforce enforcement]                              │
│     Categories detectees: debug (primaire: debug)           │
│     Roadmap bugfix:                                         │
│       1. [advisory] Reproduce the bug                       │
│       2. [advisory] Isolate the root cause                  │
│       3. [skill] Set the fix direction (skillenforce-plan)  │
│       4. [skill] Analyze the code (skillenforce-analyse)    │
│       5. [edit] Fix (skillenforce-implement)                │
│       6. [verify] Verify the fix (skillenforce-converge)    │
│       7. [advisory] Prevent recurrence                      │
│     Skills requis (roadmap): skillenforce-plan, ...         │
│     Le gate bloque edit/write/patch tant que les skills     │
│     requis ne sont pas charges.                             │
│  5. Store enforcement block for this session                │
└─────────────────────────────────────────────────────────────┘
```

### `experimental.chat.system.transform`

Injects the enforcement block into the system prompt on every model turn:

```typescript
"experimental.chat.system.transform": async (input, output) => {
  const block = enforcementBySession.get(input.sessionID);
  if (block) output.system.push(block);
}
```

### `tool.execute.before`

The core enforcement hook. Intercepts tool calls and runs the gate:

```
┌─────────────────────────────────────────────────────────────┐
│  MODEL calls: edit(file="src/hero.tsx", content="...")      │
│                                                             │
│  1. Is this a skill load? → Record it, continue             │
│  2. Is this a gated tool? (edit/write/patch/bash/shell)     │
│  3. Run: skillenforce gate \                                │
│       --tool edit \                                         │
│       --args-stdin \                                        │
│       --categories debug \                                  │
│       --loaded skillenforce-plan,skillenforce-analyse \     │
│       --session <id>                                        │
│  4. stdin: {"file":"src/hero.tsx","newString":"..."}        │
│                                                             │
│  Gate output:                                               │
│  • exit 0 → allow                                           │
│  • exit 2 → BLOCK (throw error with missing skills list)    │
│  • exit != 0 → allow with warning (gate unavailable)        │
└─────────────────────────────────────────────────────────────┘
```

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

When the model calls `skill({name: "humanizer"})`:

1. The plugin records `"humanizer"` in `loadedBySession`
2. Runs `skillenforce session-load --session <id> --skill humanizer`
3. The skill is now "loaded" for gate checks

## Disabled state

The plugin can be disabled via:

1. **Environment variable**: `NOVAHIZ_GATE=off` (or `0`, `false`, `no`, `disabled`)
2. **Config**: `gate.enabled: false` in `skillenforce.config.json`

When disabled, all hooks return early without doing anything.

## Error handling

- If `classify` fails → warning logged, no enforcement injected
- If `gate` fails with spawn error → tool call allowed (gate unavailable)
- If `gate` exits non-zero non-two → tool call allowed with warning
- If `gate` exits 2 → error thrown, tool call blocked
