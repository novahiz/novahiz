import type { Plugin } from "@opencode-ai/plugin";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME =
  process.env.NOVAHIZ_HOME && process.env.NOVAHIZ_HOME.length > 0
    ? process.env.NOVAHIZ_HOME
    : join(homedir(), ".config", "novahiz");
const CLI = join(HOME, "src", "cli.ts");
const NODE =
  process.env.NOVAHIZ_NODE && process.env.NOVAHIZ_NODE.length > 0 ? process.env.NOVAHIZ_NODE : "node";

type GateConfig = { enabled?: boolean; mode?: string; envEscape?: string; tools?: string[] };
type NovahizConfig = { gate?: GateConfig };

function readConfig(): NovahizConfig {
  for (const name of ["novahiz.config.json", "novahiz.config.example.json"]) {
    try {
      return JSON.parse(readFileSync(join(HOME, name), "utf8")) as NovahizConfig;
    } catch {
      continue;
    }
  }
  return {};
}

const CONFIG = readConfig();
const GATE = CONFIG.gate ?? {};
const ENV_ESCAPE = typeof GATE.envEscape === "string" && GATE.envEscape.length > 0 ? GATE.envEscape : "NOVAHIZ_GATE";
const ESCAPE = (process.env[ENV_ESCAPE] || "").toLowerCase();
const DISABLED = ["off", "0", "false", "no", "disabled"].includes(ESCAPE);
const GATE_TOOLS = new Set(
  Array.isArray(GATE.tools) && GATE.tools.length > 0 ? GATE.tools : ["edit", "write", "patch", "apply_patch", "bash", "shell"]
);

type RunResult = { status: number; stdout: string; stderr: string; spawnError?: string };

function run(args: string[], input?: string): RunResult {
  const result = spawnSync(NODE, [CLI, ...args], { encoding: "utf8", input });
  if (result.error) return { status: 1, stdout: "", stderr: "", spawnError: result.error.message };
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    const record = part as { type?: string; text?: string };
    if (record && record.type === "text" && typeof record.text === "string") chunks.push(record.text);
  }
  return chunks.join("\n").trim();
}

export const NovahizPlugin: Plugin = async ({ client }) => {
  const loadedBySession = new Map<string, Set<string>>();
  const categoriesBySession = new Map<string, string[]>();

  const log = async (level: "info" | "warn", message: string): Promise<void> => {
    try {
      await client.app.log({ body: { service: "novahiz", level, message } });
    } catch {
      return;
    }
  };

  const forget = (sessionID: string): void => {
    loadedBySession.delete(sessionID);
    categoriesBySession.delete(sessionID);
  };

  if (DISABLED) await log("info", "Gate disabled via environment escape");

  return {
    config: async (input) => {
      try {
        const config = input as { mcp?: Record<string, unknown> };
        if (!config.mcp) config.mcp = {};
        if (!config.mcp.novahiz) {
          config.mcp.novahiz = {
            type: "local",
            command: [NODE, join(HOME, "mcp", "novahiz-tools", "index.mjs")],
            enabled: true
          };
        }
      } catch {
        return;
      }
    },

    event: async ({ event }) => {
      const type = (event as { type?: string }).type ?? "";
      if (type !== "session.deleted" && type !== "session.idle") return;
      const properties = (event as { properties?: { info?: { id?: string }; sessionID?: string } }).properties ?? {};
      const sessionID = properties.info?.id ?? properties.sessionID;
      if (sessionID) forget(sessionID);
    },

    "chat.message": async (input, output) => {
      try {
        const text = textFromParts(output.parts);
        if (text.length === 0) return;
        const result = run(["classify", text]);
        if (result.status !== 0) return;
        const parsed = JSON.parse(result.stdout) as { categories?: { id: string }[] };
        categoriesBySession.set(input.sessionID, (parsed.categories ?? []).map((entry) => entry.id));
      } catch {
        return;
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (DISABLED) return;
      const sessionID = input.sessionID;
      if (!sessionID) return;
      const categories = categoriesBySession.get(sessionID) ?? [];
      if (categories.length === 0) return;
      output.system.push(
        [
          "[Novahiz enforcement]",
          `Categories detectees: ${categories.join(", ")}`,
          "Charge les skills requis avec skill({name:\"...\"}) avant tout edit/write/patch. Le gate bloque sinon.",
          "Regles: humanizer sur tout code ou texte, impeccable sur tout design, skills supabase sur toute tache Supabase."
        ].join("\n")
      );
    },

    "tool.execute.before": async (input, output) => {
      try {
        if (!loadedBySession.has(input.sessionID)) loadedBySession.set(input.sessionID, new Set());
        const loaded = loadedBySession.get(input.sessionID)!;

        if (input.tool === "skill") {
          const args = output.args as { name?: string; skill?: string } | undefined;
          const name = args?.name ?? args?.skill;
          if (name) loaded.add(String(name));
          return;
        }

        if (DISABLED || !GATE_TOOLS.has(input.tool)) return;

        const categories = categoriesBySession.get(input.sessionID) ?? [];
        const result = run(
          [
            "gate",
            "--tool",
            input.tool,
            "--args-stdin",
            "--categories",
            categories.join(","),
            "--loaded",
            [...loaded].join(","),
            "--session",
            input.sessionID
          ],
          JSON.stringify(output.args ?? {})
        );

        if (result.spawnError) {
          await log("warn", `Gate unavailable, allowing the tool call: ${result.spawnError}`);
          return;
        }
        if (result.status === 2) {
          throw new Error(`Novahiz gate blocked ${input.tool}.\n${result.stdout}`);
        }
        if (result.status !== 0) {
          await log("warn", `Gate error (exit ${result.status}), allowing the tool call: ${result.stderr}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Novahiz gate blocked")) throw error;
        await log("warn", `Gate error, allowing the tool call: ${String(error)}`);
      }
    }
  };
};
