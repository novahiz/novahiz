# Argus MCP — Implementation Summary & Verification Record

This document records what is actually implemented, how it was verified, and
what the audit found. It deliberately replaces an earlier version of this file
whose claims (TypeScript build, tree-sitter parsing, npm dependencies,
`scan_file`/`scan_directory` tools) did not match the code. Claims below are
traceable to a file or a test run.

## What is implemented

| Component | File | State |
|---|---|---|
| stdio JSON-RPC 2.0 loop, MCP lifecycle dispatch | `src/cli.mjs` | working |
| Shared configuration (size/rule/path caps, ignore list) | `src/config.mjs` | working |
| Rule registry: validation, ReDoS gate, keyword pre-filter, matching | `src/analysis/ruleEngine.mjs` | working |
| Filesystem scanner: walk, binary/size gates, language map | `src/analysis/scanner.mjs` | working |
| Tool base class + registry/dispatch | `src/tools/tool.mjs`, `toolManager.mjs` | working |
| 4 MCP tools: `scan`, `list_rules`, `create_rule`, `export_results` | `src/tools/*.mjs` | working |
| 5 built-in rules (SQLi, XSS, command injection, hardcoded secret, unsafe deserialization) | `src/cli.mjs` | working |
| End-to-end test (spawns the real server) | `src/commands/test.mjs` | 30/30 pass |
| Vulnerable fixtures | `src/test/` | 4 files |
| Novahiz registration (`kind: mcp`, category `audit`) | `catalog/providers.json` | registered |

**Not implemented** (claims from an earlier draft were removed): tree-sitter
parsing, TypeScript compilation (`tsconfig.json` and `types.d.ts` were deleted
— the project is plain JavaScript), rate limiting, findings remediation
(`solution` field), `scan_file`/`scan_directory` tools (there is one `scan`
that accepts a file or a directory), the `rules/*.json` loader exists but no
rule pack ships yet.

## Verification

`npm test` → **30 passed, 0 failed** (`node src/commands/test.mjs`). The test
spawns `src/cli.mjs` as a real subprocess and asserts, over the wire:

- **Handshake:** `initialize` returns `serverInfo`, echoes a supported
  `protocolVersion` (`2024-11-05` and `2025-06-18` were both verified),
  declares only the `tools` capability.
- **Notifications:** `notifications/initialized` produces no response (the
  next line read is the `ping` reply — a stray response would fail the id
  assertion).
- **tools/list:** exactly 4 tools, each with `inputSchema.type === "object"`
  and a description.
- **scan:** finds all planted vulnerabilities across the 4 fixtures
  (7 findings: 2× sql-injection, 1× xss, 1× command-injection,
  3× hardcoded-secret), positions ≥ 1, no read errors, and a second scan is
  byte-identical (determinism).
- **list_rules:** 5 built-ins, compiled regex never serialized.
- **create_rule:** valid rule accepted; `(a+)+$` rejected by the ReDoS gate
  ("nested quantifier"); malformed id rejected.
- **export_results:** writes a JSON file that re-parses with findings
  (manual runs verified all 4 formats: json, sarif, csv, html).
- **Error paths:** unknown method → `-32601`, unknown tool → `-32602`,
  invalid JSON → `-32700` with `id: null`, batch array → `-32600`,
  request before `initialize` → `-32002`.

## Audit history (why this record exists)

A first audit of this project found the server **did not start at all**:
TypeScript syntax inside `.mjs` files (6 × `SyntaxError`), a broken string
escape in a built-in rule, wrong import paths, `CONFIG` referenced without an
import, a circular `cli ↔ scanner` import, an invalid MCP handshake
(`initialize` without `protocolVersion`/`serverInfo`), a mock `scan` result,
no `package.json`, no test ever run — while an earlier report claimed
"everything is OK". That claim was false and was retracted.

Fixes applied: every file rewritten in plain JavaScript; `CONFIG` extracted to
`config.mjs` (cycle removed); the real `Scanner` wired into `tools/call`; the
MCP dispatch rewritten against the spec (research-verified: notification
rules, error codes, `ping` → `{}`, probe lists, single-line framing, stdout
purity); a `package.json` with zero dependencies added; the E2E suite above
written and run.

**Lesson carried forward:** no status claim without an execution trace.

## Protocol notes (research-verified against the MCP spec 2025-06-18)

- Messages are newline-delimited single-line JSON; the server must never
  write non-MCP bytes to stdout (all logging → stderr).
- `ping` → `{}` (never null); unknown-tool is a protocol error (`-32602`)
  while a tool that runs and fails returns `isError: true`.
- `resources/list`, `resources/templates/list`, `prompts/list` answer empty
  lists rather than `-32601` (hosts probe anyway).
- Batch arrays are not valid MCP → `-32600`.
- Protocol version negotiation: echo the requested version if supported,
  else answer with the newest one we speak.

## Engine notes (research-validated, 45/45 in the research harness)

- V8 has no regex timeout: the ReDoS gate at registration is the protection.
- Keyword pre-filter must be conservative: every `|` member is analyzed, and
  one member without a literal disables the filter for that rule (false
  negatives would be worse than a slower scan).
- `lastIndex` on a shared `/g` regex is reset before and after each file.
- Line/column via one line-start table + binary search; UTF-16 units match
  `RegExp` indices by construction.
- Read order stat → size gate → 8 KB peek → full read; NUL byte ⇒ binary.

## Integration

Registered in `catalog/providers.json`:

```json
{
  "id": "novahiz-scan",
  "label": "Novahiz Scan",
  "kind": "mcp",
  "command": ["node", "~/.config/novahiz/mcp/argus/src/cli.mjs"],
  "source": "https://github.com/novahiz/novahiz",
  "license": "MIT",
  "categories": ["audit"]
}
```

Verified: `node bin/novahiz.mjs providers --mcp-json` returns
`"novahiz-scan": {"type":"local","command":["node","C:\\Users\\hiz\\.config\\novahiz\\mcp\\argus\\src\\cli.mjs"],"enabled":true}`
— the plugin will register it at the next opencode startup (`autoRegister`
defaults to true, `~` is expanded by `buildMcpEntries`).

## License

MIT
