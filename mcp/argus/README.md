# Argus MCP Server

Argus is a static-analysis MCP server that detects security vulnerabilities in source code. It is an original, clean-room implementation: no code, rule format, or architecture was taken from semgrep or any other scanner.

**Design goals:** zero npm dependencies, plain JavaScript executed directly by Node, deterministic output, and a protocol implementation that follows the MCP spec.

- **Category:** `audit` (Novahiz provider, registered in `catalog/providers.json`)
- **Transport:** stdio, newline-delimited JSON-RPC 2.0
- **Protocol versions spoken:** `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07` (the client's requested version is echoed when supported)
- **License:** MIT

## Architecture

```
src/
├── cli.mjs                 entry point: stdio loop, JSON-RPC/MCP dispatch, built-in rules
├── config.mjs              shared configuration (limits, ignored directories)
├── analysis/
│   ├── ruleEngine.mjs      rule registry, ReDoS gate, keyword pre-filter, matching
│   └── scanner.mjs         filesystem walk, binary/size gates, language detection
├── tools/
│   ├── tool.mjs            base class (MCP tool definition shape)
│   ├── toolManager.mjs     registry + tools/call dispatch
│   ├── scanTool.mjs        scan
│   ├── listRulesTool.mjs   list_rules
│   ├── createRuleTool.mjs  create_rule
│   └── exportResultsTool.mjs  export_results
├── commands/
│   └── test.mjs            end-to-end test (spawns the real server, 30 assertions)
└── test/                   four fixtures with planted vulnerabilities
```

## Tools

### `scan`

Scan a file or a directory.

```json
{
  "path": "src/",
  "rules": ["sql-injection"],
  "languages": ["python"]
}
```

| param | type | required | purpose |
|---|---|---|---|
| `path` | string | yes | file or directory to scan |
| `rules` | string[] | no | restrict to these rule ids |
| `languages` | string[] | no | restrict to files of these languages |

Result (`structuredContent`, also serialized as text for the model):

```json
{
  "findings": [
    { "rule": "sql-injection", "name": "SQL Injection", "severity": "error",
      "file": "/abs/path/file.py", "line": 9, "column": 13,
      "message": "SQL built from an f-string...", "code": "f\"SELECT ..." }
  ],
  "scanned_files": 4,
  "scanned_paths": ["..."],
  "errors": [],
  "scan_time": 12
}
```

Findings are sorted by file, then line, then rule id: the same input always yields byte-identical output.

### `list_rules`

List registered rules, optionally filtered by `category` (`security` = severity not `info`, `quality` = severity `info`) or `language`. The compiled regex and keyword index are engine internals and are never serialized.

### `create_rule`

Register a custom rule. The pattern is a JavaScript regular expression that must pass the validation gate before it is ever compiled:

- id must match `[A-Za-z0-9][A-Za-z0-9._-]*` (max 128 chars), severity must be `error|warning|info`
- pattern length cap (`config.maxPatternLength`, 2000)
- **ReDoS gate:** rejects huge repetition bounds (`{n}` > 1000), stacked quantifiers (`a*+`), nested quantifiers (`(x+x+)+` — star height > 1), overlapping dot-stars, quantified lookaheads
- rule count cap (500)

### `export_results`

Write results to `json`, `sarif` (SARIF 2.1.0), `csv`, or `html`. Output goes to the server temp dir by default (`output_dir` overrides it). Returns `{ success, format, exported_file }`.

## Built-in rules

| id | severity | detects | CWE |
|---|---|---|
| `sql-injection` | error | SQL from f-string/concat/template interpolation, or `query/execute(raw)` called with a non-literal | CWE-89 |
| `xss` | error | `innerHTML =`, `outerHTML =`, `document.write(`, `dangerouslySetInnerHTML`, `insertAdjacentHTML` | CWE-79 |
| `command-injection` | error | `subprocess.run/call/Popen`, `os.system`, `system(`, `shell_exec(`, `popen(`, `eval(`, `curl … \| sh` | CWE-78 |
| `hardcoded-secret` | warning | `password/secret/token/api_key/…` assigned a quoted literal of 8+ chars | CWE-798 |
| `insecure-deserialization` | error | `pickle.loads`, `yaml.load`, `marshal.loads`, `unserialize` | CWE-502 |

Custom rules can also be loaded from `rules/*.json` at startup (an array of rule objects, or `{ "rules": [...] }`).

## How the engine stays fast and safe

1. **Keyword pre-filter.** Literal fragments are extracted from every pattern (character classes and escapes stripped, every `|` member analyzed). If one member yields no literal of 4+ chars, the filter is disabled for that rule — a pre-filter that could skip a matching file is worse than no pre-filter. Otherwise the regex runs only when `content.includes()` found a keyword.
2. **Line/column without splitting.** One pass builds a line-start table; each match resolves via binary search (UTF-16 units, consistent with `RegExp` indices — including `\r\n` files).
3. **Compiled once.** The `g` regex is compiled at registration and shared; `lastIndex` is reset before and after every file (a dirty `lastIndex` silently drops matches in the next file).
4. **Read order: stat → size gate → 8 KB binary peek → full read.** A large binary never gets more than one 8 KB read; files > 10 MB are skipped; a NUL byte in the first 8 KB marks the file binary.
5. **Walk guards.** `node_modules`, `dist`, `.git`, `vendor`, `__pycache__`, etc. are skipped, symlinks are not followed (no cycles), depth ≤ 32, hard cap on entries.

## Security controls

- **Stdout purity:** stdout carries only single-line JSON-RPC messages; every log goes to stderr (one stray `console.log` corrupts the transport).
- **ReDoS gate** at rule registration (V8 has no regex timeout API — rejecting bad patterns is the real protection).
- **Input validation:** path length cap, pattern length cap, rule count cap, severity/id whitelists.
- **Filesystem containment:** scan path is resolved and read-only; export files are written under a resolved directory.
- **Protocol conformance:** notifications never get a response, `id: null` and batch arrays are rejected (`-32600`), unknown tool → `-32602`, tool execution failure → `isError: true` (the model can see and correct it), requests before `initialize` → `-32002`.

## Known limits (honest list)

- **Regex is not taint tracking.** `el.innerHTML = sanitize(x)` is a false positive; `dataflow` between lines is invisible. The findings are a triage starting point, not proof of exploitability.
- **No regex timeout exists in V8.** The static ReDoS gate plus the size caps are the protection; a worker-kill escalation path would be needed for untrusted third-party rule packs.
- Language detection is by file extension only; columns are UTF-16 code units.

## Running

```bash
node src/cli.mjs      # start the server on stdio
npm test              # end-to-end test: spawns the server, 30 assertions
```

No `npm install` is needed — there are no dependencies.

## Integration with Novahiz

Already registered in `catalog/providers.json`:

```json
{
  "id": "novahiz-scan",
  "label": "Novahiz Scan",
  "kind": "mcp",
  "command": ["node", "~/.config/novahiz/mcp/argus/src/cli.mjs"],
  "source": "https://github.com/novahiz/novahiz",
  "license": "MIT",
  "categories": ["audit"],
  "purpose": "Local stdio static-analysis server ..."
}
```

With `providers.autoRegister` enabled (the default), the Novahiz opencode plugin expands `~` and registers the server at opencode startup. Verify with:

```bash
node bin/novahiz.mjs providers --mcp-json
```

## License

MIT
