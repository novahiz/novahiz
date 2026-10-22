import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expandHome, type Provider, type Spec } from "./spec.ts";

// PATH scan plutot qu'un appel a `which`/`where` : ces binaires ne sont pas
// garantis (Debian minimal, conteneurs, Alpine sans which) et un spawn par
// verification ajoutait un echec silencieux. Meme semantique, sans dependance.
export function commandExists(command: string): boolean {
  const separator = process.platform === "win32" ? ";" : ":";
  const dirs = String(process.env.PATH ?? process.env.Path ?? process.env.path ?? "")
    .split(separator)
    .filter(Boolean);
  if (dirs.length === 0) return false;
  const hasExtension = /\.(exe|cmd|bat|com)$/i.test(command);
  const extensions =
    process.platform === "win32" && !hasExtension
      ? String(process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];
  for (const dir of dirs) {
    for (const extension of extensions) {
      try {
        if (existsSync(join(dir, command + extension))) return true;
      } catch {
        // une entree de PATH invalide ne doit pas casser la detection
      }
    }
  }
  return false;
}

/**
 * Une commande de bootstrap du toolchain core doit-elle rester manuelle ?
 *
 * Deux familles ne sont jamais executees par l'installateur :
 *  - `sudo` : demande un mot de passe sur le terminal. Un postinstall, un job
 *    de CI ou un agent n'ont pas de TTY : le spawn attend indefiniment ou
 *    echoue sans explication. L'installateur n'eleve jamais ses privileges.
 *  - un shell (`sh -c`, `bash -c`) qui execute un script telecharge : c'est ce
 *    que l'allowlist de exec.ts refuse pour les argv du catalogue, et un script
 *    distant n'est pas verifiable avant execution.
 * La commande exacte est affichee ; l'utilisateur decide de la lancer.
 */
export function manualCoreBootstrap(argv: string[]): boolean {
  const bin =
    (argv[0] ?? "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      ?.toLowerCase() ?? "";
  return ["sudo", "sh", "bash", "zsh", "dash", "curl", "wget"].includes(bin);
}

type DependencyStatus = {
  id: string;
  kind: string;
  requires: string[];
  missing: string[];
  ok: boolean;
};

export function checkDependencies(spec: Spec): DependencyStatus[] {
  return spec.providers.map((provider) => {
    const requires = provider.requires ?? [];
    const missing = requires.filter((command) => !commandExists(command));
    return { id: provider.id, kind: provider.kind, requires, missing, ok: missing.length === 0 };
  });
}

export function bootstrapFor(provider: Provider, platform: string = process.platform): string[] | null {
  const bootstrap = provider.bootstrap;
  if (!bootstrap) return null;
  return bootstrap[platform] ?? bootstrap.default ?? null;
}

export function missingPrerequisites(spec: Spec): { provider: Provider; missing: string[] }[] {
  return spec.providers
    .map((provider) => ({ provider, missing: (provider.requires ?? []).filter((command) => !commandExists(command)) }))
    .filter((entry) => entry.missing.length > 0);
}

// --- Detection etendue (2026-10-12) ----------------------------------------
// Trois familles que le controle `requires` historique ne couvrait pas: le
// toolchain sur lequel tout novahiz finit par sheller, les entrypoints MCP
// locaux (un fichier disparu repondait "ok" avant), et la sante npm du home.

export type ToolchainEntry = { id: string; ok: boolean; detail: string };

// `where python` ment sous Windows: l'alias d'execution de
// %LocalAppData%\Microsoft\WindowsApps repond sur une machine sans aucun
// Python (il imprime "Python was not found" et sort en 1). Seul un
// interpreteur reel compte.
function pythonStatus(): ToolchainEntry {
  try {
    const result = spawnSync("python", ["--version"], { encoding: "utf8", shell: false, windowsHide: true });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    const ok = result.status === 0 && /^Python \d+\./.test(output);
    return { id: "python", ok, detail: ok ? output.replace(/^Python\s*/, "") : "absent (alias WindowsApps uniquement)" };
  } catch (error) {
    return { id: "python", ok: false, detail: String(error) };
  }
}

export function toolchainStatus(): ToolchainEntry[] {
  const probe = (): ToolchainEntry[] => {
    const entries: ToolchainEntry[] = ["node", "npm", "npx", "uv"].map((id) => ({
      id,
      ok: commandExists(id),
      detail: id === "node" ? process.version : ""
    }));
    entries.push(pythonStatus());
    return entries;
  };
  let status = probe();
  // The parent process may predate the install (opencode started before uv or
  // Python landed): its inherited PATH then hides binaries that ARE on disk.
  // One registry reload on win32, then re-probe — a stale PATH must never be
  // reported as a missing dependency.
  if (process.platform === "win32" && status.some((entry) => !entry.ok)) {
    reloadPathFromRegistry();
    status = probe();
  }
  return status;
}

// Reload process PATH from the registry (Machine + User). Installed tools
// update the registry, not the environment of processes already running.
export function reloadPathFromRegistry(): void {
  if (process.platform !== "win32") return;
  const probe = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')"],
    { encoding: "utf8", windowsHide: true }
  );
  if (probe.status === 0 && probe.stdout?.trim()) process.env.Path = probe.stdout.trim();
}

// Les serveurs MCP locaux lancent `node <fichier>`: la liste des providers
// repondait ok tant que `node` existait, meme quand l'entrypoint avait
// disparu (copie partielle, home supprime). Un existsync par serveur local.
export function entrypointStatus(spec: Spec): { id: string; path: string; ok: boolean }[] {
  const disabled = new Set(spec.config.providers.disabled);
  const entries: { id: string; path: string; ok: boolean }[] = [];
  for (const provider of spec.providers) {
    if (provider.kind !== "mcp" || disabled.has(provider.id)) continue;
    const argv = provider.command ?? [];
    if (argv[0] !== "node" || !argv[1]) continue;
    const path = expandHome(argv[1]);
    entries.push({ id: provider.id, path, ok: existsSync(path) });
  }
  return entries;
}

export type NpmHealth = { ok: boolean; missing: string[]; note: string };

// Controle statique, sans spawn `npm ls`: chaque dependance declaree doit
// resoudre vers un package.json dans node_modules, et le lockfile doit exister.
// C'est ce que `deps --install` lit pour decider d'executer `npm install`.
export function npmHealth(home: string): NpmHealth {
  const pkgPath = join(home, "package.json");
  if (!existsSync(pkgPath)) return { ok: true, missing: [], note: "no package.json (rien a installer)" };
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return { ok: false, missing: [], note: "package.json illisible" };
  }
  const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const missing = Object.keys(declared).filter(
    (name) => !existsSync(join(home, "node_modules", name, "package.json"))
  );
  const lockMissing = !existsSync(join(home, "package-lock.json"));
  return { ok: missing.length === 0 && !lockMissing, missing, note: lockMissing ? "package-lock.json absent" : "" };
}

export type DependencyReport = {
  toolchain: ToolchainEntry[];
  dependencies: DependencyStatus[];
  entrypoints: { id: string; path: string; ok: boolean }[];
  npm: NpmHealth;
};

export function dependencyReport(spec: Spec, home: string): DependencyReport {
  return {
    toolchain: toolchainStatus(),
    dependencies: checkDependencies(spec),
    entrypoints: entrypointStatus(spec),
    npm: npmHealth(home)
  };
}

// Bootstrap du toolchain core. L'argv vit ICI, dans le source — pas dans
// catalog/providers.json, et volontairement: runScript refuse les shells et
// les package managers pour que des donnees de catalogue ne puissent jamais
// elargir cette liste blanche (exec.ts). Un argv appartenu au source au meme
// niveau de confiance que tout le code de ce depot, donc il est execute via
// un spawn simple par `deps --install --core-only` et par l'installateur.
// Chaque entree porte l'id de toolchainStatus() correspondant: seule une
// dependance manquante part en execution.
export function coreBootstrap(platform: string = process.platform): { id: string; argv: string[] }[] {
  if (platform === "win32") {
    return [
      {
        id: "uv",
        argv: ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://astral.sh/uv/install.ps1 | iex"]
      },
      {
        id: "python",
        argv: [
          "winget", "install", "--id", "Python.Python.3.13", "-e", "--scope", "user",
          "--accept-package-agreements", "--accept-source-agreements"
        ]
      }
    ];
  }
  if (platform === "darwin") {
    return [
      { id: "uv", argv: ["brew", "install", "uv"] },
      { id: "python", argv: ["brew", "install", "python3"] }
    ];
  }
  return [
    { id: "uv", argv: ["sh", "-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"] },
    { id: "python", argv: ["sudo", "apt-get", "install", "-y", "python3"] }
  ];
}
