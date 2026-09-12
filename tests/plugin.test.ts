import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, after } from "node:test";

const pluginHome = mkdtempSync(join(tmpdir(), "novahiz-plugin-"));
process.env.NOVAHIZ_HOME = pluginHome;

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

test("the plugin exposes the token-economy and enforcement hooks", () => {
  for (const name of [
    "tool.execute.after",
    "experimental.chat.messages.transform",
    "chat.params",
    "config",
    "event",
    "chat.message",
    "experimental.chat.system.transform",
    "tool.execute.before"
  ]) {
    assert.equal(typeof hooks[name], "function", `expected hook ${name}`);
  }
});

test("tool.execute.after trims a large read output", async () => {
  const output = {
    title: "read",
    output: Array.from({ length: 600 }, (_, index) => `line ${index}`).join("\n"),
    metadata: {}
  };
  await hooks["tool.execute.after"]({ tool: "read", sessionID: "s1", callID: "c1", args: {} }, output);
  assert.match(output.output, /novahiz: \d+ lines elided/);
});

test("experimental.chat.messages.transform stubs a stale earlier read", async () => {
  const messages = [
    {
      parts: [
        {
          type: "tool",
          tool: "read",
          state: { status: "completed", input: { filePath: "/tmp/same.ts" }, output: "a".repeat(900) }
        }
      ]
    },
    {
      parts: [
        {
          type: "tool",
          tool: "read",
          state: { status: "completed", input: { filePath: "/tmp/same.ts" }, output: "b".repeat(900) }
        }
      ]
    }
  ];
  await hooks["experimental.chat.messages.transform"]({}, { messages });
  assert.match(messages[0].parts[0].state.output, /superseded by a later read/);
  assert.equal(messages[1].parts[0].state.output, "b".repeat(900));
});

test("chat.params stays inert while capOutputTokens is 0", async () => {
  const params = { maxOutputTokens: undefined as number | undefined };
  await hooks["chat.params"]({}, params);
  assert.equal(params.maxOutputTokens, undefined);
});
