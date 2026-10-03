#!/usr/bin/env node
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { resolve, sep } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { classify } from "../../src/classify.ts";
import { enforceLedgerChecks, evaluateGate } from "../../src/gate.ts";
import { loadSpec } from "../../src/spec.ts";
import { loadCatalog, loadInstalledSkills } from "../../src/catalog.ts";
import { rankSkills } from "../../src/relevance.ts";
import { openDb } from "../../src/db.ts";
import { capture, diffSnapshots, listSnapshots, loadManifest, matchingIds, restoreSnapshot, snapStatus } from "../../src/snap.ts";
import { enabledProviders } from "../../src/providers.ts";
import { checkDependencies } from "../../src/deps.ts";
import { activeTask, addTodos, amendTodo, blockTodo, buildWorkPackets, completeTodo, createTask, dropTask, dropTodo, getTask, getTodo, insertTodo, ledgerSummary, listTodos, parseReviewDiff, recordTodoDone, reorderTodos, resume, reviewDue, reviewTask, revisionSignals, startTodo } from "../../src/ledger.ts";
import { DEFAULT_LIMIT_CHARS, DEFAULT_LIMIT_LINES, archiveSlot, ensureMemoryRoot, getSlot, listSlots, memoryRoot, parseSlotInput, rebuildIndex, searchSlots, updateSlot, writeEntry } from "../../src/memory.ts";

// A memory root must stay inside the workspace: memory_* used to create
// project-memory/ directories anywhere the caller named (audit P1-D/M4).
function safeMemoryRoot(raw) {
  const base = typeof raw === "string" && raw.length > 0 ? raw : memoryRoot();
  const abs = resolve(base);
  const ws = resolve(process.cwd());
  if (abs !== ws && !abs.startsWith(ws + sep)) {
    throw new Error("Invalid params: memory root outside the workspace");
  }
  return abs;
}

const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-06-18"];
const DEFAULT_PROTOCOL = "2024-11-05";
let SERVER_VERSION = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  SERVER_VERSION = pkg.version ?? "0.0.0";
} catch { /* keep default */ }
const SERVER_INFO = { name: "novahiz-tools", version: SERVER_VERSION };

const TOOLS = [
  {
    name: "novahiz_classify",
    description: "Classify a prompt into Novahiz categories and return the skills those categories require.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string", description: "The user prompt to classify." } },
      required: ["prompt"]
    }
  },
  {
    name: "novahiz_list_skills",
    description: "List installed and catalogued skills, optionally filtered by category.",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string", description: "Optional category id." } }
    }
  },
  {
    name: "novahiz_catalog",
    description: "Rank catalogued skills by deterministic lexical relevance to a query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the task is about." },
        limit: { type: "number", description: "Maximum results (default 10)." }
      },
      required: ["query"]
    }
  },
  {
    name: "novahiz_gate",
    description: "Check whether a file edit satisfies the Novahiz rules. Returns allow, required skills and missing skills.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Target file path." },
        filePath: { type: "string", description: "Alias of file. Some harnesses rename the parameter when they surface the tool." },
        tool: { type: "string", description: "edit, write or patch." },
        content: { type: "string", description: "The edited content, used for content-aware rules." },
        prompt: { type: "string", description: "Optional prompt used to auto-classify when categories is omitted or empty." },
        categories: { type: "array", items: { type: "string" }, description: "Category ids. When omitted or empty, inferred from prompt, content, or file path." },
        loaded: { type: "array", items: { type: "string" } }
      }
    }
  },
  {
    name: "novahiz_roadmap",
    description: "Return the execution roadmap for a category or the category a query classifies into.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category id." },
        query: { type: "string", description: "A prompt to classify." }
      }
    }
  },
  {
    name: "novahiz_providers",
    description: "List the MCP providers registered in Novahiz, optionally for a category or a prompt.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category id." },
        query: { type: "string", description: "A prompt to classify." }
      }
    }
  },
  {
    name: "novahiz_deps",
    description: "Check that every provider prerequisite (npx, uv) is available on the machine.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "novahiz_step",
    description: "Record or list roadmap step progress for a session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        done: { type: "string", description: "Step id to mark done." }
      }
    }
  },
  {
    name: "novahiz_task",
    description: "Drive the durable execution ledger and keep its plan alive. Create a task, add long detailed todos, then start, complete or block them. Revise the plan between steps with review, amend, insert, drop and reorder. A todo of kind verify cannot be completed without proof. Actions: new, plan, todo, start, done, block, review, amend, insert, drop, reorder, signals, status, resume, current.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["new", "plan", "todo", "start", "done", "block", "review", "amend", "insert", "drop", "reorder", "signals", "status", "resume", "current"],
          description: "What to do with the ledger."
        },
        title: { type: "string", description: "Task title for action new." },
        id: { type: "string", description: "Task id (new) or todo/task id (start, done, block, drop)." },
        task: { type: "string", description: "Task id. Defaults to the active task." },
        session: { type: "string", description: "Session id used to scope the active task." },
        projectRoot: { type: "string", description: "Project directory a new task belongs to (action new). Omitted = unscoped legacy task." },
        label: { type: "string", description: "Todo label for action todo." },
        kind: { type: "string", enum: ["read", "edit", "verify", "delegate"], description: "Todo kind." },
        acceptance: { type: "string", description: "Acceptance criterion for the todo." },
        owner: { type: "string", description: "Comma-separated file globs this todo owns." },
        proof: { type: "string", description: "Proof for action done. Required when the todo kind is verify." },
        reason: { type: "string", description: "Reason for action block." },
        maxIterations: { type: "number", description: "Iteration budget for the todo (default 12)." },
        dependsOn: { type: "array", items: { type: "string" }, description: "Todo ids this todo depends on." },
        position: { type: "string", description: "Insert position for action insert: start, end, or a sequence number." },
        order: { type: "array", items: { type: "string" }, description: "Todo ids in the new order for action reorder." },
        changes: {
          type: "object",
          description: "Plan diff for action review: { additions, amendments, removals, order }."
        },
        todos: {
          type: "array",
          items: { type: "object" },
          description: "Array of todo inputs for action plan."
        }
      },
      required: ["action"]
    }
  },
  {
    name: "novahiz_dispatch",
    description: "Turn the active task's pending todos into work packets for subagents, each with an objective, owned files, exit criteria and budget. Reports file-ownership conflicts.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task id. Defaults to the active task." },
        session: { type: "string", description: "Session id used to scope the active task." }
      }
    }
  },
  {
    name: "memory_write",
    description: "Append a dated entry into project-memory under project-memory/slots. Picks the related active slot by token overlap or creates a new one; rotates (compact, archive, new slot) when full (8000 chars / 200 lines).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short entry title." },
        content: { type: "string", description: "Markdown body for Détails." },
        description: { type: "string", description: "Slot description when creating." },
        tags: { type: "array", items: { type: "string" } },
        slotId: { type: "string", description: "Force a target slot id instead of relatedness." },
        root: { type: "string", description: "Project root containing project-memory (default cwd)." }
      },
      required: ["title", "content"]
    }
  },
  {
    name: "memory_update",
    description: "Update an existing slot: replace or append its Détails, or rewrite its Résumé (bounded to 1000 chars). Archived slots are refused.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Slot id to update, e.g. slot-001." },
        mode: { type: "string", enum: ["replace", "append", "summary"], description: "replace/append edit Détails, summary rewrites Résumé." },
        content: { type: "string", description: "Markdown body for Détails (replace/append)." },
        summary: { type: "string", description: "New Résumé (mode=summary only)." },
        root: { type: "string", description: "Project root containing project-memory (default cwd)." }
      },
      required: ["id", "mode"]
    }
  },
  {
    name: "memory_archive",
    description: "Mark a slot as archived (idempotent, no data deletion): archived slots are skipped by routing and search unless includeArchived.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Slot id to archive, e.g. slot-001." },
        root: { type: "string", description: "Project root containing project-memory (default cwd)." }
      },
      required: ["id"]
    }
  },
  {
    name: "memory_list",
    description: "List project-memory slots from index.json (active and archived) with optional status/tag/limit filters and summary previews.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Project root containing project-memory (default cwd)." },
        status: { type: "string", enum: ["active", "archived", "all"], description: "Filter by slot status (default all)." },
        tag: { type: "string", description: "Keep slots carrying this tag (case-insensitive)." },
        limit: { type: "number", description: "Return at most this many slots (default: no limit)." },
        preview: { type: "boolean", description: "Add a short Résumé preview to each slot." }
      }
    }
  },
  {
    name: "memory_get",
    description: "Read one project-memory slot: full body by default, or only meta / only Résumé via section.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Slot id, e.g. slot-001." },
        root: { type: "string", description: "Project root containing project-memory (default cwd)." },
        section: { type: "string", enum: ["full", "meta", "summary"], description: "Part to return: full (default), meta, or summary (Résumé only)." }
      },
      required: ["id"]
    }
  },
  {
    name: "memory_search",
    description: "Search project-memory slots by relevance: fold + IDF ranking over title, description, tags, Résumé and Détails; returns scored results with confidence and snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text query to rank slots against." },
        root: { type: "string", description: "Project root containing project-memory (default cwd)." },
        limit: { type: "number", description: "Maximum results (default 5, max 20)." },
        includeArchived: { type: "boolean", description: "Also search archived slots (default false)." }
      },
      required: ["query"]
    }
  },
  {
    name: "memory_init",
    description: "Create project-memory/ (index.json + slots/) under the project root if missing.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Project root (default cwd)." }
      }
    }
  },
  {
    name: "memory_rebuild",
    description: "Rebuild project-memory/index.json from slot markdown files.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Project root containing project-memory (default cwd)." }
      }
    }
  },
  {
    name: "snap_log",
    description: "List the ledger's snapshots, newest first (id, date, operation, detail, size). Pass id — exact or unique prefix — to read a single manifest instead.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum snapshots to return (default 20, max 50)." },
        id: { type: "string", description: "Snapshot id or unique prefix: return that manifest instead of the list." }
      }
    }
  },
  {
    name: "snap_status",
    description: "Report the snapshot store: location, count, newest snapshot, total size, retention, and captures still waiting for a transaction to close.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "snap_diff",
    description: "Compare a snapshot with another snapshot or with the live ledger, row by row. Read-only: writes nothing, snapshots nothing.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Snapshot id or unique prefix." },
        to: { type: "string", description: "Second snapshot id/prefix, or 'current' (default) for the live ledger." }
      },
      required: ["from"]
    }
  },
  {
    name: "snap_restore",
    description: "Put the ledger back to a snapshot. Rewrites rows inside one transaction — the database file is never replaced, so an open connection keeps working — writes a safety backup first, then snapshots the restored state. REFUSES unless force is true.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Snapshot id or unique prefix to restore." },
        force: { type: "boolean", description: "Must be true. Anything else refuses and changes nothing." }
      },
      required: ["id"]
    }
  }
];

export function negotiateProtocol(requested) {
  if (SUPPORTED_PROTOCOLS.includes(requested)) return requested;
  return SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1];
}

function toolResult(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError };
}

function normalizeTodo(item) {
  if (!item || typeof item !== "object") return { label: String(item ?? "") };
  const ownerValue = item.owner;
  const owner = Array.isArray(ownerValue)
    ? ownerValue.map(String).join(",")
    : ownerValue
      ? String(ownerValue)
      : undefined;
  return {
    label: String(item.label ?? item.title ?? ""),
    kind: item.kind ? String(item.kind) : undefined,
    acceptance: item.acceptance ? String(item.acceptance) : undefined,
    owner,
    dependsOn: Array.isArray(item.dependsOn)
      ? item.dependsOn.map(String)
      : Array.isArray(item.depends_on)
        ? item.depends_on.map(String)
        : undefined,
    maxIterations: Number.isFinite(item.maxIterations)
      ? Number(item.maxIterations)
      : Number.isFinite(item.max_iterations)
        ? Number(item.max_iterations)
        : undefined
  };
}

/**
 * Resolve a snapshot id the way the CLI does: an exact id, or any prefix that
 * names exactly one snapshot. "Not found" and "ambiguous" are different
 * answers, and both are bad parameters for the caller, so each throws with
 * its own message instead of collapsing into a generic failure.
 */
function resolveSnapId(prefix) {
  const raw = String(prefix ?? "").trim();
  const matches = matchingIds(raw);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`Invalid params: snapshot introuvable: ${raw}`);
  const shown = matches.slice(0, 5).join(", ");
  const extra = matches.length > 5 ? " ..." : "";
  // Thrown messages are sanitized to printable ASCII before they reach the
  // client (control characters and escape sequences must not survive), so they
  // are written without accents instead of being mangled on the way out.
  throw new Error(`Invalid params: prefixe ambigu: ${raw} correspond a ${matches.length} snapshots (${shown}${extra})`);
}

function callTool(name, args) {
  // Protocol violations throw: handle() maps "Unknown tool:" to -32601 and
  // "Invalid params:" to -32602. Only execution failures return isError results.
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Invalid params: tool name must be a non-empty string");
  }
  if (args !== null && args !== undefined && (typeof args !== "object" || Array.isArray(args))) {
    throw new Error("Invalid params: arguments must be an object");
  }
  // H-MCP: input size limits to prevent DoS via large payloads
  const MAX_PROMPT_LEN = 100000;
  const MAX_CONTENT_LEN = 1000000;
  const spec = loadSpec();
  if (name === "novahiz_classify") {
    const prompt = String(args?.prompt ?? "");
    if (prompt.length > MAX_PROMPT_LEN) {
      throw new Error(`Invalid params: prompt exceeds ${MAX_PROMPT_LEN} characters`);
    }
    return toolResult({ prompt, ...classify(spec, prompt) });
  }
  if (name === "novahiz_list_skills") {
    const index = loadInstalledSkills(spec);
    const category = args?.category ? String(args.category) : null;
    const fromCategories = category
      ? new Set((spec.categories.find((entry) => entry.id === category)?.defaultSkills ?? []))
      : null;
    const entries = [...index.skills]
      .sort()
      .filter((id) => {
        if (!category) return true;
        if (fromCategories.has(id)) return true;
        return (spec.overrides.skills?.[id]?.categories ?? []).includes(category);
      });
    return toolResult({ count: entries.length, indexAvailable: index.available, skills: entries });
  }
  if (name === "novahiz_catalog") {
    const query = String(args?.query ?? "");
    // M-MCP: bound limit to prevent excessive results
    const MAX_CATALOG_LIMIT = 50;
    const limit = Math.min(Number.isFinite(args?.limit) ? Number(args.limit) : 10, MAX_CATALOG_LIMIT);
    const catalog = loadCatalog(spec);
    return toolResult({ query, total: catalog.length, results: rankSkills(catalog, query, limit) });
  }
  if (name === "novahiz_gate") {
    // C2: a project-writable config must not silently switch enforcement off
    // from MCP either. The only kill-switch is NOVAHIZ_GATE=off.
    if (spec.config.gate.enabled === false) {
      process.stderr.write(
        'novahiz: gate.enabled=false in novahiz.config.json is ignored; enforcement stays active. Use NOVAHIZ_GATE=off to disable the gate.\n'
      );
    }
    // C5: envEscape is now hardcoded to "NOVAHIZ_GATE" (the primary env
    // var). The old configurable envEscape field allowed bypassing enforcement
    // by setting an arbitrary env var. Hardcoded: the only way to override is
    // through the canonical NOVAHIZ_GATE var.
    const escapeValue = (process.env.NOVAHIZ_GATE || "").toLowerCase();
    if (["off", "0", "false", "no", "disabled"].includes(escapeValue)) {
      return toolResult({ allow: true, disabled: true });
    }
    // Strict validation: the gate is a security boundary — an empty file or
    // mistyped arrays must never coerce to allow:true. Missing/empty file and
    // wrong types are caller bugs → -32602, not silent allow.
    // Clients may send either name: some harnesses rename `file` to `filePath`
    // when they surface the tool. Accept both, still fail closed on empty.
    const candidate = typeof args?.file === "string" && args.file.length > 0 ? args.file : args?.filePath;
    const file = typeof candidate === "string" ? candidate : "";
    if (file.length === 0) {
      throw new Error("Invalid params: file (or its filePath alias) must be a non-empty string");
    }
    if (args?.categories !== undefined && !Array.isArray(args.categories)) {
      throw new Error("Invalid params: categories must be an array of strings");
    }
    if (args?.loaded !== undefined && !Array.isArray(args.loaded)) {
      throw new Error("Invalid params: loaded must be an array of strings");
    }
    if (args?.content !== undefined && typeof args.content !== "string") {
      throw new Error("Invalid params: content must be a string");
    }
    if (typeof args?.content === "string" && args.content.length > MAX_CONTENT_LEN) {
      throw new Error(`Invalid params: content exceeds ${MAX_CONTENT_LEN} characters`);
    }
    if (args?.tool !== undefined && typeof args.tool !== "string") {
      throw new Error("Invalid params: tool must be a string");
    }
    if (args?.prompt !== undefined && typeof args.prompt !== "string") {
      throw new Error("Invalid params: prompt must be a string");
    }
    if (typeof args?.prompt === "string" && args.prompt.length > MAX_PROMPT_LEN) {
      throw new Error(`Invalid params: prompt exceeds ${MAX_PROMPT_LEN} characters`);
    }
    if (args?.session !== undefined && typeof args.session !== "string") {
      throw new Error("Invalid params: session must be a string");
    }
    // Auto-classify when categories is omitted or empty: seed from prompt,
    // fall back to content, then file path. Explicit categories always win.
    let categories = args?.categories ? args.categories.map(String) : [];
    if (categories.length === 0) {
      const seed =
        (typeof args?.prompt === "string" && args.prompt.length > 0 ? args.prompt : "") ||
        (typeof args?.content === "string" && args.content.length > 0 ? args.content : "") ||
        file;
      try {
        categories = classify(spec, seed).categories.map((entry) => entry.id);
      } catch {
        // Fail closed on classify errors: keep empty categories so
        // evaluateGate still runs path/content rules instead of crashing.
        categories = [];
      }
    }
    const index = loadInstalledSkills(spec);
    const result = evaluateGate({
      tool: String(args?.tool ?? "edit"),
      filePath: file,
      content: typeof args?.content === "string" ? args.content : "",
      prompt: typeof args?.prompt === "string" ? args.prompt : "",
      categories,
      loadedSkills: args?.loaded ? args.loaded.map(String) : [],
      installedSkills: index.skills,
      installedIndexAvailable: index.available,
      spec
    });
    // Ledger enforcement parity with the CLI gate (audit P1-D/M1): trace
    // checks, recordEdit/review and the enforcement_log row used to be CLI
    // only. A ledger refusal is merged into the verdict; a DB failure fails
    // closed like the CLI instead of passing the edit silently.
    const session = typeof args?.session === "string" ? args.session : "";
    // Same shape as the CLI's results array: path alongside the GateResult,
    // on the same object so enforceLedgerChecks mutates this verdict in place.
    result.path = file;
    // Parity with the CLI: an empty session no longer skips this block. The
    // sessionless call still enforces unbound tasks (activeTask) and fails
    // closed on DB errors; it simply writes no enforcement_log row.
    let mdb = null;
    try {
      mdb = openDb(resolve(spec.root, spec.config.dbPath));
    } catch {
      mdb = null;
    }
    if (mdb) {
      try {
        const enforced = enforceLedgerChecks(mdb, {
          session,
          tool: String(args?.tool ?? "edit"),
          paths: [file],
          categories,
          results: [result],
          spec,
          gateConfig: spec.config.gate
        });
        if (enforced.reasons.length > 0) {
          result.reasons.push(...enforced.reasons);
          result.allow = false;
        }
        if (enforced.reviewWarning) result.reasons.push(enforced.reviewWarning);
      } finally {
        mdb.close();
      }
    } else {
      result.allow = false;
      result.reasons.push("DB open failed: ledger enforcement unavailable");
    }
    // A gate refusal is a normal verdict, not an execution error.
    return toolResult(result, false);
  }
  if (name === "novahiz_roadmap") {
    const categoryId = args?.category ? String(args.category) : null;
    let category = categoryId ? spec.categories.find((entry) => entry.id === categoryId) : undefined;
    if (!category && typeof args?.query === "string") {
      const primary = classify(spec, args.query).primary;
      category = spec.categories.find((entry) => entry.id === primary);
    }
    return toolResult({ category: category?.id ?? null, roadmap: category?.roadmap ?? null });
  }
  if (name === "novahiz_providers") {
    const enabled = new Set(enabledProviders(spec).map((provider) => provider.id));
    const categoryId = args?.category ? String(args.category) : null;
    let list = spec.providers;
    if (categoryId) {
      list = list.filter((provider) => (provider.categories ?? []).includes(categoryId));
    } else if (typeof args?.query === "string") {
      const ids = new Set(classify(spec, args.query).providers);
      list = list.filter((provider) => ids.has(provider.id));
    }
    return toolResult({
      count: list.length,
      providers: list.map((provider) => ({
        id: provider.id,
        label: provider.label,
        kind: provider.kind,
        transport: provider.transport ?? null,
        purpose: provider.purpose ?? "",
        categories: provider.categories ?? [],
        source: provider.source ?? "",
        enabled: enabled.has(provider.id)
      }))
    });
  }
  if (name === "novahiz_deps") {
    return toolResult({ node: process.version, platform: process.platform, dependencies: checkDependencies(spec) });
  }
  if (name === "novahiz_step") {
    const session = String(args?.session ?? "default");
    const done = args?.done ? String(args.done) : "";
    // WS3: the step id follows the roadmap naming pattern (plan, write,
    // impeccable-critique) — reject anything else before it reaches the database.
    if (done.length > 0 && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(done)) {
      throw new Error(`Invalid params: step id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127} (got "${done}")`);
    }
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      if (done.length > 0) {
        const ts = new Date().toISOString();
        // roadmap_progress.session_id has a foreign key to sessions(id):
        // ensure the session row exists before recording a step, otherwise
        // a first-time session fails with "FOREIGN KEY constraint failed".
        db.prepare(
          "INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)"
        ).run(session, ts);
        db.prepare(
          "INSERT INTO roadmap_progress (session_id, step_id, status, updated_at) VALUES (?, ?, 'done', ?) ON CONFLICT(session_id, step_id) DO UPDATE SET status = 'done', updated_at = excluded.updated_at"
        ).run(session, done, new Date().toISOString());
      }
      const steps = db.prepare("SELECT step_id, status, updated_at FROM roadmap_progress WHERE session_id = ? ORDER BY updated_at").all(session);
      return toolResult({ session, steps });
    } finally {
      db.close();
    }
  }
  if (name === "novahiz_task") {
    const action = String(args?.action ?? "status");
    // M-MCP: validate action before opening DB — avoids opening/closing on invalid input
    const VALID_ACTIONS = ["new", "plan", "todo", "start", "done", "block", "review", "amend", "insert", "drop", "reorder", "signals", "status", "resume", "current"];
    if (!VALID_ACTIONS.includes(action)) {
      throw new Error(`Invalid params: unknown task action '${action}'`);
    }
    const session = args?.session ? String(args.session) : undefined;
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      if (action === "new") {
        // F: projectRoot scopes the new task to a project when the caller knows
        // it; omitted = unscoped legacy task (no path filtering).
        return toolResult(createTask(db, { title: String(args?.title ?? ""), id: args?.id ? String(args.id) : undefined, sessionId: session, projectRoot: args?.projectRoot ? String(args.projectRoot) : undefined }));
      }
      if (action === "plan") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const items = Array.isArray(args?.todos) ? args.todos.map(normalizeTodo) : [];
        return toolResult(addTodos(db, taskId, items));
      }
      if (action === "todo") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const [todo] = addTodos(db, taskId, [normalizeTodo(args)]);
        return toolResult(todo);
      }
      if (action === "start") {
        const id = String(args?.id ?? "");
        const target = getTodo(db, id);
        if (target) {
          const due = reviewDue(db, target.task_id, spec.config.ledger?.review);
          if (due.due) return toolResult({ error: due.reason, task: target.task_id }, true);
        }
        return toolResult(startTodo(db, id));
      }
      if (action === "done") {
        const id = String(args?.id ?? "");
        const target = getTodo(db, id);
        if (!target) return toolResult("no active task", true);
        // H1: completeTodo + recordTodoDone must be atomic. Use a SAVEPOINT
        // so the nested capture inside completeTodo doesn't break the outer
        // transaction boundary.
        db.exec("SAVEPOINT done_sp");
        try {
          const todo = completeTodo(db, id, args?.proof ? String(args.proof) : "");
          recordTodoDone(db, todo.task_id);
          db.exec("RELEASE done_sp");
          // completeTodo's snapshot was refused while the savepoint was open;
          // the transaction is over, record the completed todo now.
          capture(db, "todo-completed", id);
          return toolResult(todo);
        } catch (error) {
          db.exec("ROLLBACK TO done_sp");
          db.exec("RELEASE done_sp");
          throw error;
        }
      }
      if (action === "block") return toolResult(blockTodo(db, String(args?.id ?? ""), args?.reason ? String(args.reason) : ""));
      if (action === "review") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        try {
          // parseReviewDiff accepts an object or a JSON string, keeps only the
          // known keys and drops the rest — raw input is never spread into SQL.
          const diff = parseReviewDiff(args?.changes);
          if (diff.additions) diff.additions = diff.additions.map((item) => normalizeTodo(item));
          return toolResult(reviewTask(db, { taskId, ...diff }));
        } catch (error) {
          return toolResult(`review failed: ${error instanceof Error ? error.message : String(error)}`, true);
        }
      }
      if (action === "amend") {
        const patch = {
          label: args?.label ? String(args.label) : undefined,
          kind: args?.kind ? String(args.kind) : undefined,
          acceptance: args?.acceptance !== undefined ? (args.acceptance === null ? null : String(args.acceptance)) : undefined,
          owner: args?.owner !== undefined ? (args.owner === null ? null : String(args.owner)) : undefined,
          maxIterations: Number.isFinite(args?.maxIterations) ? Number(args.maxIterations) : undefined
        };
        return toolResult(amendTodo(db, String(args?.id ?? ""), patch));
      }
      if (action === "insert") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const raw = args?.position;
        const position = raw === undefined || raw === "" ? "end" : /^\d+$/.test(String(raw)) ? Number(raw) : String(raw);
        return toolResult(insertTodo(db, taskId, normalizeTodo(args), position));
      }
        if (action === "drop") {
          const dropId = String(args?.id ?? "");
          const reason = args?.reason ? String(args.reason) : "";
          if (getTask(db, dropId)) return toolResult({ task: dropTask(db, dropId, reason) });
          if (getTodo(db, dropId)) return toolResult({ todo: dropTodo(db, dropId, reason) });
          throw new Error(`unknown id: ${dropId} (expected a task id or todo id)`);
        }
        if (action === "reorder") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const order = Array.isArray(args?.order) ? args.order.map(String) : [];
        // H-MCP: validate IDs are non-empty strings
        for (const id of order) {
          if (typeof id !== "string" || id.length === 0 || id.length > 128) {
            throw new Error("Invalid params: reorder order contains invalid ID");
          }
        }
        return toolResult(reorderTodos(db, taskId, order));
      }
      if (action === "signals") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        return toolResult(revisionSignals(db, taskId));
      }
      if (action === "status" || action === "resume" || action === "current") {
        const explicit = args?.task ? getTask(db, String(args.task)) : null;
        const state = explicit
          ? (() => {
              const todos = listTodos(db, explicit.id);
              return {
                task: explicit,
                todos,
                current: todos.find((todo) => todo.status === "in_progress") ?? todos.find((todo) => todo.status === "pending") ?? null
              };
            })()
          : resume(db, session);
        const review = state.task ? reviewDue(db, state.task.id) : null;
        const signals = state.task ? revisionSignals(db, state.task.id) : [];
        return toolResult({ task: state.task, current: state.current, todos: state.todos, summary: ledgerSummary(state), review, signals });
      }
    } finally {
      db.close();
    }
  }
  if (name === "novahiz_dispatch") {
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      const taskId = args?.task ? String(args.task) : activeTask(db, args?.session ? String(args.session) : undefined)?.id;
      if (!taskId) return toolResult("no active task", true);
      const packets = buildWorkPackets(db, taskId);
      const byFile = new Map();
      for (const packet of packets) {
        for (const file of packet.files) {
          if (!byFile.has(file)) byFile.set(file, []);
          byFile.get(file).push(packet.todo);
        }
      }
      const conflicts = [...byFile.entries()]
        .filter(([, todos]) => todos.length > 1)
        .map(([file, todos]) => ({ file, todos }));
      return toolResult({ task: taskId, packets, conflicts });
    } finally {
      db.close();
    }
  }
  if (name === "memory_write") {
    if (args?.content !== undefined && typeof args.content === "string" && args.content.length > MAX_CONTENT_LEN) {
      throw new Error(`Invalid params: content exceeds ${MAX_CONTENT_LEN} characters`);
    }
    const input = parseSlotInput(args ?? {});
    if (typeof input.root === "string" && input.root.length > 0) {
      input.root = safeMemoryRoot(input.root);
    }
    const result = writeEntry(input);
    return toolResult({
      slot: result.slot,
      rotated: result.rotated,
      compacted: result.compacted,
      created: result.created,
      confidence: result.confidence,
      duplicate: result.duplicate === true,
      healed: result.index.healed === true,
      limits: { limit_chars: DEFAULT_LIMIT_CHARS, limit_lines: DEFAULT_LIMIT_LINES },
      indexUpdated: result.index.updated
    });
  }
  if (name === "memory_update") {
    const id = String(args?.id ?? "");
    if (id.length === 0) throw new Error("Invalid params: id must be a non-empty string");
    const mode = String(args?.mode ?? "");
    if (mode !== "replace" && mode !== "append" && mode !== "summary") {
      throw new Error("Invalid params: mode must be one of replace|append|summary");
    }
    const root = safeMemoryRoot(args?.root);
    const result = updateSlot({
      id,
      root,
      mode,
      content: typeof args?.content === "string" ? args.content : undefined,
      summary: typeof args?.summary === "string" ? args.summary : undefined
    });
    return toolResult({
      slot: result.slot,
      mode: result.mode,
      updated: true,
      compacted: result.compacted,
      healed: result.index.healed === true
    });
  }
  if (name === "memory_archive") {
    const id = String(args?.id ?? "");
    if (id.length === 0) throw new Error("Invalid params: id must be a non-empty string");
    const root = safeMemoryRoot(args?.root);
    const result = archiveSlot(id, root);
    return toolResult({
      slot: result.slot,
      archived: true,
      changed: result.changed,
      healed: result.index.healed === true
    });
  }
  if (name === "memory_list") {
    const root = safeMemoryRoot(args?.root);
    const index = listSlots(root);
    const status = args?.status === "active" || args?.status === "archived" ? args.status : "all";
    const tagFilter =
      typeof args?.tag === "string" && args.tag.trim().length > 0 ? args.tag.trim() : null;
    const limit = Number.isFinite(args?.limit) && args.limit > 0 ? Math.trunc(args.limit) : 0;
    const preview = args?.preview === true;
    let matched = index.slots;
    if (status !== "all") matched = matched.filter((slot) => slot.status === status);
    if (tagFilter !== null) {
      const wanted = tagFilter.toLowerCase();
      matched = matched.filter((slot) => slot.tags.some((value) => value.toLowerCase() === wanted));
    }
    const total = matched.length;
    if (limit > 0) matched = matched.slice(0, limit);
    const slots = preview
      ? matched.map((slot) => {
          let summary = "";
          try {
            summary = getSlot(slot.id, root).body.summary;
          } catch {
            // Slot sans fichier lisible: preview vide — l'erreur bruyante
            // reste accessible via memory_get sur le meme id.
          }
          return { ...slot, preview: summary.length > 160 ? `${summary.slice(0, 157)}...` : summary };
        })
      : matched;
    return toolResult({
      root,
      count: slots.length,
      total,
      active: index.slots.filter((slot) => slot.status === "active").length,
      archived: index.slots.filter((slot) => slot.status === "archived").length,
      healed: index.healed === true,
      filter: { status, tag: tagFilter, limit: limit > 0 ? limit : null, preview },
      slots
    });
  }
  if (name === "memory_get") {
    const id = String(args?.id ?? "");
    if (id.length === 0) throw new Error("Invalid params: id must be a non-empty string");
    const root = safeMemoryRoot(args?.root);
    const section =
      args?.section === undefined || args?.section === null ? "full" : String(args.section);
    if (section !== "full" && section !== "meta" && section !== "summary") {
      throw new Error("Invalid params: section must be one of full|meta|summary");
    }
    const file = getSlot(id, root);
    if (section === "meta") return toolResult({ meta: file.meta });
    if (section === "summary") return toolResult({ meta: file.meta, summary: file.body.summary });
    return toolResult(file);
  }
  if (name === "memory_search") {
    const query = typeof args?.query === "string" ? args.query : "";
    if (query.trim().length === 0) {
      throw new Error("Invalid params: query must be a non-empty string");
    }
    const root = safeMemoryRoot(args?.root);
    const limit = Number.isFinite(args?.limit)
      ? Math.min(Math.max(1, Math.trunc(args.limit)), 20)
      : 5;
    const result = searchSlots(root, query, {
      limit,
      includeArchived: args?.includeArchived === true
    });
    return toolResult({
      root: result.root,
      query: result.query,
      searched: result.searched,
      count: result.hits.length,
      results: result.hits.map((hit) => ({
        id: hit.meta.id,
        title: hit.meta.title,
        status: hit.meta.status,
        tags: hit.meta.tags,
        file: hit.meta.file,
        score: hit.score,
        confidence: hit.confidence,
        matched: hit.matched,
        snippet: hit.snippet
      }))
    });
  }
  if (name === "memory_init") {
    const root = safeMemoryRoot(args?.root);
    const index = ensureMemoryRoot(root);
    return toolResult({
      root,
      created: true,
      healed: index.healed === true,
      slots: index.slots.length,
      indexUpdated: index.updated
    });
  }
  if (name === "memory_rebuild") {
    const root = safeMemoryRoot(args?.root);
    const index = rebuildIndex(root);
    return toolResult({ root, count: index.slots.length, indexUpdated: index.updated });
  }
  if (name === "snap_log") {
    const wanted = typeof args?.id === "string" && args.id.trim().length > 0 ? args.id.trim() : null;
    if (wanted) {
      const manifest = loadManifest(resolveSnapId(wanted));
      if (!manifest) throw new Error(`Invalid params: manifeste illisible: ${wanted}`);
      return toolResult(manifest);
    }
    // M-MCP: bounded like the other list tools — a log listing must not
    // serialize the whole store at once.
    const limit = Number.isFinite(args?.limit) ? Math.min(Math.max(1, Math.trunc(args.limit)), 50) : 20;
    const items = listSnapshots(limit);
    const status = snapStatus();
    return toolResult({
      count: status.count,
      retention: status.retention,
      returned: items.length,
      snapshots: items.map((manifest) => ({
        id: manifest.id,
        parent: manifest.parent,
        createdAt: manifest.createdAt,
        operation: manifest.operation,
        detail: manifest.detail,
        sourceBytes: manifest.sourceBytes,
        objectBytes: manifest.objectBytes
      }))
    });
  }
  if (name === "snap_status") {
    return toolResult(snapStatus());
  }
  if (name === "snap_diff") {
    if (typeof args?.from !== "string" || args.from.trim().length === 0) {
      throw new Error("Invalid params: from must be a snapshot id or prefix");
    }
    const from = resolveSnapId(args.from);
    const rawTo = typeof args?.to === "string" && args.to.trim().length > 0 ? args.to.trim() : "current";
    const to = rawTo === "current" ? null : resolveSnapId(rawTo);
    const diff = diffSnapshots(from, to, to === null ? resolve(spec.root, spec.config.dbPath) : undefined);
    return toolResult(diff);
  }
  if (name === "snap_restore") {
    if (typeof args?.id !== "string" || args.id.trim().length === 0) {
      throw new Error("Invalid params: id must be a snapshot id or prefix");
    }
    const id = resolveSnapId(args.id);
    if (args.force !== true) {
      // Safety guard: restore rewrites every row, so it takes an explicit
      // `force: true`. A truthy string or a missing field is not consent.
      return toolResult(
        {
          success: false,
          refused: true,
          id,
          message: "restore refusé sans force:true ; une copie de sauvegarde sera écrite d'abord, puis relancez avec force:true"
        },
        true
      );
    }
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      const result = restoreSnapshot(db, id, { force: true });
      if (!result.success) return toolResult(result, true);
      // Every ledger write leaves a restore point — including this one, so a
      // restore can itself be undone.
      const snapshot = capture(db, "restored", id);
      return toolResult({ ...result, snapshot: snapshot ? snapshot.id : null });
    } finally {
      db.close();
    }
  }
  throw new Error(`Unknown tool: ${name}`);
}

function handle(message) {
  const id = message?.id;
  const method = message?.method;
  const params = message?.params ?? {};
  const hasId = id !== undefined && id !== null;
  if (!hasId) return null;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: negotiateProtocol(params.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      }
    };
  }
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    try {
      return { jsonrpc: "2.0", id, result: callTool(params.name, params.arguments ?? {}) };
    } catch (error) {
      // Printable ASCII only: strips control chars and non-Latin scripts that
      // could smuggle terminal escapes. Also strip Windows paths (C:\...) to
      // avoid leaking filesystem structure in error messages.
      const raw = String(error?.message ?? error);
      const msg = raw.replace(/[^\x20-\x7E]/g, "").replace(/[A-Z]:\\[^\s]*/g, "[path]").slice(0, 300);
      // Protocol violations use JSON-RPC error codes, not isError results:
      // -32601 unknown tool, -32602 invalid params. Only execution failures
      // surface as isError tool results.
      if (raw.startsWith("Unknown tool:")) {
        return { jsonrpc: "2.0", id, error: { code: -32601, message: msg } };
      }
      if (raw.startsWith("Invalid params:")) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: msg } };
      }
      return { jsonrpc: "2.0", id, result: toolResult(`internal error: ${msg}`, true) };
    }
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();
if (isMain) {
  // S-AUTO: mode one-shot pour le plugin opencode — `index.mjs --call <tool>`
  // lit les arguments JSON sur stdin (jamais sur argv: limite 32k sous
  // Windows et la liste des processus est visible), route par le meme
  // handle() que le transport stdio, imprime la reponse JSON-RPC sur stdout
  // puis sort. 0 = resultat valide, 1 = erreur de protocole ou isError.
  if (process.argv[2] === "--call") {
    const name = String(process.argv[3] ?? "");
    let args = {};
    let parseError = null;
    try {
      const raw = process.stdin.isTTY ? "" : readFileSync(0, "utf8").trim();
      if (raw.length > 0) args = JSON.parse(raw);
    } catch (error) {
      parseError = String(error?.message ?? error);
    }
    const response = parseError
      ? { jsonrpc: "2.0", id: 1, error: { code: -32700, message: `Parse error: ${parseError}` } }
      : handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    const ok = Boolean(response?.result) && response.result.isError !== true;
    process.exit(ok ? 0 : 1);
  }
  const reader = createInterface({ input: process.stdin });
  // If the parent (opencode) dies or closes the pipe, stdout.write throws —
  // exit gracefully instead of crashing with an unhandled exception.
  const safeWrite = (text) => {
    try {
      process.stdout.write(text);
    } catch (err) {
      if (err?.code === "EPIPE") process.exit(0);
      throw err;
    }
  };
  reader.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      safeWrite(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      return;
    }
    const response = handle(message);
    if (response) safeWrite(`${JSON.stringify(response)}\n`);
  });
  reader.on("close", () => process.exit(0));
}
