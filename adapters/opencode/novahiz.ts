import type { Plugin } from "@opencode-ai/plugin";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME =
  process.env.NOVAHIZ_HOME && process.env.NOVAHIZ_HOME.length > 0
    ? process.env.NOVAHIZ_HOME
    : join(homedir(), ".config", "novahiz");
const CLI = join(HOME, "src", "cli.ts");
const NODE =
  process.env.NOVAHIZ_NODE && process.env.NOVAHIZ_NODE.length > 0 ? process.env.NOVAHIZ_NODE : "node";
const ESCAPE = (process.env.NOVAHIZ_GATE || "").toLowerCase();
const DISABLED = ["off", "0", "false", "no", "audit", "disabled"].includes(ESCAPE);
const GATE_TOOLS = new Set(["edit", "write", "patch"]);

type RunResult = { status: number; stdout: string; stderr: string; spawnError?: string };

function run(args: string[]): RunResult {
  const result = spawnSync(NODE, [CLI, ...args], { encoding: "utf8" });
  if (result.error) {
    return { status: 1, stdout: "", stderr: "", spawnError: result.error.message };
  }
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
  const requiredBySession = new Map<string, string[]>();

  const log = async (level: "info" | "warn", message: string): Promise<void> => {
    try {
      await client.app.log({ body: { service: "novahiz", level, message } });
    } catch {
      return;
    }
  };

  if (DISABLED) await log("info", "Gate disabled via NOVAHIZ_GATE");

  return {
    config: async (input) => {
      try {
        const config = input as {
          mcp?: Record<string, unknown>;
          plugin?: unknown[];
        };
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

    "chat.message": async (input, output) => {
      try {
        const text = textFromParts(output.parts);
        if (text.length === 0) return;
        const result = run(["classify", text]);
        if (result.status !== 0) return;
        const parsed = JSON.parse(result.stdout) as {
          categories?: { id: string }[];
          requiredSkills?: string[];
        };
        categoriesBySession.set(input.sessionID, (parsed.categories ?? []).map((entry) => entry.id));
        requiredBySession.set(input.sessionID, parsed.requiredSkills ?? []);
      } catch {
        return;
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (DISABLED) return;
      const sessionID = input.sessionID;
      if (!sessionID) return;
      const categories = categoriesBySession.get(sessionID) ?? [];
      const required = requiredBySession.get(sessionID) ?? [];
      if (categories.length === 0 && required.length === 0) return;
      output.system.push(
        [
          "[Novahiz enforcement]",
          `Categories detectees: ${categories.join(", ") || "aucune"}`,
          `Skills requis pour cette demande: ${required.join(", ") || "aucun"}`,
          "Charge ces skills avec skill({name:\"...\"}) avant tout edit/write/patch. Le gate bloque sinon.",
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

        const args = output.args as { filePath?: string; path?: string; file?: string } | undefined;
        const filePath = String(args?.filePath ?? args?.path ?? args?.file ?? "");
        if (filePath.length === 0) return;

        const categories = categoriesBySession.get(input.sessionID) ?? [];
        const result = run([
          "gate",
          "--file",
          filePath,
          "--tool",
          input.tool,
          "--categories",
          categories.join(","),
          "--loaded",
          [...loaded].join(","),
          "--session",
          input.sessionID
        ]);

        if (result.spawnError) {
          await log("warn", `Gate unavailable, allowing the tool call: ${result.spawnError}`);
          return;
        }
        if (result.status !== 0) {
          throw new Error(`Novahiz gate blocked ${input.tool} on ${filePath}.\n${result.stdout}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Novahiz gate blocked")) throw error;
        await log("warn", `Gate error, allowing the tool call: ${String(error)}`);
      }
    }
  };
};
