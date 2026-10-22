// Le point d'entree publie (`bin/novahiz.mjs`) ne doit pas ecrire de bruit de
// debug.
//
// 0.11.0 a expedie une ligne `console.error("DEBUG", ...)` en dur : chaque
// `novahiz ...` ecrivait le chemin absolu du home et l'etat d'auto-installation
// sur stderr. Un bruit qui casse les scripts qui capturent stderr et qui expose
// un chemin local.
//
// La barre n'est volontairement pas "stderr vide" : sous Node 22.18 le CLI
// importe `node:sqlite`, qui emet un `ExperimentalWarning` legitime. Le test
// refuse la trace de debug, pas les avertissements du runtime.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bin = join(root, "bin", "novahiz.mjs");

test("bin/novahiz.mjs --version : la version sur stdout, aucune trace de debug", () => {
  const run = spawnSync(process.execPath, [bin, "--version"], {
    encoding: "utf8",
    cwd: root,
    // Sans auto-installation : le test ne doit jamais declencher d'installation.
    env: { ...process.env, NOVAHIZ_AUTOINSTALL: "0" },
    timeout: 120_000
  });

  assert.equal(run.status, 0, `exit ${run.status} - stderr: ${run.stderr}`);
  assert.match(run.stdout ?? "", /Novahiz \d+\.\d+\.\d+/);

  const debugLines = (run.stderr ?? "")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("DEBUG"));
  assert.deepEqual(debugLines, [], `stderr ne doit porter aucune ligne DEBUG: ${run.stderr}`);
});
