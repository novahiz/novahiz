import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

type Json = Record<string, any>;

const GATE = join(process.cwd(), "mcp", "novahiz-gate", "index.mjs");
const CORE = join(process.cwd(), "mcp", "novahiz-tools", "index.mjs");

const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
const list = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

function rpc(server: string, lines: string[]): Json[] {
  const run = spawnSync(process.execPath, [server], {
    encoding: "utf8",
    input: lines.join("\n") + "\n",
    timeout: 60_000
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Json);
}

function call(server: string, tool: string, input: string) {
  return spawnSync(process.execPath, [server, "--call", tool], {
    encoding: "utf8",
    input,
    timeout: 60_000
  });
}

describe("mcp/novahiz-gate", () => {
  test("initialize: serverInfo novahiz-gate", () => {
    const [first] = rpc(GATE, [init]);
    assert.equal((first.result as Json).serverInfo.name, "novahiz-gate");
  });

  test("tools/list: exactement novahiz_gate", () => {
    const [, second] = rpc(GATE, [init, list]);
    const tools = (second.result as Json).tools as { name: string }[];
    assert.deepEqual(
      tools.map((entry) => entry.name),
      ["novahiz_gate"]
    );
  });

  test("--call novahiz_gate rend un verdict JSON", () => {
    const run = call(
      GATE,
      "novahiz_gate",
      JSON.stringify({ file: "README.md", tool: "write", content: "ligne de test", loaded: [] })
    );
    assert.equal(run.status, 0, run.stderr);
    const response = JSON.parse(run.stdout.trim()) as Json;
    const payload = ((response.result as Json).content as { text: string }[])[0].text;
    const verdict = JSON.parse(payload) as Json;
    assert.equal(typeof verdict.allow, "boolean");
    assert.equal(verdict.path, "README.md");
    assert.ok(Array.isArray(verdict.reasons));
  });

  test("--call sans file: -32602, exit 1", () => {
    const run = call(GATE, "novahiz_gate", "{}");
    assert.equal(run.status, 1, run.stdout);
    const response = JSON.parse(run.stdout.trim()) as Json;
    assert.equal((response.error as Json).code, -32602);
  });

  test("--call outil inconnu: -32601, exit 1", () => {
    const run = call(GATE, "novahiz_task", JSON.stringify({ file: "x" }));
    assert.equal(run.status, 1, run.stdout);
    const response = JSON.parse(run.stdout.trim()) as Json;
    assert.equal((response.error as Json).code, -32601);
  });
});

describe("novahiz-core sans le gate", () => {
  test("serverInfo novahiz-core, tools/list sans novahiz_gate", () => {
    const [first, second] = rpc(CORE, [init, list]);
    assert.equal((first.result as Json).serverInfo.name, "novahiz-core");
    const tools = (second.result as Json).tools as { name: string }[];
    assert.ok(
      !tools.some((entry) => entry.name === "novahiz_gate"),
      "novahiz_gate ne doit plus etre expose par novahiz-tools"
    );
  });

  test("--call novahiz_gate: unknown tool, exit 1", () => {
    const run = call(CORE, "novahiz_gate", JSON.stringify({ file: "README.md", tool: "write" }));
    assert.equal(run.status, 1, run.stdout);
    const response = JSON.parse(run.stdout.trim()) as Json;
    assert.equal((response.error as Json).code, -32601);
  });
});
