#!/usr/bin/env node
/**
 * openapi-mcp-server: lint an OpenAPI document for MCP conversion readiness.
 * Offline structural checks. Not a full OpenAPI validator.
 *
 * Usage: node scripts/openapi_mcp_lint.mjs <openapi.yaml|json> [...]
 * Exit 1 if any HIGH finding.
 */

import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";

function loadDoc(path) {
  const text = readFileSync(path, "utf8");
  const ext = extname(path).toLowerCase();
  if (ext === ".json") return JSON.parse(text);
  // Minimal YAML: try JSON first (some exports are JSON with .yaml name is wrong);
  // for real YAML without a parser dependency, only handle JSON-compatible subset.
  try {
    return JSON.parse(text);
  } catch {
    return { __yaml: true, __raw: text };
  }
}

function walkOps(doc) {
  const out = [];
  const paths = doc.paths || {};
  const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
  for (const [p, item] of Object.entries(paths)) {
    if (!item || typeof item !== "object") continue;
    for (const [m, op] of Object.entries(item)) {
      if (!methods.has(m)) continue;
      if (!op || typeof op !== "object") continue;
      out.push({ path: p, method: m, op });
    }
  }
  return out;
}

function lint(path) {
  const findings = [];
  const push = (level, id, msg) => findings.push({ level, id, file: path, msg });

  if (!existsSync(path)) {
    push("HIGH", "missing-file", "File not found");
    return findings;
  }

  let doc;
  try {
    doc = loadDoc(path);
  } catch (e) {
    push("HIGH", "parse-error", `Cannot parse: ${e.message}`);
    return findings;
  }

  if (doc.__yaml) {
    push("MED", "yaml-needs-external-validator", "YAML detected; run a full OpenAPI validator (swagger-cli / redocly) as well");
    return findings;
  }

  if (!doc.openapi && !doc.swagger) {
    push("HIGH", "not-openapi", "Missing openapi/swagger version field");
  }

  const servers = doc.servers || (doc.host ? [{ url: `https://${doc.host}${doc.basePath || ""}` }] : []);
  if (!servers.length) {
    push("HIGH", "no-servers", "No servers/base URL; absolute base required for MCP handlers");
  } else if (servers.some((s) => !s.url || s.url.startsWith("/"))) {
    push("MED", "relative-server", "Server URL is relative; prefer absolute https URL");
  }

  const ops = walkOps(doc);
  if (ops.length === 0) {
    push("HIGH", "no-operations", "No path operations found");
  }

  const ids = new Map();
  for (const { path: p, method, op } of ops) {
    const loc = `${method.toUpperCase()} ${p}`;
    if (!op.operationId) {
      push("MED", "missing-operationId", `${loc}: missing operationId`);
    } else {
      if (ids.has(op.operationId)) {
        push("HIGH", "duplicate-operationId", `${loc}: duplicate operationId ${op.operationId}`);
      } else {
        ids.set(op.operationId, loc);
      }
    }
    if (!op.summary && !op.description) {
      push("MED", "missing-description", `${loc}: no summary/description for tool text`);
    }
    // path params declared?
    const pathParams = (p.match(/\{[^}]+\}/g) || []).map((s) => s.slice(1, -1));
    const opParams = (op.parameters || []).filter((x) => x && x.in === "path");
    for (const pp of pathParams) {
      if (!opParams.some((x) => x.name === pp)) {
        push("HIGH", "undefined-path-param", `${loc}: path {${pp}} not in parameters`);
      }
    }
  }

  const hasSecurity =
    Object.keys(doc.components?.securitySchemes || {}).length > 0 ||
    Array.isArray(doc.security) ||
    ops.some((o) => o.op.security);
  if (!hasSecurity) {
    push("LOW", "no-security-schemes", "No security schemes declared; document how host auth works");
  }

  return findings;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/openapi_mcp_lint.mjs <openapi.yaml|json> [...]");
  process.exit(2);
}

const all = files.flatMap(lint);
const byLevel = { HIGH: [], MED: [], LOW: [] };
for (const f of all) byLevel[f.level].push(f);

for (const level of ["HIGH", "MED", "LOW"]) {
  for (const f of byLevel[level]) {
    console.log(`${level}\t${f.id}\t${f.file}\t${f.msg}`);
  }
}

const high = byLevel.HIGH.length;
console.error(`openapi_mcp_lint: ${files.length} files, ${all.length} findings (${high} HIGH)`);
process.exit(high > 0 ? 1 : 0);
