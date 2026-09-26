// Auto-repair for gate FAIL results.
//
// When the gate denies a tool call because required skills are not loaded,
// the denial must be actionable: parse the structured FAIL payload and build
// a directive the agent executes immediately (load the named skills, retry
// the exact same call, resume the user's task) without asking the user and
// without bypassing the gate.
//
// Design guardrails:
// - Fail-closed: this only rewrites the denial message. It never grants the
//   call. The retry passes only when the gate CLI itself sees the skills.
// - Attempt tracking: repeating the identical failure means the skill()
//   loads did not register (skill not installed, index stale) — the message
//   escalates to a diagnosis instead of looping forever.
// - No bypass: the directive never mentions NOVAHIZ_GATE or an alternate
//   tool as a remedy.

export type GateFailure = {
  tool: string;
  missingSkills: string[];
  reasons: string[];
  error: string | null;
};

/**
 * Parse the JSON printed by `novahiz gate` on exit 2. Returns null when the
 * payload is not readable — the caller then falls back to the raw stdout.
 */
export function parseGateFailure(stdout: string): GateFailure | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const asStringArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  const tool = typeof record.tool === "string" && record.tool.length > 0 ? record.tool : "tool";
  return {
    tool,
    missingSkills: asStringArray(record.missingSkills),
    reasons: asStringArray(record.reasons),
    error: typeof record.error === "string" ? record.error : null
  };
}

/**
 * Build the actionable denial for a gate failure.
 *
 * attempt 1  — missing skills: the repair protocol (load, retry, resume).
 * attempt 2+ — the same skills are still missing: the loads did not take
 *              effect, so the directive escalates to diagnosis and stops
 *              the loop instead of repeating itself.
 */
export function buildRepairDirective(failure: GateFailure, attempt: number): string {
  const head = `Novahiz gate blocked ${failure.tool}.`;
  const missing = failure.missingSkills;

  if (missing.length === 0) {
    // Nothing the agent can repair by loading — state the reasons and stop.
    const detail = failure.error ?? failure.reasons.join("; ") ?? "no reason reported";
    return `${head}\nBlocked by rule, not by a missing skill: ${detail}\nResolve the listed rule, then retry once. Never bypass the gate.`;
  }

  if (attempt <= 1) {
    const steps = missing.map((skill, index) => `  ${index + 1}. skill({name:"${skill}"})`).join("\n");
    return [
      `${head} Missing skills: ${missing.join(", ")}.`,
      "AUTO-REPAIR — execute now, do not ask the user, do not stop:",
      steps,
      `  ${missing.length + 1}. Retry this exact ${failure.tool} call once, then continue the user's task where it left off.`,
      "Never bypass the gate: no NOVAHIZ_GATE, no alternate tool, no shell write, no editing around the block."
    ].join("\n");
  }

  return [
    `${head} AUTO-REPAIR FAILED on attempt ${attempt}: still missing ${missing.join(", ")} after skill() loads.`,
    "The loads did not register — diagnose instead of retrying:",
    "  1. Confirm the skill is installed and the index matches (`novahiz doctor`).",
    "  2. Realign the index (`novahiz sync`), then load the named skills again.",
    "If the skill genuinely does not exist, report that honestly to the user and stop. Never bypass the gate."
  ].join("\n");
}
