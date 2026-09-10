#!/usr/bin/env node
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { classify } from "../../src/classify.ts";
import { evaluateGate } from "../../src/gate.ts";
import { loadSpec } from "../../src/spec.ts";
import { loadCatalog, loadInstalledSkills } from "../../src/catalog.ts";
import { rankSkills } from "../../src/relevance.ts";

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
        categories: { type: "array", items: { type: "string" } },
        loaded: { type: "array", items: { type: "string" } }
      },
      required: ["file"]
    }
  }
];

export function negotiateProtocol(requested) {
  return SUPPORTED_PROTOCOLS.includes(requested) ? requested : DEFAULT_PROTOCOL;
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
    return toolResult({ count: entries.length, skills: entries });
  }
  if (name === "novahiz_catalog") {
    const query = String(args?.query ?? "");
    const limit = Number.isFinite(args?.limit) ? Number(args.limit) : 10;
    const catalog = loadCatalog(spec);
    return toolResult({ query, total: catalog.length, results: rankSkills(catalog, query, limit) });
  }
  if (name === "novahiz_gate") {
    const index = loadInstalledSkills(spec);
    const result = evaluateGate({
      tool: String(args?.tool ?? "edit"),
      filePath: String(args?.file ?? ""),
      categories: Array.isArray(args?.categories) ? args.categories.map(String) : [],
      loadedSkills: Array.isArray(args?.loaded) ? args.loaded.map(String) : [],
      installedSkills: index.skills,
      installedIndexAvailable: index.available,
      spec
    });
    return toolResult(result, !result.allow);
  }
  return toolResult(`Unknown tool: ${name}`, true);
}

function handle(message) {
  const id = message?.id;
  const method = message?.method;
  const params = message?.params ?? {};
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
      return { jsonrpc: "2.0", id, result: toolResult(String(error?.stack ?? error), true) };
    }
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (id === undefined || id === null) return null;
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
