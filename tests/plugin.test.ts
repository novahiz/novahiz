import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, after } from "node:test";

const pluginHome = mkdtempSync(join(tmpdir(), "novahiz-plugin-"));
process.env.NOVAHIZ_HOME = pluginHome;
// Gate must be ON for the plugin to inject MCP and enforce — system-level
// NOVAHIZ_GATE=off would make DISABLED=true and skip everything.
process.env.NOVAHIZ_GATE = "on";

after(() => {
  try {
    rmSync(pluginHome, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

const { NovahizPlugin } = await import("../adapters/opencode/novahiz.ts");

type HookMap = Record<string, (input: any, output: any) => Promise<void>>;

// Any client method the plugin might touch at load time resolves to a no-op.
const fakeClient: any = new Proxy({}, { get: () => async () => undefined });
const hooks = (await NovahizPlugin({
  client: fakeClient
} as unknown as Parameters<typeof NovahizPlugin>[0])) as unknown as HookMap;

test("the plugin exposes the enforcement hooks", () => {
  for (const name of [
    "config",
    "event",
    "chat.message",
    "experimental.chat.system.transform",
    "tool.execute.before",
    "tool.execute.after"
  ]) {
    assert.equal(typeof hooks[name], "function", `expected hook ${name}`);
  }
});

test("config hook creates project-memory under cwd", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "novahiz-pm-"));
  const prev = process.cwd();
  try {
    process.chdir(cwd);
    const config: any = {};
    await hooks["config"](config, {});
    assert.ok(existsSync(join(cwd, "project-memory", "index.json")));
    assert.ok(existsSync(join(cwd, "project-memory", "slots")));
  } finally {
    process.chdir(prev);
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
});

test("config hook injects the Novahiz MCP server", async () => {
  const config: any = {};
  await hooks["config"](config, {});
  assert.equal(config.mcp.novahiz.type, "local");
  assert.equal(config.mcp.novahiz.enabled, true);
  assert.ok(Array.isArray(config.mcp.novahiz.command));
});

test("tool.execute.before lets non-gated tools through", async () => {
  await hooks["tool.execute.before"](
    { tool: "read", sessionID: "s-read", callID: "c1" },
    { args: { filePath: "/tmp/x.ts" } }
  );
});

test("tool.execute.before records a loaded skill without throwing", async () => {
  await hooks["tool.execute.before"](
    { tool: "skill", sessionID: "s-skill", callID: "c2" },
    { args: { name: "novahiz-humanizer" } }
  );
});

test("tool.execute.before surfaces an unavailable gate instead of failing open", async () => {
  // NOVAHIZ_HOME points at an empty temp dir, so the CLI is missing and the
  // gate exits nonzero. The plugin must throw, never silently allow.
  await assert.rejects(
    hooks["tool.execute.before"](
      { tool: "write", sessionID: "s-gate", callID: "c3" },
      { args: { filePath: "/tmp/y.ts", content: "hello" } }
    ),
    /Novahiz gate/i
  );
});

test("chat.message with no text injects nothing", async () => {
  await hooks["chat.message"]({ sessionID: "s-empty" }, { parts: [] });
  const output: any = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "s-empty" }, output);
  assert.deepEqual(output.system, []);
});

test("chat.message with a failed classify injects nothing but does not throw", async () => {
  // The CLI is missing in this temp HOME, so classify fails and the hook
  // logs a warning and returns without enforcement.
  await hooks["chat.message"](
    { sessionID: "s-fail" },
    { parts: [{ type: "text", text: "fix the login bug" }] }
  );
  const output: any = { system: [] };
  await hooks["experimental.chat.system.transform"]({ sessionID: "s-fail" }, output);
  assert.deepEqual(output.system, []);
});

test("event forgets a deleted session without throwing", async () => {
  await hooks["event"](
    {
      event: { type: "session.deleted", properties: { sessionID: "s-gone" } }
    },
    {}
  );
});

test("event session.idle fails open without throwing", async () => {
  await hooks["event"](
    {
      event: { type: "session.idle", properties: { sessionID: "s-idle" } }
    },
    {}
  );
});

test("tool.execute.after marks a major path without throwing", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "novahiz-mark-"));
  const prev = process.cwd();
  try {
    process.chdir(cwd);
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: "s-after", callID: "c4", args: { filePath: "src/app.ts" } },
      { title: "ok", output: "", metadata: null }
    );
    const state = JSON.parse(readFileSync(join(cwd, ".novahiz", "state.json"), "utf8"));
    assert.equal(state.dirty, true);
    assert.ok(state.pending.includes("src/app.ts"));
  } finally {
    process.chdir(prev);
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
});

test("tool.execute.after ignores non-edit tools and non-major paths", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "novahiz-mark-skip-"));
  const prev = process.cwd();
  try {
    process.chdir(cwd);
    await hooks["tool.execute.after"](
      { tool: "read", sessionID: "s-after2", callID: "c5", args: { filePath: "src/app.ts" } },
      { title: "ok", output: "", metadata: null }
    );
    await hooks["tool.execute.after"](
      { tool: "write", sessionID: "s-after3", callID: "c6", args: { filePath: "notes/todo.md" } },
      { title: "ok", output: "", metadata: null }
    );
    assert.equal(existsSync(join(cwd, ".novahiz", "state.json")), false);
  } finally {
    process.chdir(prev);
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
});

test("P0-B: a failed classify refuses later gate tool calls", async () => {
  // Session "s-fail" classified against a missing CLI earlier in this file —
  // the failure flag must turn subsequent gate calls into refusals.
  await assert.rejects(
    hooks["tool.execute.before"](
      { tool: "write", sessionID: "s-fail", callID: "c-p0b1" },
      { args: { filePath: "/tmp/p0b1.ts", content: "x" } }
    ),
    /classification failed/i
  );
});

test("P0-B: an invalid session ID refuses gate tools and skill loads", async () => {
  await assert.rejects(
    hooks["tool.execute.before"](
      { tool: "write", sessionID: "", callID: "c-p0b2" },
      { args: { filePath: "/tmp/p0b2.ts", content: "x" } }
    ),
    /invalid session ID/i
  );
  await assert.rejects(
    hooks["tool.execute.before"](
      { tool: "skill", sessionID: "", callID: "c-p0b3" },
      { args: { name: "novahiz-plan" } }
    ),
    /invalid session ID/i
  );
  // Tools outside gate.tools need no session and still pass.
  await hooks["tool.execute.before"](
    { tool: "read", sessionID: "", callID: "c-p0b4" },
    { args: { filePath: "/tmp/p0b2.ts" } }
  );
});

test("P0-B: a malformed skill name is refused before recording", async () => {
  await assert.rejects(
    hooks["tool.execute.before"](
      { tool: "skill", sessionID: "s-badname", callID: "c-p0b5" },
      { args: { name: "legit,evil-skill" } }
    ),
    /invalid skill name/i
  );
  await assert.rejects(
    hooks["tool.execute.before"](
      { tool: "skill", sessionID: "s-badname", callID: "c-p0b6" },
      { args: { name: 42 } }
    ),
    /must be a string/i
  );
});
