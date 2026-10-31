/**
 * `novahiz repair` — report first, fix only on `--apply`.
 *
 * The default is a report, because a repair that runs unasked is a change
 * nobody reviewed. `--apply` fixes only what the whitelist names, and each
 * fix is re-checked afterwards: "I ran something" is not "the problem is gone".
 */
import { type Parsed, flagOn, print } from "./context.ts";
import { NovahizHome } from "../spec.ts";
import { repair } from "../repair.ts";
import { autoImproveState } from "../autoimprove.ts";

export function commandRepair(parsed: Parsed): void {
  const home = NovahizHome();
  const apply = flagOn(parsed, "apply");
  const gate = autoImproveState();
  if (apply && !gate.enabled) {
    print({ home, apply: false, disabled: true, reason: gate.reason });
    return;
  }
  const report = repair(home, { apply });

  const unhealthy = report.checks.filter((check) => check.problem !== null);
  print({
    home,
    apply,
    healthy: report.checks.length - unhealthy.length,
    problems: unhealthy,
    outcomes: report.outcomes,
  });

  // A problem that stayed after applying means the repair failed; say so with
  // an exit code a caller can act on.
  if (apply && report.outcomes.some((outcome) => !outcome.ok)) process.exitCode = 1;
}
