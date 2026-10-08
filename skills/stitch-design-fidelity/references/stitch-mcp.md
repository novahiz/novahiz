# Stitch MCP Server

How to connect Google Stitch's remote MCP server, what it provides, and how to call it correctly.

## Server endpoint

- **SSE URL:** `https://stitch.withgoogle.com/mcp/sse`
- **Protocol:** Server-Sent Events (streamable HTTP) over HTTPS
- **Type:** `sse`
- **Transport:** Remote (not `local` / `stdio`)
- **Auth type:** Bearer token (API key); no OAuth, no session cookie
- **Platform support:** Any MCP-capable client (OpenCode V2, Claude Code, Cursor, VS Code with MCP plugin)

The server is stateless per connection. The key is passed via the `Authorization` header. The client must include it in `mcp` configuration; it is never embedded in prompts or in the vault.

## Creating and managing the API key

1. Sign in to [stitch.withgoogle.com](https://stitch.withgoogle.com/).
2. Go to **Settings → API Key**.
3. Click **"Créer une clé"** (Create a key) to generate a new access token.
4. Copy the value (format: `AQ.<your-token>`).
5. Delete any old or exposed key before configuring the new one.
6. Configure the client's `mcp` block (see example below).
7. Restart the client and verify with the client's MCP resource listing (e.g. `opencode list_mcp_resources`).

**Security rules:**
- Never commit the key to a repository or include it in a skill reference file.
- Store it only in the client's `mcp` configuration (local file), not in the vault or in the project.
- Delete exposed keys immediately from the Settings page; create a replacement.
- This skill does not read the key from environment variables — it expects it to be configured in the client's `mcp` config.

## Client configuration example

In the client's `opencode.jsonc` (or equivalent MCP config file):

```jsonc
"stitch": {
  "type": "sse",
  "url": "https://stitch.withgoogle.com/mcp/sse",
  "headers": {
    "Authorization": "Bearer YOUR_STITCH_API_KEY"
  },
  "enabled": true
}
```

After editing, restart the client. Confirm the server appears in the client's MCP resource listing.

## Tool capabilities (canonical names)

The Stitch MCP server exposes these actions. Confirm exact tool names with the client's MCP listing (`opencode list_mcp_resources` or equivalent) before invoking, because server-side names can change.

| Concept | Typical MCP tool name | What it does |
|---------|----------------------|--------------|
| Generate a screen | `stitch_generate_screen` or `generate_ui` | Creates a full mobile screen from a structured text prompt |
| List screens / projects | `list_screens` or `get_project` | Retrieves existing maquettes and their context |
| Get screen reference | `get_screen` or `get_design` | Fetches a specific maquette with its structure, colors, layout |
| Regenerate / update | `update_design` or `regenerate` | Regenerates an existing screen with modifications |

The skill only invokes these for **full-screen generation**. Component edits, copy changes, or layout nudges are handled by ordinary code editing — not by the MCP.

## Call pattern

Every call passes a fully assembled prompt produced by this skill (`SKILL.md` → `prompt-methodology.md`). The agent never sends a short sentence; it sends:

- **Subject** — the screen's job (e.g. "Execution Chirurgicale" from the trading course).
- **Platform** — `iOS` or `Android`, with the corresponding design language (`Liquid Glass` or `Material 3`).
- **Design token block** — semantic colors, typography, spacing, radius (from `design-system.md`).
- **Screen brief** — what the screen does, its primary action, its real content (never lorem ipsum), its interactive states.
- **Sibling context** — the screens before and after it in the flow (from the vault's MOC links or the course's navigation table).
- **Anti-pattern constraints** — the banned tells for this screen (from `anti-ai-patterns.md`).
- **Reference** — either a Stitch maquette screen (for fidelity verification) or a sibling screen (for pattern consistency).
- **States to render** — default, hover/focus, active, disabled, loading, empty, error.

The call is structured as:

```typescript
{
  "server": "stitch",
  "tool": "stitch_generate_screen",
  "args": {
    "project": "<project-domain-or-name>",
    "screen_name": "<screen-identifier>",
    "platform": "iOS",
    "design_token_block": { ... },
    "content": "<real screen content>",
    "reference_screen": "<optional maquette reference>",
    "states": ["default", "hover", "error", "empty"],
    "constraints": "<anti-pattern rules from anti-ai-patterns.md>"
  }
}
```

After generation, the screen is verified with `novahiz-stitch-fidelity`: capture the result, compare against the Stitch reference, produce a PASS or DIVERGE verdict with measured numbers, fix divergences, and re-verify. At most one fix round — the finish is clean, not endlessly polished.

## Fidelity verification protocol

The verification step uses `novahiz-stitch-fidelity` (the separate fidelity audit skill, not this generation skill). It captures the running app screen, composites it with the Stitch reference image, judges on a fixed grid, and produces evidence. It does not assume fidelity — it proves it.

The generation skill stops when `novahiz-stitch-fidelity` returns PASS. If it returns DIVERGE, the generation is fixed (spacing, typography, color, layout, component states) and re-verified. The loop closes with evidence, not with assertion.
