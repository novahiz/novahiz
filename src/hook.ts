import { evaluateGate, type GateResult } from "./gate.ts";
import { extractTargetPaths } from "./targets.ts";
import { changeText } from "./content.ts";
import { loadInstalledSkills } from "./catalog.ts";
import type { Spec } from "./spec.ts";

export type Harness = "claude" | "codex";

export function normalizeTool(harness: Harness, name: string): string {
  const lower = (name || "").toLowerCase();
  if (lower.length === 0) return "";
  if (lower.includes("skill")) return "skill";
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

  const paths = extractTargetPaths(tool, toolInput);
  if (paths.length === 0) return { kind: "pass", tool, reason: "no target path detected" };

  const content = changeText(tool, toolInput);
  const index = loadInstalledSkills(spec);
  const results = paths.map((filePath) => ({
    path: filePath,
    ...evaluateGate({
      tool,
      filePath,
      content,
      categories: options.categories ?? [],
      loadedSkills: options.loadedSkills ?? [],
      installedSkills: index.skills,
      installedIndexAvailable: index.available,
      spec
    })
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
  return `Novahiz: charge ${decision.missing.join(", ")} avant de modifier ${targets}`;
}

export function unmatchedMessage(decision: EvaluateDecision): string {
  return `Novahiz: skills requises absentes de l'index, donc non appliquees : ${decision.unmatched.join(", ")}. Relance novahiz sync pour realigner l'index.`;
}
