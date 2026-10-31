// `novahiz docs` : etat et remplissage de l'index documentaire local.
// Le travail reseau vit dans mcp/novahiz-docs (ingest) — ce fichier ne fait
// que lui passer la main par spawn, mcp/ restant hors du typecheck racine
// (tsconfig include = src/adapters/tests).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Parsed, flagOn, splitList } from "./context.ts";
import { NovahizHome, loadSpec } from "../spec.ts";
import { openDb } from "../db.ts";
import { runVerification } from "../evidence.ts";
import { defaultSessionForProject } from "../sessions.ts";
import { collectClaims } from "../docverify.ts";
import { dbPathFor, print } from "./context.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function usage(): void {
  process.stderr.write(
    [
      "usage:",
      "  novahiz docs status              Index state per library",
      "  novahiz docs ingest <id>|--all   Fill the local docs index (network)",
      "  novahiz docs verify [--path a,b]  Replay the claims marked <!-- verify: name --> and report their verdicts",
      "  novahiz docs ingest <id> --dry   List the targets, touch nothing",
      ""
    ].join("\n")
  );
}

/**
 * Verdict of one documentation claim.
 *
 * `unknown` covers two honest gaps: the command does not exist (a typo in the
 * marker), and the command could not measure (exit 3). Neither is a lie about
 * the document, so neither may be reported as `failed`.
 */
export function claimVerdict(outcome: { ok: boolean; inconclusive?: boolean; error?: string }): "ok" | "failed" | "unknown" {
  if (outcome.ok) return "ok";
  if (outcome.inconclusive === true) return "unknown";
  const error = typeof outcome.error === "string" ? outcome.error : "";
  if (error.startsWith("no verify config") || error.startsWith("unknown verification")) return "unknown";
  return "failed";
}

export function commandDocs(parsed: Parsed): void {
  const sub = parsed.positionals[1];
  const script = join(__dirname, "..", "..", "mcp", "novahiz-docs", "index.mjs");
  if (!existsSync(script)) {
    process.stderr.write(`novahiz docs: missing ${script}\n`);
    process.exitCode = 1;
    return;
  }
  const run = (argv: string[]): void => {
    const result = spawnSync(process.execPath, [script, ...argv], { encoding: "utf8", stdio: "inherit" });
    process.exitCode = typeof result.status === "number" ? result.status : 1;
  };

  if (sub === "status" || sub === undefined) {
    run(["--status"]);
    return;
  }
  if (sub === "ingest") {
    // parse() absorbe la valeur d'un flag : `ingest --dry react` met react dans
    // flags.dry. On recover la spec depuis les deux emplacements et on echoue
    // TOUJOURS vers le dry-run — jamais de reseau quand --dry est ecrit.
    const rawDry = parsed.flags.dry;
    const dry = rawDry !== undefined;
    const spec =
      parsed.positionals[2] ??
      (typeof rawDry === "string" && rawDry !== "false" && rawDry !== "true" ? rawDry : undefined) ??
      (flagOn(parsed, "all") ? "--all" : undefined);
    if (!spec) {
      usage();
      process.exitCode = 2;
      return;
    }
    run(dry ? ["--ingest", spec, "--dry"] : ["--ingest", spec]);
    return;
  }
  if (sub === "verify") {
    const home = NovahizHome();
    const spec = loadSpec(home);
    const projectRoot = process.cwd();
    const files = splitList(parsed.flags.path);
    const claims = collectClaims(projectRoot, files);
    const db = openDb(dbPathFor(home, spec));
    const resolvedSession = defaultSessionForProject(db, { projectRoot });
    const attribution = resolvedSession.session
      ? { session: resolvedSession.session }
      : resolvedSession.candidates.length > 1
        ? { session: null, reason: `${resolvedSession.candidates.length} sessions vivantes : aucune attribution devinee` }
        : { session: null, reason: "aucune session vivante sur ce projet" };
    const results: {
      file: string;
      line: number;
      verify: string;
      text: string;
      verdict: "ok" | "failed" | "unknown";
      exitCode: number | null;
      evidenceId: string;
      error?: string;
    }[] = [];
    try {
      for (const claim of claims) {
        const outcome = runVerification(db, {
          projectRoot,
          name: claim.verify,
          expect: claim.expect,
          // Same attribution rule as `novahiz verify`: one live session on the
          // project, never a guess between two.
          session: resolvedSession.session ?? undefined,
        });
        results.push({
          file: claim.file,
          line: claim.line,
          verify: claim.verify,
          text: claim.text,
          verdict: claimVerdict(outcome),
          exitCode: outcome.exitCode,
          evidenceId: outcome.evidenceId,
          ...(outcome.error ? { error: String(outcome.error).slice(0, 160) } : {}),
        });
      }
    } finally {
      db.close();
    }
    const failed = results.filter((row) => row.verdict === "failed").length;
    const unknown = results.filter((row) => row.verdict === "unknown").length;
    print({
      projectRoot,
      claims: results.length,
      failed,
      // A claim nothing could measure is neither proven nor contradicted. It is
      // reported, never counted as a failure: red has to keep meaning "the
      // document is wrong".
      unknown,
      attribution,
      results,
    });
    if (failed > 0) process.exitCode = 1;
    return;
  }
  usage();
  process.exitCode = 2;
}
