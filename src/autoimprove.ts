/**
 * The global switch for self-improvement.
 *
 * A system that proposes and repairs on its own needs one thing that always
 * works: a way to turn it off without editing its code. The variable is read
 * once per command, from the environment only — no config file to fall out of
 * sync, no restart to forget.
 */
export type AutoImproveState = { enabled: boolean; reason: string };

const OFF_VALUES = new Set(["off", "0", "false", "no", "disabled"]);

export function autoImproveState(env: NodeJS.ProcessEnv = process.env): AutoImproveState {
  const raw = (env.NOVAHIZ_AUTOIMPROVE ?? "").trim().toLowerCase();
  if (raw.length === 0) return { enabled: true, reason: "NOVAHIZ_AUTOIMPROVE not set" };
  if (OFF_VALUES.has(raw)) return { enabled: false, reason: `NOVAHIZ_AUTOIMPROVE=${raw}` };
  return { enabled: true, reason: `NOVAHIZ_AUTOIMPROVE=${raw}` };
}
