// Protocol handler for Lodestone — mirror image of novahiz-docs/src/proto.ts
// and novahiz-tools/index.mjs (handle/TOOLS). Read-only hints on every
// search/symbol/call operation; relative paths only (absolute paths stripped
// in error messages); bounded results (limit clamped, max 100 hits); errors
// sanitized to printable ASCII with `C:\...` masked.

import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { searchLines, type SearchOptions } from "../../../src/search/query.ts";
import { searchStatus, rebuildSearch } from "../../../src/search/store.ts";
import { gitModified, gitRecent, gitBlame } from "../../../src/git.ts";

// Symbol and call-graph reuse the existing Novahiz graph layer.
import {
  graphFind,
  graphTrace,
  graphRepoMap,
  graphFileApi,
} from "../../../src/graph/query.ts";
import type { FindResult, TraceResult, RepoMapResult, FileApiResult } from "../../../src/graph/query.ts";

// Tools declaration — same structure as novahiz-tools/index.mjs TOOLS array.
// Each entry is a JSON Schema inputSchema + a description; annotations
// (readOnlyHint: true, destructiveHint: false, idempotentHint, openWorldHint)
// are embedded in the description text and respected by the handler.
const TOOLS = [
  {
    name: "lodestone_search",
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    description: "Full-text search over the indexed workspace (FTS5, LIKE fallback). Returns hits with file, line, snippet, bm25 rank. Read-only; paths are workspace-relative.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search terms (letters/digits only)." },
        file: { type: "string", description: "Restrict to paths containing this fragment." },
        limit: { type: "number", description: "Maximum hits, default 20, max 100." },
        prefix: { type: "boolean", description: "Prefix-match the last term." },
        root: { type: "string", description: "Workspace root (default cwd)." },
      },
      required: ["query"],
    },
  },
  {
    name: "lodestone_symbol",
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    description: "Find symbol declarations by name (reuses the workspace graph index: exact, case-insensitive, substring). Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Symbol name or fragment." },
        kind: { type: "string", description: "Comma-separated kinds filter." },
        file: { type: "string", description: "Restrict to paths containing this fragment." },
        limit: { type: "number", description: "Maximum hits, default 20, max 200." },
        root: { type: "string", description: "Workspace root (default cwd)." },
      },
      required: ["query"],
    },
  },
  {
    name: "lodestone_callers",
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    description: "Call-graph blast radius: callers/callees of a symbol over N hops, direct edges with confidence (local/import/unique/method), ambiguous names as candidates. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol name to trace from." },
        file: { type: "string", description: "Narrow ambiguous name to first declaration by line." },
        direction: { type: "string", enum: ["callers", "callees", "both"], description: "Default both." },
        depth: { type: "number", description: "Hop count 0-5, default 1." },
        limit: { type: "number", description: "Maximum hits per direction, default 20, max 200." },
        root: { type: "string", description: "Workspace root (default cwd)." },
      },
      required: ["symbol"],
    },
  },
  {
    name: "lodestone_map",
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    description: "Aggregated workspace tree: directories and files with symbol and line counts, optionally scoped to a prefix, with workspace-level call statistics. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Subtree prefix, e.g. src." },
        depth: { type: "number", description: "Tree levels 1-6, default 3." },
        root: { type: "string", description: "Workspace root (default cwd)." },
      },
    },
  },
  {
    name: "lodestone_excerpt",
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    description: "Signatures-only view of one file: definitions with spans, exports and resolved imports. Read-only.",
    inputSchema: {
      type: "object",
      properties: { file: { type: "string", description: "Workspace path or fragment." }, root: { type: "string" } },
      required: ["file"],
    },
  },
  {
    name: "lodestone_status",
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    description: "Index health and drift: does the full-text store match the workspace? Reports added/changed/removed files and engine (ft5/like) — never writes. Read-only.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string", description: "Workspace root (default cwd)." } },
    },
  },
  {
    name: "lodestone_git",
    annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, idempotentHint: true },
    description: "Git recent commits, blame for a file range, and modified/staged/untracked/conflicted paths. Read-only. Returns repo:false when root is not a git work tree.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["recent", "blame", "modified"], description: "Sub-action." },
        root: { type: "string", description: "Workspace root (default cwd)." },
        file: { type: "string", description: "Path (blame only, relative)." },
        start: { type: "number", description: "First line (blame, default 1)." },
        count: { type: "number", description: "Line count (blame, max 200)." },
        limit: { type: "number", description: "Max commits (recent, max 100)." },
      },
      required: ["action"],
    },
  },
  {
    name: "lodestone_reindex",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    description: "Force a full rebuild of the full-text index (writes to `.search/` only) and reports the new status. Read-only workspace; writes live in `.search/` only.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string", description: "Workspace root (default cwd)." } },
    },
  },
];

const SERVER_INFO = { name: "novahiz-search", version: "0.1.0" };
const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-06-18", "2025-11-25"];
const DEFAULT_PROTOCOL = "2025-11-25";

function negotiateProtocol(requested?: string): string {
  if (typeof requested === "string" && SUPPORTED_PROTOCOLS.includes(requested)) return requested;
  return DEFAULT_PROTOCOL;
}

export interface JsonResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function sanitizeMessage(raw: string): string {
  // Sanitization rule from the harness: printable ASCII only, no absolute
  // paths leaking filesystem structure. Applied to error messages before
  // they cross the stdio wire (same protection as novahiz-tools/index.mjs).
  return raw
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[A-Z]:\\[^\s]*/g, "[path]")
    .slice(0, 300);
}

function sanitizeTextObj(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeMessage(value);
  if (Array.isArray(value)) return value.map(sanitizeTextObj);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeTextObj(v);
    }
    return out;
  }
  return value;
}

function decorateReadOnly(result: unknown): { content: Array<{ type: string; text: string }>; annotations?: Record<string, unknown> } {
  return { content: [{ type: "text", text: JSON.stringify(sanitizeTextObj(result), null, 2) }] };
}

function resolveRoot(root?: string): string {
  // Security: the root argument is validated, never trusted. Sanitization
  // applies to OUTPUT text (sanitizeTextObj/maskAbsPath) — mangling the
  // functional input here would break every call that passes an absolute
  // workspace root. Constraints: non-empty, existing directory; anything
  // else is rejected as Invalid params instead of being followed.
  const raw = typeof root === "string" && root.trim().length > 0 ? root : process.cwd();
  let resolved: string;
  try {
    resolved = realpathSync(resolve(raw));
  } catch {
    throw new Error("Invalid params: root not found");
  }
  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    throw new Error("Invalid params: root not found");
  }
  if (!stat.isDirectory()) throw new Error("Invalid params: root is not a directory");
  return resolved;
}

export function handle(message: unknown): JsonResponse | null {
  const msg = message as { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown> };
  const id = msg.id !== undefined && msg.id !== null ? msg.id : null;
  const method = msg.method ?? "";
  const params = msg.params ?? {};
  const hasId = id !== undefined && id !== null;
  if (!hasId) return null;

  if (method === "initialize") {
    const protocol = negotiateProtocol(typeof params.protocolVersion === "string" ? params.protocolVersion : undefined);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: protocol,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      // Tool dispatch: 8 named tools. Each tool validates, runs, and
      // returns a read-only result decorated with annotations.
      const result = callTool(name, args);
      return { jsonrpc: "2.0", id, result: decorateReadOnly(result) };
    } catch (e: unknown) {
      const msgStr = String((e as { message?: string })?.message ?? (e as string));
      const clean = sanitizeMessage(msgStr);
      if (msgStr.startsWith("Unknown tool:")) {
        return { jsonrpc: "2.0", id, error: { code: -32601, message: clean } };
      }
      if (msgStr.startsWith("Invalid params:")) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: clean } };
      }
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `internal error: ${clean}` }], isError: true } };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${sanitizeMessage(String(method))}` } };
}

function callTool(name: string, args: Record<string, unknown>): unknown {
  const root = resolveRoot(typeof args.root === "string" ? args.root : undefined);

  if (name === "lodestone_search") {
    const opts: SearchOptions = {
      query: String(args.query ?? ""),
      file: typeof args.file === "string" ? args.file : undefined,
      limit: typeof args.limit === "number" ? args.limit : 20,
      prefix: args.prefix === true,
    };
    return searchLines(root, opts);
  }

  if (name === "lodestone_symbol") {
    const result: FindResult = graphFind(root, {
      query: String(args.query ?? ""),
      kind: typeof args.kind === "string" ? args.kind : undefined,
      file: typeof args.file === "string" ? args.file : undefined,
      limit: typeof args.limit === "number" ? args.limit : 20,
    });
    return result;
  }

  if (name === "lodestone_callers") {
    const result: TraceResult = graphTrace(root, {
      symbol: String(args.symbol ?? ""),
      file: typeof args.file === "string" ? args.file : undefined,
      direction: (args.direction === "callers" || args.direction === "callees") ? args.direction : "both",
      depth: typeof args.depth === "number" ? args.depth : 1,
      limit: typeof args.limit === "number" ? args.limit : 20,
    } as import("../../../src/graph/query.ts").TraceOptions);
    return result;
  }

  if (name === "lodestone_map") {
    const result: RepoMapResult = graphRepoMap(root, {
      path: typeof args.path === "string" ? args.path : undefined,
      depth: typeof args.depth === "number" ? args.depth : 3,
    });
    return result;
  }

  if (name === "lodestone_excerpt") {
    const filePath = String(args.file ?? "");
    if (filePath.length === 0) throw new Error("Invalid params: file must be a non-empty string");
    const result: FileApiResult = graphFileApi(root, { file: filePath });
    return result;
  }

  if (name === "lodestone_status") {
    return searchStatus(root);
  }

  if (name === "lodestone_git") {
    const action = String(args.action ?? "modified");
    if (action === "modified") {
      return gitModified(root);
    }
    if (action === "recent") {
      return gitRecent(root, typeof args.limit === "number" ? args.limit : 20);
    }
    if (action === "blame") {
      const filePath = String(args.file ?? "");
      return gitBlame(root, filePath, typeof args.start === "number" ? args.start : 1, typeof args.count === "number" ? args.count : 40);
    }
    throw new Error(`Invalid params: unknown git action: ${action}`);
  }

  if (name === "lodestone_reindex") {
    return rebuildSearch(root);
  }

  throw new Error(`Unknown tool: ${name}`);
}
