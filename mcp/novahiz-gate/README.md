# novahiz-gate

A dependency-free MCP server exposing `novahiz_gate`, the Novahiz rule gate. It was extracted from `mcp/novahiz-tools` (registered as `novahiz-core`) so the gate can be registered, started and versioned on its own — harnesses register it as `novahiz-gate`.

Tools:

- `novahiz_gate` checks a file edit against the rules and returns the verdict: `allow`, `requiredSkills`, `missingSkills`, `reasons`, plus the ledger enforcement merge. Content-aware rules (placeholders, design selectors) evaluate the `content` you pass.

Protocol notes:

- Arguments are read from stdin, never argv (Windows has a 32k argv limit): the `--call` mode routes through the same `handle()` as the stdio loop.
- Protocol violations return JSON-RPC errors (`-32601` unknown tool, `-32602` invalid params); a refusal is a normal verdict, not an error (`isError: false`, exit code 0).
- `NOVAHIZ_GATE=off` is the only kill-switch, identical to the CLI gate. Both share `src/gate.ts`, so MCP and CLI verdicts cannot diverge.
- `enabled: false` in `novahiz.config.json` does not switch enforcement off; the config warning goes to stderr.

Run it directly:

```
node mcp/novahiz-gate/index.mjs
```

One-shot call (exit 0 = valid verdict, 1 = protocol error):

```
echo '{"file":"README.md","tool":"write","content":"...","loaded":[]}' | node mcp/novahiz-gate/index.mjs --call novahiz_gate
```

The opencode plugin registers it automatically through the plugin `config` `mcp.transform` fallback (same rule as `novahiz-core`); a user-configured entry always wins. Verify with `novahiz doctor --deep` (`mcp-gate` / `mcp-gate-probe` checks).

It speaks newline-delimited JSON-RPC over stdio. No npm install is needed.
