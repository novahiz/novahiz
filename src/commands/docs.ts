// `novahiz docs` : etat et remplissage de l'index documentaire local.
// Le travail reseau vit dans mcp/novahiz-docs (ingest) — ce fichier ne fait
// que lui passer la main par spawn, mcp/ restant hors du typecheck racine
// (tsconfig include = src/adapters/tests).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Parsed, flagOn } from "./context.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function usage(): void {
  process.stderr.write(
    [
      "usage:",
      "  novahiz docs status              Index state per library",
      "  novahiz docs ingest <id>|--all   Fill the local docs index (network)",
      "  novahiz docs ingest <id> --dry   List the targets, touch nothing",
      ""
    ].join("\n")
  );
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
  usage();
  process.exitCode = 2;
}
