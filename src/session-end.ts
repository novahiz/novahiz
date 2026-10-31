/**
 * End-of-session record, not an end-of-session write to the vault.
 *
 * The harness fires `session.idle`. What is useful there is not a note pushed
 * into Obsidian — merging needs judgement, and a wrong merge is silent damage.
 * What is useful is a durable line saying "at this moment, these docs had moved
 * and these memory slots were fresh", so the next session (or the human) can
 * decide what survives without reconstructing it from timestamps.
 *
 * Throttled per session: an idle event fires often, and ten identical lines
 * teach nothing.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const SESSION_END_FILE = ".novahiz/session-end.jsonl";
export const SESSION_END_THROTTLE_MS = 10 * 60 * 1000;
/**
 * The trace is append-only and would grow for the life of the project. Beyond
 * 500 lines it keeps the newest 400: enough history to see what moved, bounded
 * so the file stays readable and cheap to tail.
 */
export const SESSION_END_MAX_LINES = 500;
const SESSION_END_KEEP_LINES = 400;
const TAIL_BYTES = 16_384;

export type SessionEndInput = {
  session: string | null;
  bound: boolean;
  docsModified: number;
  slots: number;
  target: string | null;
};

export type SessionEndRecord = SessionEndInput & { at: string };

export function sessionEndPath(projectRoot: string): string {
  return join(projectRoot, SESSION_END_FILE);
}

/** Last record for a session, read from the tail so a long log stays cheap. */
export function lastSessionEnd(projectRoot: string, session: string | null): SessionEndRecord | null {
  const path = sessionEndPath(projectRoot);
  if (!existsSync(path)) return null;
  let text = "";
  try {
    const raw = readFileSync(path);
    text = raw.subarray(Math.max(0, raw.length - TAIL_BYTES)).toString("utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    try {
      const record = JSON.parse(line) as SessionEndRecord;
      if (typeof record.at !== "string") continue;
      if ((record.session ?? null) !== session) continue;
      return record;
    } catch {
      continue;
    }
  }
  return null;
}

export function shouldRecordSessionEnd(
  projectRoot: string,
  session: string | null,
  now: Date = new Date(),
  throttleMs: number = SESSION_END_THROTTLE_MS
): boolean {
  const last = lastSessionEnd(projectRoot, session);
  if (!last) return true;
  const previous = Date.parse(last.at);
  if (!Number.isFinite(previous)) return true;
  return now.getTime() - previous >= throttleMs;
}

export function recordSessionEnd(
  projectRoot: string,
  input: SessionEndInput,
  now: Date = new Date(),
  throttleMs: number = SESSION_END_THROTTLE_MS
): { recorded: boolean; record: SessionEndRecord | null; reason: string } {
  if (!shouldRecordSessionEnd(projectRoot, input.session, now, throttleMs)) {
    return { recorded: false, record: null, reason: "throttled: un enregistrement recent pour cette session" };
  }
  const record: SessionEndRecord = { ...input, at: now.toISOString() };
  const path = sessionEndPath(projectRoot);
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(record) + "\n", "utf8");
    rotate(path);
  } catch (error) {
    // Idle must never fail the session.
    return { recorded: false, record: null, reason: `ecriture impossible: ${(error as Error).message.slice(0, 120)}` };
  }
  return { recorded: true, record, reason: "" };
}

/** Keep the trace bounded. A rotation failure leaves the file as it was. */
function rotate(path: string): void {
  try {
    const lines = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);
    if (lines.length <= SESSION_END_MAX_LINES) return;
    writeFileSync(path, lines.slice(-SESSION_END_KEEP_LINES).join("\n") + "\n", "utf8");
  } catch {
    // best effort: a failed rotation must not lose the line just written
  }
}
