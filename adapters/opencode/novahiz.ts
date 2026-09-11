import type { Plugin } from "@opencode-ai/plugin";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  dedupeStaleReads,
  encodeSavings,
  mergeTokensConfig,
  pruneSavingsText,
  savingsPath,
  trimToolOutput,
  type MinimalMessage,
  type SavingsEntry,
  type TokensConfig
} from "./tokens.ts";

const HOME =
  process.env.NOVAHIZ_HOME && process.env.NOVAHIZ_HOME.length > 0
    ? process.env.NOVAHIZ_HOME
    : join(homedir(), ".config", "novahiz");
const CLI = join(HOME, "src", "cli.ts");
const NODE =
  process.env.NOVAHIZ_NODE && process.env.NOVAHIZ_NODE.length > 0 ? process.env.NOVAHIZ_NODE : "node";

type GateConfig = { enabled?: boolean; mode?: string; envEscape?: string; tools?: string[] };
type NovahizConfig = { gate?: GateConfig; tokens?: unknown };

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

const TOKENS: TokensConfig = mergeTokensConfig(CONFIG.tokens);
const TOKENS_ESCAPE = (process.env.NOVAHIZ_TOKENS || "").toLowerCase();
const TOKENS_OFF = ["off", "0", "false", "no", "disabled"].includes(TOKENS_ESCAPE);
const SAVINGS_PRUNE_BYTES = 4_000_000;

type RunResult = { status: number; stdout: string; stderr: string; spawnError?: string };

function run(args: string[], input?: string): RunResult {
  const result = spawnSync(NODE, [CLI, ...args], { encoding: "utf8", input });
  if (result.error) return { status: 1, stdout: "", stderr: "", spawnError: result.error.message };
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function recordSavings(entries: SavingsEntry[]): void {
  if (entries.length === 0) return;
  try {
    const path = savingsPath(HOME);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, entries.map(encodeSavings).join(""), "utf8");
    if (existsSync(path) && statSync(path).size > SAVINGS_PRUNE_BYTES) {
      writeFileSync(path, pruneSavingsText(readFileSync(path, "utf8")), "utf8");
    }
  } catch {
    return;
  }
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
        const providers = run(["providers", "--mcp-json"]);
        if (providers.status === 0 && providers.stdout.trim().length > 0) {
          const entries = JSON.parse(providers.stdout) as Record<string, unknown>;
          for (const [id, entry] of Object.entries(entries)) {
            if (!config.mcp[id]) config.mcp[id] = entry;
          }
        }
      } catch {
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
      try {
        const text = textFromParts(output.parts);
        if (text.length === 0) return;
        const result = run(["classify", text]);
        if (result.status !== 0) return;
        const parsed = JSON.parse(result.stdout) as {
          categories?: { id: string }[];
          primary?: string | null;
          requiredSkills?: string[];
          enforcedSkills?: string[];
          providers?: string[];
          roadmaps?: { id: string; steps: { label: string; kind: string; requireSkills?: string[] }[] }[];
        };
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
          const state = JSON.parse(ledger.stdout) as { task?: unknown; summary?: string[] };
          if (state.task && Array.isArray(state.summary) && state.summary.length > 0) lines.push(...state.summary);
        }
        lines.push("Le gate bloque edit/write/patch/bash tant que les skills requis ne sont pas charges via skill({name:\"...\"}).");
        lines.push("Le gate est sensible au contenu: humanizer pour la prose, impeccable pour le style.");
        enforcementBySession.set(input.sessionID, lines.join("\n"));
      } catch {
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
        if (!loadedBySession.has(input.sessionID)) loadedBySession.set(input.sessionID, new Set());
        const loaded = loadedBySession.get(input.sessionID)!;

        if (input.tool.toLowerCase() === "skill") {
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
          throw new Error(
            `Novahiz gate unavailable (exit ${result.status}). Fix the install (run sync, check catalog/) or set the escape variable to disable.\n${result.stderr}`
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Novahiz gate")) throw error;
        await log("warn", `Gate error, allowing the tool call: ${String(error)}`);
      }
    },

    "chat.params": async (_input, output) => {
      if (TOKENS_OFF || !TOKENS.enabled) return;
      if (TOKENS.capOutputTokens <= 0) return;
      if (output.maxOutputTokens === undefined) output.maxOutputTokens = TOKENS.capOutputTokens;
    },

    "tool.execute.after": async (input, output) => {
      if (TOKENS_OFF || !TOKENS.enabled) return;
      try {
        const outcome = trimToolOutput(input.tool, output.output, TOKENS);
        if (!outcome) return;
        output.output = outcome.text;
        recordSavings([
          { at: new Date().toISOString(), session: input.sessionID, tool: input.tool, kind: "trim", tokens: outcome.removedTokens }
        ]);
      } catch (error) {
        await log("warn", `Token trim skipped: ${String(error)}`);
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (TOKENS_OFF || !TOKENS.enabled) return;
      try {
        const outcome = dedupeStaleReads(output.messages as unknown as MinimalMessage[], TOKENS);
        if (outcome.stubbed === 0) return;
        recordSavings([
          { at: new Date().toISOString(), session: "", tool: "read", kind: "dedupe", tokens: outcome.removedTokens }
        ]);
      } catch (error) {
        await log("warn", `Token dedupe skipped: ${String(error)}`);
      }
    }
  };
};
