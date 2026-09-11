#!/usr/bin/env node
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { classify } from "../../src/classify.ts";
import { evaluateGate } from "../../src/gate.ts";
import { loadSpec } from "../../src/spec.ts";
import { loadCatalog, loadInstalledSkills } from "../../src/catalog.ts";
import { rankSkills } from "../../src/relevance.ts";
import { openDb } from "../../src/db.ts";

const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-06-18"];
const DEFAULT_PROTOCOL = "2024-11-05";
const SERVER_INFO = { name: "novahiz-tools", version: "0.1.0" };

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
        tool: { type: "string", description: "edit, write or patch." },
        content: { type: "string", description: "The edited content, used for content-aware rules." },
        categories: { type: "array", items: { type: "string" } },
        loaded: { type: "array", items: { type: "string" } }
      },
      required: ["file"]
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
    name: "novahiz_step",
    description: "Record or list roadmap step progress for a session.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        done: { type: "string", description: "Step id to mark done." }
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

function callTool(name, args) {
  const spec = loadSpec();
  if (name === "novahiz_classify") {
    const prompt = String(args?.prompt ?? "");
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
    const limit = Number.isFinite(args?.limit) ? Number(args.limit) : 10;
    const catalog = loadCatalog(spec);
    return toolResult({ query, total: catalog.length, results: rankSkills(catalog, query, limit) });
  }
  if (name === "novahiz_gate") {
    const escapeValue = (process.env[spec.config.gate.envEscape || "NOVAHIZ_GATE"] || "").toLowerCase();
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
  if (name === "novahiz_roadmap") {
    const categoryId = args?.category ? String(args.category) : null;
    let category = categoryId ? spec.categories.find((entry) => entry.id === categoryId) : undefined;
    if (!category && typeof args?.query === "string") {
      const primary = classify(spec, args.query).primary;
      category = spec.categories.find((entry) => entry.id === primary);
    }
    return toolResult({ category: category?.id ?? null, roadmap: category?.roadmap ?? null });
  }
  if (name === "novahiz_step") {
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
      return { jsonrpc: "2.0", id, result: toolResult(String(error?.message ?? error), true) };
    }
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

export function handleLine(line) {
  return handle(line);
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
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
