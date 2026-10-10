import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { flagOn, type Parsed } from "./context.ts";

// Racine du package qui execute ce code : src/commands/ (dev) ou
// dist/commands/ (npm) — deux niveaux dans les deux cas.
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// --- Upgrade ----------------------------------------------------------------
// Deux canaux d'installation, deux flux :
//  - package npm global (racine sous node_modules) -> `npm install -g
//    novahiz@latest` : c'est le canal des membres de la communaute, il ne
//    faut PAS exiger un depot git comme l'ancien flux.
//  - install source (NOVAHIZ_HOME est un clone git) -> git pull --ff-only,
//    dry-run par defaut, --apply pour tirer (comportement historique, conserve).
// Le mode check (sans --apply) est toujours sans effet de bord reseau
// d'ecriture : il ne fait que consulter la derniere version publiee.

/** Comparaison semver simple : segments numeriques, -1/0/1. "v" de tete ignore. */
export function compareVersions(a: string, b: string): number {
  const clean = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/i, "")
      .split("-")[0]
      .split(".")
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = clean(a);
  const right = clean(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/** Une racine de package npm global contient toujours /node_modules/. */
export function npmInstalled(root: string): boolean {
  return root.replace(/\\/g, "/").toLowerCase().includes("/node_modules/");
}

export type UpgradeTarget = "npm" | "git" | "none";

export function detectTarget(root: string, hasGit: boolean): UpgradeTarget {
  if (npmInstalled(root)) return "npm";
  if (hasGit) return "git";
  return "none";
}

/** Texte de raport du check — teste tel quel. */
export function checkText(installed: string, latest: string, channel: UpgradeTarget): string {
  if (channel === "npm") {
    if (compareVersions(installed, latest) < 0) {
      return `Novahiz ${installed} installed, ${latest} available on npm.\nRun \`novahiz upgrade --apply\` to update.`;
    }
    return `Novahiz ${installed} is up to date (npm latest: ${latest}).`;
  }
  return `Novahiz ${installed} installed (source checkout).`;
}

function readLocalVersion(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

/** npm sous Windows est npm.cmd : spawnSync a besoin du shell, sinon ENOENT.
 *  `pipe` capture stdout/stderr (obligatoire pour `npm view` : `ignore`
 *  retourne stdout=null et `latest` restait toujours vide), `inherit` pour
 *  les sorties visibles de l'utilisateur (installation). Exporte pour le
 *  test de regression. */
export function runNpm(args: string[], stdio: "inherit" | "pipe"): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("npm", args, {
    encoding: "utf8",
    stdio,
    shell: process.platform === "win32"
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function npmFlow(parsed: Parsed, root: string): void {
  const local = readLocalVersion(root);
  const view = runNpm(["view", "novahiz", "version"], "pipe");
  if (view.status !== 0) {
    process.stderr.write(`novahiz upgrade: npm view failed (${view.stderr.trim() || `exit ${view.status}`}).\n`);
    process.exitCode = 1;
    return;
  }
  const latest = view.stdout.trim();
  if (compareVersions(local, latest) >= 0) {
    process.stdout.write(`Novahiz ${local} is up to date (npm latest: ${latest}).\n`);
    return;
  }
  process.stdout.write(`Novahiz ${local} installed, ${latest} available on npm.\n`);
  if (!flagOn(parsed, "apply")) {
    process.stdout.write("Dry run only. Re-run `novahiz upgrade --apply` to update.\n");
    return;
  }
  process.stdout.write(`Installing novahiz@${latest} globally...\n`);
  const install = runNpm(["install", "-g", "novahiz@latest"], "inherit");
  if (install.status !== 0) {
    process.stderr.write("novahiz upgrade: npm install failed. Run `npm install -g novahiz@latest` manually to see why.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Updated to ${latest}.\n` +
      "Restart OpenCode completely to load the new version, then run `novahiz doctor` if anything looks off.\n"
  );
}

/** Flux git historique (install source) : dry-run par defaut, --apply tire. */
function gitFlow(parsed: Parsed, home: string): void {
  if (!existsSync(join(home, ".git"))) {
    process.stderr.write("Not a git repository and not an npm package. Install with `npm install -g novahiz`.\n");
    process.exitCode = 1;
    return;
  }
  if (!flagOn(parsed, "apply")) {
    const dry = spawnSync("git", ["pull", "--dry-run"], { cwd: home, encoding: "utf8" });
    const preview = `${dry.stdout ?? ""}${dry.stderr ?? ""}`.trim();
    if (preview) process.stdout.write(preview + "\n");
    if (dry.status !== 0) {
      process.stderr.write("Dry run failed; fix git first.\n");
      process.exitCode = 1;
      return;
    }
    process.stdout.write("Dry run only. Re-run `novahiz upgrade --apply` to pull and rebuild.\n");
    return;
  }
  process.stdout.write("Pulling latest changes...\n");
  const pull = spawnSync("git", ["pull", "--ff-only"], { cwd: home, stdio: "inherit" });
  if (pull.status !== 0) {
    process.stderr.write("Pull failed; nothing rebuilt.\n");
    process.exitCode = 1;
    return;
  }
  // Comportement historique conserve : apres un pull source, rebuild du
  // catalog de skills avant de demander le restart.
  process.stdout.write("\nRebuilding skill catalog...\n");
  const syncCli = join(home, "src", "cli.ts");
  if (existsSync(syncCli)) {
    spawnSync(process.execPath, [syncCli, "sync"], { stdio: "inherit", env: { ...process.env, NOVAHIZ_HOME: home } });
  }
  process.stdout.write("\nUpgraded! Restart OpenCode to apply changes.\n");
}

export function commandUpgrade(parsed: Parsed): void {
  const home = process.env.NOVAHIZ_HOME || join(process.env.HOME || process.env.USERPROFILE || "", ".config", "novahiz");
  // Le canal se decide sur LE CODE EN EXECUTION (package npm vs checkout
  // source), pas sur NOVAHIZ_HOME : un membre de la communaute installe via
  // `npm i -g` n'a aucun .git dans ~/.config/novahiz.
  const target = detectTarget(PKG_ROOT, existsSync(join(home, ".git")));
  if (target === "npm") {
    npmFlow(parsed, PKG_ROOT);
    return;
  }
  if (target === "git") {
    gitFlow(parsed, home);
    return;
  }
  process.stderr.write(
    `novahiz upgrade: cannot detect the install channel for ${home} (no .git, package not under node_modules).\n` +
      "Manual channels: `npm install -g novahiz@latest` for an npm install, `git pull --ff-only` for a source checkout.\n"
  );
  process.exitCode = 1;
}
