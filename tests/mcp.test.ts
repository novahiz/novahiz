import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadSpec } from "../src/spec.ts";
import { scanSkills, writeCatalog, writeSkillIndex } from "../src/catalog.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = join(root, "mcp", "novahiz-tools", "index.mjs");
const testDb = join(tmpdir(), `novahiz-mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.sqlite`);

after(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${testDb}${suffix}`, { force: true });
    } catch {
      // best effort cleanup
    }
  }
});

before(() => {
  const spec = loadSpec(root);
  const skills = scanSkills(spec);
  writeSkillIndex(spec, skills);
  writeCatalog(spec, skills);
});

function call(lines: string[]) {
  const result = spawnSync(process.execPath, [server], {
    encoding: "utf8",
    input: `${lines.join("\n")}\n`,
    env: { ...process.env, NOVAHIZ_HOME: root, NOVAHIZ_DB: testDb }
  });
  return result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

test("negotiates an unknown protocol version to a supported one", () => {
  const out = call(['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"9999-99-99"}}']);
  assert.equal(out[0].result.protocolVersion, "2025-06-18");
});

test("honors a supported protocol version", () => {
  const out = call(['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}']);
  assert.equal(out[0].result.protocolVersion, "2025-06-18");
});

test("lists tools and runs classify", () => {
  const out = call([
    '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"novahiz_classify","arguments":{"prompt":"refais le css de la landing page"}}}'
  ]);
  assert.equal(out[0].result.tools.length, 15);
  const payload = JSON.parse(out[1].result.content[0].text);
  assert.equal(payload.categories[0].id, "design-ui");
});

test("reports dependency status", () => {
  const out = call([
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"novahiz_deps","arguments":{}}}'
  ]);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.ok(Array.isArray(payload.dependencies));
});

test("lists providers for a category", () => {
  const out = call([
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"novahiz_providers","arguments":{"category":"browser"}}}'
  ]);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.ok(payload.providers.some((provider: { id: string }) => provider.id === "playwright"));
});

test("returns a roadmap by category", () => {
  const out = call([
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"novahiz_roadmap","arguments":{"category":"code"}}}'
  ]);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.equal(payload.category, "code");
  assert.equal(payload.roadmap.id, "feature");
});

test("ranks catalog skills by relevance", () => {
  const out = call([
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"novahiz_catalog","arguments":{"query":"anti-AI-design", "limit": 3}}}'
  ]);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.ok(Array.isArray(payload.results));
  assert.equal(payload.results[0].id, "anti-AI-design");
});

test("reports a parse error for invalid json", () => {
  const out = call(["not json"]);
  assert.equal(out[0].error.code, -32700);
});

test("ignores notifications and reports unknown methods", () => {
  const out = call(['{"jsonrpc":"2.0","method":"tools/list"}', '{"jsonrpc":"2.0","id":9,"method":"bogus"}']);
  assert.equal(out.length, 1);
  assert.equal(out[0].error.code, -32601);
});

test("list_skills reports index availability", () => {
  const out = call([
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"novahiz_list_skills","arguments":{}}}'
  ]);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.equal(typeof payload.indexAvailable, "boolean");
});

test("drives the execution ledger over MCP", () => {
  const id = `mcp-${Date.now().toString(36)}`;
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "new", title: "MCP ledger task", id } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "plan", task: id, todos: [{ label: "read the code", kind: "read" }, { label: "verify the change", kind: "verify" }] } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "status", task: id } } })
  ]);
  assert.equal(JSON.parse(out[0].result.content[0].text).id, id);
  assert.equal(JSON.parse(out[1].result.content[0].text).length, 2);
  const status = JSON.parse(out[2].result.content[0].text);
  assert.equal(status.task.id, id);
  assert.ok(status.summary.some((line: string) => line.includes(id)));
});

test("dispatches the active task into work packets", () => {
  const id = `mcp-dispatch-${Date.now().toString(36)}`;
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "new", title: "MCP dispatch task", id } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "plan", task: id, todos: [{ label: "read the code", kind: "read", owner: "src/ledger.ts" }, { label: "review the change", kind: "verify", owner: "src/cli.ts" }] } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "novahiz_dispatch", arguments: { task: id } } })
  ]);
  const packets = JSON.parse(out[2].result.content[0].text);
  assert.equal(packets.task, id);
  assert.equal(packets.packets.length, 2);
  assert.ok(Array.isArray(packets.conflicts));
});

test("runs the gate over MCP", () => {
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_gate", arguments: { tool: "edit", file: "README.md", categories: ["docs-writing"] } } })
  ]);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.equal(typeof payload.allow, "boolean");
});

test("gate accepts the filePath alias", () => {
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_gate", arguments: { tool: "edit", filePath: "README.md", categories: ["docs-writing"] } } })
  ]);
  assert.equal(out[0].error, undefined);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.equal(typeof payload.allow, "boolean");
});

test("gate rejects a call with neither file nor filePath", () => {
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_gate", arguments: { tool: "edit" } } })
  ]);
  assert.equal(out[0].error.code, -32602);
});

test("records a roadmap step over MCP", () => {
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_step", arguments: { session: "mcp-step", step: "scan", status: "done" } } })
  ]);
  assert.ok(out[0].result.content[0].text.length > 0);
});

test("resolves a roadmap from a query over MCP", () => {
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_roadmap", arguments: { query: "corrige un bug de login" } } })
  ]);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.ok(typeof payload.category === "string" && payload.category.length > 0);
});

test("lists providers from a query over MCP", () => {
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_providers", arguments: { query: "navigateur" } } })
  ]);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.ok(Array.isArray(payload.providers));
});

test("lists skills for a category over MCP", () => {
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_list_skills", arguments: { category: "code" } } })
  ]);
  assert.ok(out[0].result.content[0].text.length > 0);
});

test("drives ledger plan amendments over MCP", () => {
  const id = `mcp-amend-${Date.now().toString(36)}`;
  const out = call([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "new", title: "MCP amend task", id } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "plan", task: id, todos: [{ label: "first", kind: "read", owner: "src/a.ts" }] } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "insert", task: id, label: "inserted", kind: "edit", position: "start" } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "signals", task: id } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "novahiz_task", arguments: { action: "current", task: id } } })
  ]);
  assert.equal(JSON.parse(out[1].result.content[0].text).length, 1);
  assert.ok(JSON.parse(out[2].result.content[0].text));
  assert.ok(out[3].result.content[0].text.length > 0);
  assert.ok(out[4].result.content[0].text.length > 0);
});
