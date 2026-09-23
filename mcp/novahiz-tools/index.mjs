#!/usr/bin/env node
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { classify } from "../../src/classify.ts";
import { evaluateGate } from "../../src/gate.ts";
import { loadSpec } from "../../src/spec.ts";
import { loadCatalog, loadInstalledSkills } from "../../src/catalog.ts";
import { rankSkills } from "../../src/relevance.ts";
import { openDb } from "../../src/db.ts";
import { enabledProviders } from "../../src/providers.ts";
import { checkDependencies } from "../../src/deps.ts";
import { activeTask, addTodos, amendTodo, blockTodo, buildWorkPackets, completeTodo, createTask, dropTask, dropTodo, getTask, getTodo, insertTodo, ledgerSummary, listTodos, recordTodoDone, reorderTodos, resume, reviewDue, reviewTask, revisionSignals, startTodo } from "../../src/ledger.ts";
import { DEFAULT_LIMIT_CHARS, DEFAULT_LIMIT_LINES, ensureMemoryRoot, getSlot, listSlots, memoryRoot, parseSlotInput, rebuildIndex, writeEntry } from "../../src/memory.ts";

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
    name: "memory_list",
    description: "List project-memory slots from index.json (active and archived).",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Project root containing project-memory (default cwd)." }
      }
    }
  },
  {
    name: "memory_get",
    description: "Read one project-memory slot (frontmatter, Résumé, Détails).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Slot id, e.g. slot-001." },
        root: { type: "string", description: "Project root containing project-memory (default cwd)." }
      },
      required: ["id"]
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
    if (spec.config.gate.enabled === false) return toolResult({ allow: true, disabled: true });
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
      categories,
      loadedSkills: args?.loaded ? args.loaded.map(String) : [],
      installedSkills: index.skills,
      installedIndexAvailable: index.available,
      spec
    });
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
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      if (done.length > 0) {
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
        return toolResult(createTask(db, { title: String(args?.title ?? ""), id: args?.id ? String(args.id) : undefined, sessionId: session }));
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
        // so the nested autoCommit inside completeTodo doesn't break the outer
        // transaction boundary.
        db.exec("SAVEPOINT done_sp");
        try {
          const todo = completeTodo(db, id, args?.proof ? String(args.proof) : "");
          recordTodoDone(db, todo.task_id);
          db.exec("RELEASE done_sp");
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
        const diff = args?.changes && typeof args.changes === "object" ? args.changes : {};
        return toolResult(reviewTask(db, { taskId, ...diff }));
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
    const result = writeEntry(input);
    return toolResult({
      slot: result.slot,
      rotated: result.rotated,
      compacted: result.compacted,
      created: result.created,
      limits: { limit_chars: DEFAULT_LIMIT_CHARS, limit_lines: DEFAULT_LIMIT_LINES },
      indexUpdated: result.index.updated
    });
  }
  if (name === "memory_list") {
    const root = typeof args?.root === "string" && args.root.length > 0 ? args.root : memoryRoot();
    const index = listSlots(root);
    return toolResult({
      root,
      count: index.slots.length,
      active: index.slots.filter((slot) => slot.status === "active").length,
      archived: index.slots.filter((slot) => slot.status === "archived").length,
      slots: index.slots
    });
  }
  if (name === "memory_get") {
    const id = String(args?.id ?? "");
    if (id.length === 0) throw new Error("Invalid params: id must be a non-empty string");
    const root = typeof args?.root === "string" && args.root.length > 0 ? args.root : memoryRoot();
    return toolResult(getSlot(id, root));
  }
  if (name === "memory_init") {
    const root = typeof args?.root === "string" && args.root.length > 0 ? args.root : memoryRoot();
    const index = ensureMemoryRoot(root);
    return toolResult({ root, created: true, slots: index.slots.length, indexUpdated: index.updated });
  }
  if (name === "memory_rebuild") {
    const root = typeof args?.root === "string" && args.root.length > 0 ? args.root : memoryRoot();
    const index = rebuildIndex(root);
    return toolResult({ root, count: index.slots.length, indexUpdated: index.updated });
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
