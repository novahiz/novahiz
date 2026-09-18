import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, after } from "node:test";

const pluginHome = mkdtempSync(join(tmpdir(), "skillenforce-plugin-"));
process.env.skillenforce_HOME = pluginHome;

after(() => {
  try {
    rmSync(pluginHome, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
});

const { SkillenforcePlugin } = await import("../adapters/opencode/skillenforce.ts");

type HookMap = Record<string, (input: any, output: any) => Promise<void>>;

// Any client method the plugin might touch at load time resolves to a no-op.
const fakeClient: any = new Proxy({}, { get: () => async () => undefined });
const hooks = (await SkillenforcePlugin({
  client: fakeClient
} as unknown as Parameters<typeof SkillenforcePlugin>[0])) as unknown as HookMap;

test("the plugin exposes the enforcement hooks", () => {
  for (const name of [
    "config",
    "event",
    "chat.message",
    "experimental.chat.system.transform",
    "tool.execute.before"
  ]) {
    assert.equal(typeof hooks[name], "function", `expected hook ${name}`);
  }
});

test("config hook injects the skillenforce MCP server", async () => {
  const config: any = {};
  await hooks["config"](config, {});
  assert.equal(config.mcp.skillenforce.type, "local");
  assert.equal(config.mcp.skillenforce.enabled, true);
  assert.ok(Array.isArray(config.mcp.skillenforce.command));
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
    { args: { name: "humanizer" } }
  );
});

test("tool.execute.before surfaces an unavailable gate instead of failing open", async () => {
  // skillenforce_HOME points at an empty temp dir, so the CLI is missing and the
  // gate exits nonzero. The plugin must throw, never silently allow.
  await assert.rejects(
    hooks["tool.execute.before"](
      { tool: "write", sessionID: "s-gate", callID: "c3" },
      { args: { filePath: "/tmp/y.ts", content: "hello" } }
    ),
    /skillenforce gate/
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
