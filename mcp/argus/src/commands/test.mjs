#!/usr/bin/env node
// End-to-end test: spawns the real server, pipes a JSON-RPC session over
// stdio and asserts every response. Exit code 0 = all checks pass.
// Run with: npm test  (or: node src/commands/test.mjs)

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const cliPath = path.join(root, "src", "cli.mjs");
const testDir = path.join(root, "src", "test");

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function startServer() {
  const child = spawn(process.execPath, [cliPath], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: root
  });
  child.stderr.on("data", () => {
    /* collected only for diagnostics */
  });

  const lines = [];
  let buffer = "";
  let waiters = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim().length === 0) continue;
      const waiter = waiters.shift();
      // Deliver to the pending waiter OR buffer it — never both, otherwise
      // every response is read twice.
      if (waiter) waiter(line);
      else lines.push(line);
    }
  });

  const send = (message) => {
    child.stdin.write(
      (typeof message === "string" ? message : JSON.stringify(message)) + "\n"
    );
  };

  // Responses arrive in request order (the server queues them), so
  // "next line out" is the answer to the next request sent.
  const next = (timeoutMs = 8000) =>
    new Promise((resolve, reject) => {
      if (lines.length > 0) return resolve(lines.shift());
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for response (${timeoutMs}ms)`)),
        timeoutMs
      );
      waiters.push((line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });

  const request = async (message) => JSON.parse(await next());

  return { child, send, next, request };
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "argus-e2e", version: "1.0.0" }
  }
};

async function main() {
  console.log("=== Argus E2E test ===\n");

  // --- fixtures must exist ---------------------------------------------
  console.log("fixtures");
  const fixtures = fs.existsSync(testDir)
    ? fs.readdirSync(testDir).filter((f) => !f.startsWith("."))
    : [];
  check("src/test/ contains the vulnerable fixtures", fixtures.length >= 4, `found ${fixtures.length}`);

  const server = startServer();

  try {
    // --- handshake -------------------------------------------------------
    console.log("handshake");
    server.send(INIT);
    const init = await server.request();
    check(
      "initialize returns serverInfo.name=novahiz-scan",
      init.result?.serverInfo?.name === "novahiz-scan"
    );
    check(
      "initialize echoes a supported protocolVersion",
      typeof init.result?.protocolVersion === "string" &&
        init.result.protocolVersion.length > 0
    );
    check(
      "initialize declares only the tools capability",
      init.result?.capabilities?.tools !== undefined &&
        init.result?.capabilities?.resources === undefined
    );

    // Notification must produce NO response: the next line we read has to
    // be the ping reply. A stray response would surface as a wrong id here.
    server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    server.send({ jsonrpc: "2.0", id: "p1", method: "ping" });
    const pong = await server.request();
    check(
      "notifications/initialized stays silent (next response is ping)",
      pong.id === "p1" && JSON.stringify(pong.result) === "{}",
      `got id=${JSON.stringify(pong.id)}`
    );

    // --- tools/list ------------------------------------------------------
    console.log("tools/list");
    server.send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const list = await server.request();
    const tools = list.result?.tools ?? [];
    const names = tools.map((t) => t.name).sort();
    check(
      "exposes the 4 tools",
      JSON.stringify(names) ===
        JSON.stringify(["create_rule", "export_results", "list_rules", "scan"]),
      JSON.stringify(names)
    );
    check(
      "every tool has an object inputSchema (type:object)",
      tools.every(
        (t) => t.inputSchema && t.inputSchema.type === "object" && t.description
      )
    );

    // --- scan ------------------------------------------------------------
    console.log("scan");
    server.send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "scan", arguments: { path: path.join("src", "test") } }
    });
    const scan = await server.request();
    check("scan returns isError:false", scan.result?.isError === false);
    const scanData = scan.result?.structuredContent;
    check("scan exposes structuredContent", Boolean(scanData));
    const findings = scanData?.findings ?? [];
    check("scan finds the planted vulnerabilities", findings.length >= 7, `got ${findings.length}`);
    check("scan reads all 4 fixtures", scanData?.scanned_files >= 4, `got ${scanData?.scanned_files}`);
    check("scan reports no read errors", (scanData?.errors ?? []).length === 0);

    const byRule = new Set(findings.map((f) => f.rule));
    for (const rule of ["sql-injection", "xss", "command-injection", "hardcoded-secret"]) {
      check(`rule "${rule}" fires`, byRule.has(rule));
    }
    check(
      "findings carry valid positions",
      findings.every((f) => f.line >= 1 && f.column >= 1 && f.file.length > 0)
    );

    // Determinism: a second identical scan must return identical findings.
    server.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "scan", arguments: { path: path.join("src", "test") } }
    });
    const scan2 = await server.request();
    check(
      "scan is deterministic (identical result twice)",
      JSON.stringify(scan2.result?.structuredContent?.findings) ===
        JSON.stringify(findings)
    );

    // --- list_rules ------------------------------------------------------
    console.log("list_rules");
    server.send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "list_rules", arguments: {} }
    });
    const rules = await server.request();
    check("5 built-in rules", rules.result?.structuredContent?.count === 5);
    check(
      "compiled regex/keywords never serialized",
      !JSON.stringify(rules.result).includes('"regex"')
    );

    // --- create_rule: valid, ReDoS, bad id -------------------------------
    console.log("create_rule");
    server.send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "create_rule",
        arguments: {
          rule: {
            id: "e2e-eval",
            name: "eval usage",
            severity: "warning",
            description: "eval() call",
            pattern: "\\beval\\s*\\(",
            languages: ["python"]
          }
        }
      }
    });
    const created = await server.request();
    check(
      "valid rule is accepted",
      created.result?.structuredContent?.success === true &&
        created.result?.structuredContent?.rule_id === "e2e-eval"
    );

    server.send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "create_rule",
        arguments: {
          rule: {
            id: "redos",
            name: "bad",
            severity: "error",
            description: "bad",
            pattern: "(a+)+$"
          }
        }
      }
    });
    const redos = await server.request();
    check(
      "ReDoS pattern rejected (isError:true)",
      redos.result?.isError === true &&
        JSON.stringify(redos.result.content).includes("nested quantifier")
    );

    server.send({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "create_rule",
        arguments: {
          rule: { id: "bad id!", name: "x", severity: "error", description: "x", pattern: "a" }
        }
      }
    });
    const badId = await server.request();
    check("invalid rule id rejected", badId.result?.isError === true);

    // --- export_results --------------------------------------------------
    console.log("export_results");
    server.send({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "export_results",
        arguments: { results: scanData, format: "json" }
      }
    });
    const exported = await server.request();
    const exportedFile = exported.result?.structuredContent?.exported_file;
    check("export returns a file path", typeof exportedFile === "string");
    if (exportedFile) {
      const parsed = JSON.parse(fs.readFileSync(exportedFile, "utf8"));
      check("exported file is valid JSON with findings", Array.isArray(parsed.findings));
    } else {
      check("exported file is valid JSON with findings", false, "no file path");
    }

    // --- protocol error paths -------------------------------------------
    console.log("error paths");
    server.send({ jsonrpc: "2.0", id: 10, method: "does/not/exist" });
    const unknownMethod = await server.request();
    check("unknown method -> -32601", unknownMethod.error?.code === -32601);

    server.send({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: { name: "nope" }
    });
    const unknownTool = await server.request();
    check("unknown tool -> -32602", unknownTool.error?.code === -32602);

    server.send("not json at all");
    const parseError = await server.request();
    check("invalid JSON -> -32700 with id null", parseError.error?.code === -32700 && parseError.id === null);

    server.send('[{"jsonrpc":"2.0","id":12,"method":"ping"}]');
    const batch = await server.request();
    check("batch array -> -32600", batch.error?.code === -32600);
  } finally {
    server.child.stdin.end();
  }

  // --- pre-initialize gate (fresh process) ------------------------------
  console.log("pre-initialize gate");
  const fresh = startServer();
  try {
    fresh.send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const pre = await fresh.request();
    check("request before initialize -> -32002", pre.error?.code === -32002);
  } finally {
    fresh.child.stdin.end();
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

const watchdog = setTimeout(() => {
  console.error("FATAL: global test timeout (30s)");
  process.exit(1);
}, 30000);

main()
  .then(() => clearTimeout(watchdog))
  .catch((error) => {
    console.error(`\nFATAL: ${error.message}`);
    process.exit(1);
  });
