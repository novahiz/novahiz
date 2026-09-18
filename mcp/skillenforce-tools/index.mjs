#!/usr/bin/env node
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { realpathSync } from "node:fs";
import { classify } from "../../src/classify.ts";
import { evaluateGate } from "../../src/gate.ts";
import { loadSpec } from "../../src/spec.ts";
import { loadCatalog, loadInstalledSkills } from "../../src/catalog.ts";
import { rankSkills } from "../../src/relevance.ts";
import { openDb } from "../../src/db.ts";
import { enabledProviders } from "../../src/providers.ts";
import { checkDependencies } from "../../src/deps.ts";
import { activeTask, addTodos, amendTodo, blockTodo, buildWorkPackets, completeTodo, createTask, dropTodo, getTask, getTodo, insertTodo, ledgerSummary, listTodos, recordTodoDone, reorderTodos, resume, reviewDue, reviewTask, revisionSignals, startTodo } from "../../src/ledger.ts";

const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-06-18"];
const DEFAULT_PROTOCOL = "2024-11-05";
const SERVER_INFO = { name: "skillenforce-tools", version: "0.1.0" };

const TOOLS = [
  {
    name: "skillenforce_classify",
    description: "Classify a prompt into Skillenforce categories and return the skills those categories require.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string", description: "The user prompt to classify." } },
      required: ["prompt"]
    }
  },
  {
    name: "skillenforce_list_skills",
    description: "List installed and catalogued skills, optionally filtered by category.",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string", description: "Optional category id." } }
    }
  },
  {
    name: "skillenforce_catalog",
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
    name: "skillenforce_gate",
    description: "Check whether a file edit satisfies the Skillenforce rules. Returns allow, required skills and missing skills.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Target file path." },
        tool: { type: "string", description: "edit, write or patch." },
        content: { type: "string", description: "The edited content, used for content-aware rules." },
        categories: { type: "array", items: { type: "string" } },
        loaded: { type: "array", items: { type: "string" } }
      },
      required: ["file"]
    }
  },
  {
    name: "skillenforce_roadmap",
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
    name: "skillenforce_providers",
    description: "List the MCP providers registered in Skillenforce, optionally for a category or a prompt.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category id." },
        query: { type: "string", description: "A prompt to classify." }
      }
    }
  },
  {
    name: "skillenforce_deps",
    description: "Check that every provider prerequisite (npx, uv) is available on the machine.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "skillenforce_step",
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
    name: "skillenforce_task",
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
        id: { type: "string", description: "Task id (new) or todo id (start, done, block)." },
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
    name: "skillenforce_dispatch",
    description: "Turn the active task's pending todos into work packets for subagents, each with an objective, owned files, exit criteria and budget. Reports file-ownership conflicts.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task id. Defaults to the active task." },
        session: { type: "string", description: "Session id used to scope the active task." }
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
  if (typeof name !== "string" || name.length === 0) {
    return toolResult("Invalid tool name: expected a non-empty string", true);
  }
  if (args !== null && args !== undefined && typeof args !== "object") {
    return toolResult("Invalid arguments: expected an object", true);
  }
  const spec = loadSpec();
  if (name === "skillenforce_classify") {
    const prompt = String(args?.prompt ?? "");
    return toolResult({ prompt, ...classify(spec, prompt) });
  }
  if (name === "skillenforce_list_skills") {
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
  if (name === "skillenforce_catalog") {
    const query = String(args?.query ?? "");
    const limit = Number.isFinite(args?.limit) ? Number(args.limit) : 10;
    const catalog = loadCatalog(spec);
    return toolResult({ query, total: catalog.length, results: rankSkills(catalog, query, limit) });
  }
  if (name === "skillenforce_gate") {
    if (spec.config.gate.enabled === false) return toolResult({ allow: true, disabled: true });
    const escapeValue = (process.env[spec.config.gate.envEscape || "SKILLEFORCE_GATE"] || "").toLowerCase();
    if (["off", "0", "false", "no", "disabled"].includes(escapeValue)) {
      return toolResult({ allow: true, disabled: true });
    }
    const index = loadInstalledSkills(spec);
    const result = evaluateGate({
      tool: String(args?.tool ?? "edit"),
      filePath: String(args?.file ?? ""),
      content: typeof args?.content === "string" ? args.content : "",
      categories: Array.isArray(args?.categories) ? args.categories.map(String) : [],
      loadedSkills: Array.isArray(args?.loaded) ? args.loaded.map(String) : [],
      installedSkills: index.skills,
      installedIndexAvailable: index.available,
      spec
    });
    return toolResult(result, !result.allow);
  }
  if (name === "skillenforce_roadmap") {
    const categoryId = args?.category ? String(args.category) : null;
    let category = categoryId ? spec.categories.find((entry) => entry.id === categoryId) : undefined;
    if (!category && typeof args?.query === "string") {
      const primary = classify(spec, args.query).primary;
      category = spec.categories.find((entry) => entry.id === primary);
    }
    return toolResult({ category: category?.id ?? null, roadmap: category?.roadmap ?? null });
  }
  if (name === "skillenforce_providers") {
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
  if (name === "skillenforce_deps") {
    return toolResult({ node: process.version, platform: process.platform, dependencies: checkDependencies(spec) });
  }
  if (name === "skillenforce_step") {
    const session = String(args?.session ?? "default");
    const done = args?.done ? String(args.done) : "";
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    if (done.length > 0) {
      db.prepare(
        "INSERT INTO roadmap_progress (session_id, step_id, status, updated_at) VALUES (?, ?, 'done', ?) ON CONFLICT(session_id, step_id) DO UPDATE SET status = 'done', updated_at = excluded.updated_at"
      ).run(session, done, new Date().toISOString());
    }
    const steps = db.prepare("SELECT step_id, status, updated_at FROM roadmap_progress WHERE session_id = ? ORDER BY updated_at").all(session);
    db.close();
    return toolResult({ session, steps });
  }
  if (name === "skillenforce_task") {
    const action = String(args?.action ?? "status");
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
          const due = reviewDue(db, target.task_id);
          if (due.due) return toolResult({ error: due.reason, task: target.task_id }, true);
        }
        return toolResult(startTodo(db, id));
      }
      if (action === "done") {
        const todo = completeTodo(db, String(args?.id ?? ""), args?.proof ? String(args.proof) : "");
        recordTodoDone(db, todo.task_id);
        return toolResult(todo);
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
      if (action === "drop") return toolResult(dropTodo(db, String(args?.id ?? ""), args?.reason ? String(args.reason) : ""));
      if (action === "reorder") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const order = Array.isArray(args?.order) ? args.order.map(String) : [];
        return toolResult(reorderTodos(db, taskId, order));
      }
      if (action === "signals") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        return toolResult(revisionSignals(db, taskId));
      }
      const explicit = args?.task ? getTask(db, String(args.task)) : null;
      const state = explicit
        ? {
            task: explicit,
            todos: listTodos(db, explicit.id),
            current: listTodos(db, explicit.id).find((todo) => todo.status === "in_progress") ?? listTodos(db, explicit.id).find((todo) => todo.status === "pending") ?? null
          }
        : resume(db, session);
      const review = state.task ? reviewDue(db, state.task.id) : null;
      const signals = state.task ? revisionSignals(db, state.task.id) : [];
      return toolResult({ task: state.task, current: state.current, todos: state.todos, summary: ledgerSummary(state), review, signals });
    } finally {
      db.close();
    }
  }
  if (name === "skillenforce_dispatch") {
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
  return toolResult(`Unknown tool: ${name}`, true);
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
      const msg = String(error?.message ?? error).replace(/[^a-zA-Z0-9 .:,\-_()/]/g, "").slice(0, 200);
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
  reader.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      return;
    }
    const response = handle(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
