import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asString, print, type Parsed } from "./context.ts";
import { novahizHome } from "../spec.ts";
import { buildCalibration, filterSavings, parseSavings, savingsPath, summarizeSavings } from "../../adapters/opencode/tokens.ts";

export function commandTokens(parsed: Parsed): void {
  const root = novahizHome();
  const path = savingsPath(root);
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  const entries = filterSavings(parseSavings(text), {
    since: asString(parsed.flags.since),
    session: asString(parsed.flags.session)
  });
  const summary = summarizeSavings(entries);
  const format = asString(parsed.flags.format) || "json";
  if (parsed.flags.calibrate === true) {
    const calibration = buildCalibration(entries);
    if (format === "text") {
      const lines = [
        `Novahiz token calibration (${path})`,
        `removed bytes: min ${calibration.removedBytes.min} / median ${calibration.removedBytes.median} / max ${calibration.removedBytes.max}`,
        `removed tokens: min ${calibration.removedTokens.min} / median ${calibration.removedTokens.median} / max ${calibration.removedTokens.max}`,
        `bytes/token: ${calibration.bytesPerToken === null ? "n/a" : calibration.bytesPerToken.toFixed(2)}`,
        `trims: ${calibration.trimEvents} (instrumented ${calibration.instrumentedTrims})  re-reads: ${calibration.reReads}`
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
      return;
    }
    print({ path, calibration });
    return;
  }
  if (format === "text") {
    const lines = [
      `Novahiz token savings (${path})`,
      `events: ${summary.events}`,
      `~tokens saved: ${summary.totalSaved}`,
      `bytes: ${summary.totalOriginalBytes} -> ${summary.totalKeptBytes}`,
      `trim: ${summary.byKind.trim}  dedupe: ${summary.byKind.dedupe}`,
      `sessions: ${summary.sessions}`
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }
  print({ path, ...summary });
}

