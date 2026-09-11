import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadSpec } from "../src/spec.ts";
import { scanSkills, writeCatalog, writeSkillIndex } from "../src/catalog.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const server = join(root, "mcp", "novahiz-tools", "index.mjs");

before(() => {
  const spec = loadSpec(root);
  const skills = scanSkills(spec);
  writeSkillIndex(spec, skills);
  writeCatalog(spec, skills);
});

function call(lines) {
  const result = spawnSync(process.execPath, [server], {
    encoding: "utf8",
    input: `${lines.join("\n")}\n`,
    env: { ...process.env, NOVAHIZ_HOME: root }
  });
  return result.stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

test("negotiates an unknown protocol version to a supported one", () => {
  const out = call(['{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"9999-99-99"}}']);
  assert.equal(out[0].result.protocolVersion, "2024-11-05");
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
  assert.equal(out[0].result.tools.length, 6);
  const payload = JSON.parse(out[1].result.content[0].text);
  assert.equal(payload.categories[0].id, "design-ui");
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
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"novahiz_catalog","arguments":{"query":"impeccable", "limit": 3}}}'
  ]);
  const payload = JSON.parse(out[0].result.content[0].text);
  assert.ok(Array.isArray(payload.results));
  assert.equal(payload.results[0].id, "impeccable");
});

test("reports a parse error for invalid json", () => {
  const out = call(["not json"]);
  assert.equal(out[0].error.code, -32700);
});
