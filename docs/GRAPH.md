# Code Graph — `novahiz graph`

The workspace index: every declaration, call site and identifier occurrence, queryable from the CLI (`novahiz graph …`) and from MCP (`graph_find`, `graph_find_all`, `graph_trace`, `graph_file_api`, `graph_repo_map`, `graph_freshness`). It replaces the old graft MCP entirely — ours end to end: a hand-written lexer, a structural extractor, a resolver, a content-addressed store. No external binary, no third-party package, no runtime dependency beyond Node itself.

## Pipeline

```
source file ─ tokenize ─▶ masked token stream
            ─ extractFile / extractMarkdown ─▶ FileIndex
            ─ buildGraph ─▶ GraphData (call edges + name indexes + stats)
            ─ store ─▶ <NovahizHome>/.graph/<sha12(root)>/
```

| Layer | Module | Role |
|-------|--------|------|
| Lexer | `src/graph/lexer.ts` | Tokens with strings/comments/template text/regex masked out; regex-vs-division heuristics; nested `${…}` in templates |
| Extractor | `src/graph/extract.ts` | One `FileIndex` per file: symbols, imports, exports, call sites, identifier occurrences |
| Resolver | `src/graph/resolve.ts` | Call edges between symbols, import resolution, blast radius (`traceFrom`), workspace stats |
| Store | `src/graph/store.ts` | Manifest, deduplicated objects, `graph.json`, stat-only freshness, incremental rebuild |
| Queries | `src/graph/query.ts` | The six operations behind the MCP tools and the CLI |
| CLI | `src/commands/graph.ts` | `build / status / fresh / find / all / trace / api / map / help` |
| MCP | `mcp/novahiz-tools/index.mjs` | The six `graph_*` tools |

## What "masked" means

Identifier occurrences come from the lexer's token stream, never from raw text. Excluded, by construction:

- string literals (single, double, template **text**),
- comments (`//`, `/* */`),
- template text outside `${…}` (the substitutions themselves are tokenized, nesting included),
- regex literals (heuristic: `/` starts a regex after an operator, keyword or punctuation, and divides after a value).

Consequence: `graph_find_all` is grep-like but noise-free — a word that only appears inside a string, a comment or a template never shows up.

## Extraction rules and their limits

The extractor is **not a parser**. There is no AST and no type inference; declarations are recognized by statement-position patterns plus delimiter-balanced scanning. Precision rules:

- **Symbols live at named scopes**: module/namespace level (`function`, `const`, `class`, `interface`, `type`, `enum`, `namespace`), class members (`method`, `constructor`, `getter`, `setter`), and markdown headings (`heading`). Variables declared *inside* functions are **not** symbols — they are call resolution's `local` scope instead.
- **`enclosing`** is the closest named scope; a symbol with `enclosing: null` is top-level in its file.
- **Signatures** are the declaration without the body (`scanToBody` stops at the balanced brace), whitespace-collapsed — they are what `graph_find` and `graph_file_api` return "inlined".
- **Occurrences** are `[name, line, col]` triplets (1-based) over an interned name table (`identNames`), plus `byName` (declarations) and `inverted` (name → files) aggregates in `GraphData`.
- **Markdown**: `.md` files are indexed; headings become symbols, so `graph_find` finds section titles too.

Accepted limits (each is bounded, none crash the index):

- **No JSX mode.** An apostrophe in JSX text is read as a string opener; the damage is local to that line (French text in JSX — `l'objet` — is the realistic case). TSX declarations and call sites outside such lines index normally.
- **No type inference.** `db.query(…)` resolves only if `query` is unique in the workspace; with two classes exposing `query`, the edge is dropped as ambiguous (see below). Receiver variables (`const db = …`) never carry their type into the graph.
- **Dynamic dispatch** (`obj[key](…)`, `this[x](…)`) produces no edge.
- **Bounds**: scope depths are clamped at 0, chains are cut at the first non-dotted subexpression; exotic constructs (decorators in unusual positions, `using` declarations) degrade to "the surrounding declaration is still found".

## Resolution rules (precision order)

Each call site is resolved by name, strongest signal first:

| Site shape | Order | Confidence |
|------------|-------|------------|
| bare or `this.` | local → import → unique in workspace | `local`, `import`, `unique` |
| dotted (`a.b.c`) | import (first segment = binding) → local → **method** unique in workspace → unique | `import`, `local`, `method`, `unique` |

- **Ambiguous** (more than one candidate at the deciding step): **no edge**, counted in `stats.ambiguous`.
- **Unresolved** (externes included — `fetch`, `console.log`, npm packages): counted in `stats.unresolved`.
- Edges born from a name index only (`unique`, `method`) carry `uncertain: true`.
- Edges are aggregated per `(caller, callee, file)` and keep the best confidence; `viaNew` is true when every site is a `new` call.
- Module-level calls have `caller: -1`; they are reported separately via `fileLevelCallersTo` (never expanded as a hop).
- Invariant: `stats.sites === resolved + ambiguous + unresolved`, and `resolved === local + import + unique + method`.

## Store layout

```
<NovahizHome>/.graph/<sha12(normalized root)>/
  manifest.json                 path → { sha256, size, mtimeMs }
  graph.json                    materialized GraphData (atomic tmp → rename)
  files/<aa>/<sha256>.json.gz   deduplicated FileIndex objects (gzip)
```

- **Freshness is stat-only**: `size + mtimeMs` against the manifest. `graph_status`/`graph_freshness` report drift without writing; the first *stale query* (`find`, `trace`, …) triggers the rebuild automatically.
- **Incremental rebuild**: unchanged files reload their object (keyed by the manifest's sha256, path re-tagged on load so identical content can serve several paths), changed and new files are re-extracted, deleted files drop out; objects nobody references anymore are garbage-collected.
- **Self-healing**: a lost object is re-extracted at the next rebuild (a still-fresh store serves `graph.json`, which is complete); a corrupt `graph.json` falls back to a full rebuild.
- **Determinism**: the walk is sorted, symbols are ordered by file and position, `graph.json` carries no timestamps — identical content yields a byte-identical graph, which is what the tests assert across two builds.
- **The indexed workspace is never written to.** The store lives in the home only. Directory skips: `node_modules`, `dist`, `build`, `out`, `coverage`, `.git`, `.next`, `.nuxt`, `.turbo`, `.cache`. Indexed extensions: `.ts .tsx .js .jsx .mjs .cjs .md`.

## Surfaces

### CLI

```bash
novahiz graph build                 # rebuild now (incremental)
novahiz graph status                # store location, build time, freshness
novahiz graph fresh [--rebuild]     # drift check (stat-only unless --rebuild)
novahiz graph find <name> [--kind k] [--file f] [--limit n]
novahiz graph all <ident> [--file f]
novahiz graph trace <symbol> [--file f] [--direction both|callers|callees] [--depth n]
novahiz graph api <file>
novahiz graph map [--path p] [--depth n]
```

Subcommands accept any unambiguous prefix (`fi` → `find`, `fr` → `fresh`; `f` is refused as ambiguous). Every subcommand accepts `--json` (or `--format json`) and `--root <path>` (default: cwd). `find`, `all`, `trace` and `api` exit `1` when they match nothing — grep-style, so scripts can branch on the status alone.

### MCP

| Tool | Replaces | Answer |
|------|----------|--------|
| `graph_find` | `graft_find_code` | Declarations by name (exact → case-insensitive → substring), spans + signatures |
| `graph_find_all` | `graft_find_all` | Every masked occurrence, per file: count + line numbers |
| `graph_trace` | `graft_trace_calls` | Callers/callees over N hops with per-hop confidence; ambiguous names returned as candidates |
| `graph_file_api` | `graft_file_api` | One file's definitions, exports and raw imports resolved against the workspace |
| `graph_repo_map` | `graft_repo_map` | Aggregated tree (aggregates stay complete below the depth cut) + workspace call stats |
| `graph_freshness` | `graft_check_freshness` | Drift check — never writes unless `rebuild: true` |

All six accept an optional `root` (default: process cwd) and auto-index on first use.

## Statistics

`stats` describes the whole workspace: how many call sites the extractor found, how many resolved (by which rule), how many were dropped as ambiguous, how many stayed unresolved (externals dominate this bucket). A high `unresolved` count is normal — npm packages and platform APIs are not indexed. A high `ambiguous` count means many receiver types go uninferrable; that is the documented cost of having no type checker in the loop.
