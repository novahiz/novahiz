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
// gate.enabled=false disables the plugin the same way the CLI gate does (see src/commands/gate.ts).
// gate.mode (block/warn/audit) stays owned by the CLI: the plugin only forwards the gate exit code.
const DISABLED =
  ["off", "0", "false", "no", "disabled"].includes(ESCAPE) || GATE.enabled === false;
const GATE_TOOLS = new Set(
  (Array.isArray(GATE.tools) && GATE.tools.length > 0 ? GATE.tools : ["edit", "write", "patch", "apply_patch", "bash", "shell"]).map((tool) => tool.toLowerCase())
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
  const enforcementBySession = new Map<string, string>();
  const lastSeenBySession = new Map<string, number>();
  const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

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
    enforcementBySession.delete(sessionID);
    lastSeenBySession.delete(sessionID);
  };

  // Sessions only vanish from memory on session.deleted, which may never arrive.
  // Prune entries idle for longer than SESSION_TTL_MS once the map grows.
  const touch = (sessionID: string): void => {
    lastSeenBySession.set(sessionID, Date.now());
    if (lastSeenBySession.size < 50) return;
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, seen] of lastSeenBySession) {
      if (seen < cutoff) forget(id);
    }
  };

  if (DISABLED)
    await log("info", GATE.enabled === false ? "Gate disabled via config (gate.enabled=false)" : "Gate disabled via environment escape");

  return {
    config: async (input) => {
      if (DISABLED) return;
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
        const providers = run(["providers", "--mcp-json"]);
        if (providers.status === 0 && providers.stdout.trim().length > 0) {
          try {
            const entries = JSON.parse(providers.stdout) as Record<string, unknown>;
            for (const [id, entry] of Object.entries(entries)) {
              if (!config.mcp[id]) config.mcp[id] = entry;
            }
          } catch {
            await log("warn", "Providers returned invalid JSON, MCP auto-register skipped");
          }
        } else if (providers.status !== 0) {
          await log("warn", `Providers command failed (exit ${providers.status}), MCP auto-register skipped`);
        }
      } catch (error) {
        await log("warn", `Config hook failed: ${String(error).slice(0, 200)}`);
        return;
      }
    },

    event: async ({ event }) => {
      const type = (event as { type?: string }).type ?? "";
      if (type !== "session.deleted") return;
      const properties = (event as { properties?: { info?: { id?: string }; sessionID?: string } }).properties ?? {};
      const sessionID = properties.info?.id ?? properties.sessionID;
      if (sessionID) forget(sessionID);
    },

    "chat.message": async (input, output) => {
      if (DISABLED) return;
      try {
        touch(input.sessionID);
        const text = textFromParts(output.parts);
        if (text.length === 0) return;
        const result = run(["classify", text]);
        if (result.status !== 0) {
          await log("warn", `Classify failed (exit ${result.status}), no enforcement injected: ${result.stderr.trim().slice(0, 200)}`);
          return;
        }
        let parsed: {
          categories?: { id: string }[];
          primary?: string | null;
          requiredSkills?: string[];
          enforcedSkills?: string[];
          providers?: string[];
          roadmaps?: { id: string; steps: { label: string; kind: string; requireSkills?: string[] }[] }[];
        };
        try {
          parsed = JSON.parse(result.stdout) as typeof parsed;
        } catch {
          await log("warn", "Classify returned invalid JSON, no enforcement injected");
          return;
        }
        const categories = (parsed.categories ?? []).map((entry) => entry.id);
        categoriesBySession.set(input.sessionID, categories);
        const primary = parsed.primary ?? categories[0] ?? null;
        const enforced = parsed.enforcedSkills ?? [];
        const required = parsed.requiredSkills ?? [];
        const suggested = required.filter((skill) => !enforced.includes(skill));
        const roadmap = (parsed.roadmaps ?? [])[0];
        const providers = parsed.providers ?? [];
        const lines = [
          "[Novahiz enforcement]",
          `Categories detectees: ${categories.join(", ") || "aucune"}${primary ? ` (primaire: ${primary})` : ""}`
        ];
        if (roadmap) {
          lines.push(`Roadmap ${roadmap.id}:`);
          roadmap.steps.forEach((step, index) => {
            const skills = step.requireSkills?.length ? ` (${step.requireSkills.join(", ")})` : "";
            lines.push(`  ${index + 1}. [${step.kind}] ${step.label}${skills}`);
          });
        }
        if (enforced.length > 0) lines.push(`Skills requis (roadmap): ${enforced.join(", ")}`);
        if (suggested.length > 0) lines.push(`Skills suggeres: ${suggested.join(", ")}`);
        if (providers.length > 0) lines.push(`Outils pour cette tache: ${providers.join(", ")}`);
        const ledger = run(["task", "current", "--session", input.sessionID]);
        if (ledger.status === 0 && ledger.stdout.trim().length > 0) {
          try {
            const state = JSON.parse(ledger.stdout) as { task?: unknown; summary?: string[] };
            if (state.task && Array.isArray(state.summary) && state.summary.length > 0) lines.push(...state.summary);
          } catch {
            await log("warn", "Ledger state is invalid JSON, enforcement injected without the task summary");
          }
        }
        lines.push("Le gate bloque edit/write/patch/apply_patch/bash/shell tant que les skills requis ne sont pas charges via skill({name:\"...\"}).");
        lines.push("Le gate est sensible au contenu: humanizer pour la prose, impeccable pour le style.");
        lines.push("Config editee = redemarrage d'opencode requis (config lue a l'import).");
        enforcementBySession.set(input.sessionID, lines.join("\n"));
      } catch (error) {
        await log("warn", `chat.message hook failed, no enforcement injected: ${String(error).slice(0, 200)}`);
        return;
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (DISABLED) return;
      const sessionID = input.sessionID;
      if (!sessionID) return;
      const block = enforcementBySession.get(sessionID);
      if (block) output.system.push(block);
    },

    "tool.execute.before": async (input, output) => {
      try {
        touch(input.sessionID);
        if (!loadedBySession.has(input.sessionID)) loadedBySession.set(input.sessionID, new Set());
        const loaded = loadedBySession.get(input.sessionID)!;

        if (input.tool.toLowerCase() === "skill") {
          const args = output.args as { name?: string; skill?: string } | undefined;
          const name = args?.name ?? args?.skill;
          if (name) {
            loaded.add(String(name));
            run(["session-load", "--session", input.sessionID, "--skill", String(name)]);
          }
          return;
        }

        if (DISABLED || !GATE_TOOLS.has(input.tool.toLowerCase())) return;

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
          (() => {
            try {
              return JSON.stringify(output.args ?? {});
            } catch (error) {
              throw new Error(`Novahiz gate blocked ${input.tool}: could not serialize tool args (${String(error)}).`);
            }
          })()
        );

        if (result.spawnError) {
          await log("warn", `Gate unavailable, allowing the tool call: ${result.spawnError}`);
          return;
        }
        if (result.status === 2) {
          throw new Error(`Novahiz gate blocked ${input.tool}.\n${result.stdout}`);
        }
        if (result.status !== 0) {
          throw new Error(
            `Novahiz gate unavailable (exit ${result.status}). Fix the install (run sync, check catalog/) or set the escape variable to disable.\n${result.stderr}`
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Novahiz gate")) throw error;
        await log("warn", `Gate error, allowing the tool call: ${String(error)}`);
      }
    }
  };
};
