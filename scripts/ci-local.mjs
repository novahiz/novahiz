#!/usr/bin/env node
// CI locale : typecheck puis suite de tests, dans cet ordre, sans dependance
// externe ni shell (la meme discipline que le reste du depot : spawnSync sans
// option shell, chemins resolus en interne). Chaque etape annonce son
// resultat ; une etape echouee ne masque pas les suivantes, et le code de
// sortie final est non nul si une seule etape echoue.
//
//   node scripts/ci-local.mjs            typecheck + tests
//   node scripts/ci-local.mjs --no-tests typecheck seul
//
// Sortie : journaux des sous-processus en clair, puis un resume `[ci]`.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const skipTests = process.argv.includes("--no-tests");

/** Resout un binaire node_modules en interne (pas de .cmd, pas de shell). */
function localBin(...segments) {
  const target = join(root, "node_modules", ...segments);
  return existsSync(target) ? target : null;
}

/**
 * Lance une etape et rend son code de sortie. L'etape est un tableau
 * [executable, ...arguments] ; `node` est resolu via process.execPath pour
 * ne dependre ni du PATH ni d'un shim Windows.
 */
function run(label, command) {
  const [bin, ...args] = command;
  process.stdout.write(`[ci] ${label}...\n`);
  const started = Date.now();
  const result = spawnSync(bin, args, {
    cwd: root,
    stdio: "inherit",
    // Jamais de shell : l'option shell est bannie repo-wide et les shims
    // .cmd cassent sous Windows (ENOENT/CreateProcess apres CVE-2024-27980).
    shell: false,
    windowsHide: true
  });
  const code = result.status === null ? 1 : result.status;
  process.stdout.write(`[ci] ${label}: ${code === 0 ? "ok" : `FAIL (${code})`} en ${Date.now() - started} ms\n`);
  return code;
}

const steps = [];
const tsc = localBin("typescript", "bin", "tsc");
if (tsc) {
  steps.push(["typecheck (tsc --noEmit)", [process.execPath, tsc, "--noEmit"]]);
} else {
  process.stdout.write("[ci] typescript absent de node_modules : typecheck saute (npm install d'abord)\n");
}
if (!skipTests) {
  steps.push(["tests (node --test)", [process.execPath, "--experimental-strip-types", "--test"]]);
}

if (steps.length === 0) {
  process.stderr.write("[ci] rien a executer\n");
  process.exit(1);
}

let failed = 0;
for (const [label, command] of steps) {
  if (run(label, command) !== 0) failed += 1;
}

process.stdout.write(`[ci] ${steps.length - failed}/${steps.length} etape(s) reussie(s)\n`);
process.exit(failed === 0 ? 0 : 1);
