// Le point d'entree publie (`bin/novahiz.mjs`) doit rester silencieux.
//
// 0.11.0 a expedie une ligne `console.error("DEBUG", ...)` en dur : chaque
// `novahiz ...` ecrivait le chemin absolu du home et l'etat d'auto-installation
// sur stderr. Un bruit qui casse les scripts qui capturent stderr et qui expose
// un chemin local. Ce test tient la barre pour les prochaines versions :
// `--version` ecrit la version sur stdout et rien du tout sur stderr.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bin = join(root, "bin", "novahiz.mjs");

test("bin/novahiz.mjs --version : la version sur stdout, stderr vide", () => {
  const run = spawnSync(process.execPath, [bin, "--version"], {
    encoding: "utf8",
    cwd: root,
    // Sans auto-installation : le test ne doit jamais declencher d'installation.
    env: { ...process.env, NOVAHIZ_AUTOINSTALL: "0" },
    timeout: 120_000
  });

  assert.equal(run.status, 0, `exit ${run.status} - stderr: ${run.stderr}`);
  assert.match(run.stdout ?? "", /Novahiz \d+\.\d+\.\d+/);
  assert.equal(run.stderr ?? "", "", `stderr doit rester vide, recu: ${JSON.stringify(run.stderr)}`);
});
