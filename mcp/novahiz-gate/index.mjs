#!/usr/bin/env node
// mcp/novahiz-gate/index.mjs — serveur MCP stdio dedie a l'outil novahiz_gate.
//
// Le gate a ete extrait de mcp/novahiz-tools/index.mjs pour vivre comme
// serveur distinct (novahiz-gate), au meme titre que novahiz-docs. Meme
// transport (JSON-RPC delimite par sauts de ligne sur stdio), zero dependance
// npm, et surtout meme coeur src/gate.ts que la CLI : les verdicts MCP et CLI
// ne peuvent pas diverger.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync, realpathSync } from "node:fs";
import { classify } from "../../src/classify.ts";
import { enforceLedgerChecks, evaluateGate } from "../../src/gate.ts";
import { loadSpec } from "../../src/spec.ts";
import { loadInstalledSkills } from "../../src/catalog.ts";
import { openDb } from "../../src/db.ts";

const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-06-18"];
let SERVER_VERSION = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  SERVER_VERSION = pkg.version ?? "0.0.0";
} catch {
  // keep default
}
const SERVER_INFO = { name: "novahiz-gate", version: SERVER_VERSION };

const TOOLS = [
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
  }
];

function negotiateProtocol(requested) {
  if (SUPPORTED_PROTOCOLS.includes(requested)) return requested;
  return SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1];
}

function toolResult(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError };
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
  if (name === "novahiz_gate") {
    // C2: a project-writable config must not silently switch enforcement off
    // from MCP either. The only kill-switch is NOVAHIZ_GATE=off.
    if (spec.config.gate.enabled === false) {
      process.stderr.write(
        'novahiz: gate.enabled=false in novahiz.config.json is ignored; enforcement stays active. Use NOVAHIZ_GATE=off to disable the gate.\n'
      );
    }
    // C5: envEscape is hardcoded to "NOVAHIZ_GATE" (the primary env var).
    // The only way to override is through the canonical NOVAHIZ_GATE var.
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
    const tool = String(args?.tool ?? "edit").toLowerCase();
    const session = typeof args?.session === "string" ? args.session : "";
    // Union, not fallback (audit P1-M): skills recorded in the DB stay visible
    // when the caller's loaded list is partial (subagent session, hot reload),
    // exactly like the CLI gate (src/commands/gate.ts). A session that cannot
    // read its own DB fails closed — never a silent unscoped verdict.
    let loaded = args?.loaded ? args.loaded.map(String) : [];
    let mdb = null;
    try {
      mdb = openDb(resolve(spec.root, spec.config.dbPath));
    } catch {
      mdb = null;
    }
    if (session.length > 0 && !mdb) {
      return toolResult(
        { allow: false, error: "session DB error", tool, missingSkills: [], reasons: ["session DB open failed"] },
        false
      );
    }
    if (session.length > 0 && mdb) {
      try {
        const rows = mdb.prepare("SELECT skill FROM skill_invocations WHERE session_id = ?").all(session);
        const merged = new Set(loaded);
        for (const row of rows) merged.add(String(row.skill));
        loaded = [...merged];
      } catch {
        return toolResult(
          { allow: false, error: "session DB error", tool, missingSkills: [], reasons: ["session DB read failed"] },
          false
        );
      }
    }
    const result = evaluateGate({
      tool,
      filePath: file,
      content: typeof args?.content === "string" ? args.content : "",
      prompt: typeof args?.prompt === "string" ? args.prompt : "",
      categories,
      loadedSkills: loaded,
      installedSkills: index.skills,
      installedIndexAvailable: index.available,
      spec
    });
    // Ledger enforcement parity with the CLI gate (audit P1-D/M1): trace
    // checks, recordEdit/review and the enforcement_log row. Reasons ride on
    // the verdict; allow stays owned by evaluateGate + the mode below, like
    // the CLI (no forced allow:false on reasons alone).
    result.path = file;
    const warnings = [];
    if (mdb) {
      try {
        const enforced = enforceLedgerChecks(mdb, {
          session,
          tool,
          paths: [file],
          categories,
          results: [result],
          spec,
          gateConfig: spec.config.gate
        });
        if (enforced.reasons.length > 0) result.reasons.push(...enforced.reasons);
        if (enforced.reviewWarning) result.reasons.push(enforced.reviewWarning);
      } finally {
        mdb.close();
      }
    } else if (spec.config.gate.mode === "block") {
      // Fail closed only in block mode, like the CLI (MINEUR#7).
      result.allow = false;
      result.reasons.push("DB open failed: ledger enforcement unavailable");
    } else {
      warnings.push(`enforcement trace unavailable (DB open failed): continuing without ledger checks in ${spec.config.gate.mode} mode.`);
    }
    // Mode parity with the CLI: warn/audit report the refusal instead of
    // blocking it (allow:true + wouldBlock instead of a silent block).
    const blocked = !result.allow;
    const enforcedMode = spec.config.gate.mode === "block";
    if (blocked && !enforcedMode) {
      result.wouldBlock = true;
      result.allow = true;
    }
    result.mode = spec.config.gate.mode;
    if (warnings.length > 0) result.warnings = warnings;
    // A gate refusal is a normal verdict, not an execution error.
    return toolResult(result, false);
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
  // S-AUTO: mode one-shot — `index.mjs --call <tool>` lit les arguments JSON
  // sur stdin (jamais sur argv: limite 32k sous Windows), route par le meme
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
  // If the parent dies or closes the pipe, stdout.write throws — exit
  // gracefully instead of crashing with an unhandled exception.
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
