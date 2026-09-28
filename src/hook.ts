import { evaluateGate, type GateResult } from "./gate.ts";
import { extractTargetPaths } from "./targets.ts";
import { changeText } from "./content.ts";
import { loadInstalledSkills } from "./catalog.ts";
import type { Spec } from "./spec.ts";

export type Harness = "claude" | "codex";

export function normalizeTool(harness: Harness, name: string): string {
  const raw = (name || "").toLowerCase();
  if (raw.length === 0) return "";
  // MCP tools arrive as mcp__<server>__<tool>: strip the prefix so the gate
  // sees the bare name (mcp__novahiz__cron_add_task -> cron_add_task).
  const isMcp = raw.startsWith("mcp__");
  let lower = raw;
  if (isMcp) {
    const rest = lower.slice(5);
    const sep = rest.indexOf("__");
    lower = sep >= 0 ? rest.slice(sep + 2) : rest;
  }
  // The harness Skill tool (never an MCP tool) is the load signal on Claude.
  if (!isMcp && lower.includes("skill")) return "skill";
  // Cron tools keep their bare name: the codex "command"/"exec" heuristics
  // below would otherwise misroute cron_add_command_task to bash.
  if (lower.startsWith("cron_")) return lower;
  if (harness === "claude") {
    if (lower === "edit" || lower === "multiedit" || lower === "notebookedit") return "edit";
    if (lower === "write") return "write";
    if (lower === "bash") return "bash";
    if (lower === "powershell") return "shell";
    return lower;
  }
  if (lower.includes("patch")) return "patch";
  if (lower === "write") return "write";
  if (lower.includes("edit")) return "edit";
  if (lower.includes("shell") || lower.includes("bash") || lower.includes("exec") || lower.includes("command")) {
    return "bash";
  }
  return lower;
}

export function extractSkillName(input: unknown): string | null {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  for (const key of ["skill", "name", "skill_name", "command"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value.replace(/^\//, "");
  }
  return null;
}

// Claude Code and Codex have no `skill` tool: their agent loads a skill by reading
// the file. That read is the only load signal those harnesses produce, so the hook
// treats it as one. Without this, a gated edit can never be unblocked there.
const SKILL_FILE = /[\\/]skills[\\/]([^\\/]+)[\\/]SKILL\.md$/i;

export function extractReadSkill(input: unknown): string | null {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  for (const key of ["file_path", "filePath", "path", "notebook_path"]) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const match = SKILL_FILE.exec(value);
    if (match) return match[1];
  }
  return null;
}

export type EvaluateDecision = {
  kind: "evaluate";
  tool: string;
  paths: string[];
  results: (GateResult & { path: string })[];
  block: boolean;
  missing: string[];
  unmatched: string[];
};

export type HookDecision =
  | { kind: "skill"; skill: string }
  | { kind: "pass"; tool: string; reason: string }
  | EvaluateDecision;

export type HookOptions = {
  loadedSkills?: string[];
  categories?: string[];
};

// Write tools are gated even with no detectable target path: a write without
// a path would otherwise slip through the per-path evaluation.
const WRITE_TOOLS = ["edit", "write", "patch", "apply_patch"];

export function decideHook(
  spec: Spec,
  harness: Harness,
  toolName: string,
  toolInput: unknown,
  options: HookOptions = {}
): HookDecision {
  const tool = normalizeTool(harness, toolName);
  if (tool === "skill") {
    const skill = extractSkillName(toolInput);
    if (skill) return { kind: "skill", skill };
    return { kind: "pass", tool, reason: "skill name not found" };
  }
  if (tool === "read") {
    const skill = extractReadSkill(toolInput);
    if (skill) return { kind: "skill", skill };
    return { kind: "pass", tool, reason: "read is not a skill file" };
  }

  // Parity with `novahiz gate`: only configured gate tools are evaluated.
  // Ungated harness tools (Glob, Grep, WebFetch, ...) pass without a log.
  if (!spec.config.gate.tools.includes(tool)) {
    return { kind: "pass", tool, reason: "tool is not gated" };
  }

  const paths = extractTargetPaths(tool, toolInput);
  const content = changeText(tool, toolInput);
  const index = loadInstalledSkills(spec);
  const evalOptions = {
    content,
    categories: options.categories ?? [],
    loadedSkills: options.loadedSkills ?? [],
    installedSkills: index.skills,
    installedIndexAvailable: index.available,
    spec
  };

  if (paths.length === 0) {
    // Parity with `novahiz gate`: a write tool with no target path is refused
    // instead of silently allowed (warn mode still reports it as would-block).
    if (WRITE_TOOLS.includes(tool)) {
      return {
        kind: "evaluate",
        tool,
        paths: [],
        results: [
          {
            path: "",
            allow: false,
            ignored: false,
            fileClass: "other",
            roadmap: null,
            tier: "trivial",
            requiredSkills: [],
            missingSkills: [],
            unmatchedRequired: [],
            matchedRules: [],
            indexMissing: false,
            placeholder: false,
            reasons: ["no target path for a write tool"]
          }
        ],
        block: true,
        missing: [],
        unmatched: []
      };
    }
    // bash/shell/cron without a target path fall through to a pathless
    // evaluation so prompt-scoped rules still apply.
    const entry = { path: "", ...evaluateGate({ tool, filePath: "", pathless: true, ...evalOptions }) };
    return {
      kind: "evaluate",
      tool,
      paths: [],
      results: [entry],
      block: !entry.allow,
      missing: entry.missingSkills,
      unmatched: entry.unmatchedRequired
    };
  }

  const results = paths.map((filePath) => ({
    path: filePath,
    ...evaluateGate({ tool, filePath, ...evalOptions })
  }));
  const block = results.some((entry) => !entry.allow);
  const missing = [...new Set(results.flatMap((entry) => entry.missingSkills))];
  const unmatched = [...new Set(results.flatMap((entry) => entry.unmatchedRequired))];
  return { kind: "evaluate", tool, paths, results, block, missing, unmatched };
}

export function claudeDenyOutput(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  });
}

export function missingMessage(decision: EvaluateDecision): string {
  const targets = decision.results.map((entry) => entry.path).join(", ");
  if (decision.missing.length === 0) {
    const reasons = [...new Set(decision.results.flatMap((entry) => entry.reasons))];
    return `Novahiz: ${reasons.join("; ") || "gate denied the call"}${targets ? ` (${targets})` : ""}`;
  }
  return `Novahiz: charge ${decision.missing.join(", ")} avant de modifier ${targets}`;
}

export function unmatchedMessage(decision: EvaluateDecision): string {
  return `Novahiz: skills requises absentes de l'index, donc non appliquees : ${decision.unmatched.join(", ")}. Relance novahiz sync pour realigner l'index.`;
}
