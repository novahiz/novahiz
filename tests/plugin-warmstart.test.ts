// Warm-start + teardown du daemon gate, vus depuis le vrai setup() du plugin.
//
// Contrat verifie ici :
//   1. setup() spawn le daemon sans aucun appel runGate (le premier appel
//      gate ne paie plus les ~300 ms de demarrage de processus).
//   2. le cleanup rendu par setup() tue ce daemon — sinon chaque
//      (re)chargement du plugin laisse un orphelin (observe le 2026-10-15 :
//      12 daemons orphelins sous opencode-cli.exe).
//   3. des cycles setup/cleanup repetes ne s'accumulent pas.
//
// Seuls les enfants de CE processus sont comptes : les orphelins d'opencode
// ont un autre parent et ne peuvent pas fausser la mesure.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Context } from "@opencode/plugin/promise/plugin";

// Le plugin fige son HOME dans des constantes de module au chargement
// (novahiz-plugin.ts L372-376): NOVAHIZ_HOME s'il est pose, sinon
// ~/.config/novahiz — d'ou CLI et DAEMON.
//
// Sans cela, le test cible ce que la machine a d'installe, pas cet arbre:
// - machine avec novahiz installe: ~/.config/novahiz existe, le daemon de
//   l'INSTALLATION spawn et les assertions passent — un faux positif qui ne
//   verifie aucun code du repo;
// - CI (checkout vierge): le repertoire n'existe pas, le spawn echoue et
//   `providers` sort en 1 ("Providers command failed (exit 1), MCP
//   auto-register skipped" precedait chaque echec) puis les deux assertions
//   tombent en timeout a 15 s.
//
// L'import est donc differe: un import statique serait hoiste et figerait
// HOME avant que cette affectation ne s'execute.
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
process.env.NOVAHIZ_HOME = REPO_ROOT;
const { default: novahizPlugin } = await import("../adapters/opencode/novahiz-plugin.ts");

function childGateDaemons(): number[] {
  try {
    if (process.platform === "win32") {
      // Name filtre cmd.exe/powershell.exe : leur propre ligne de commande
      // contient "gate-daemon" (c'est le filtre lui-meme) et ils sont enfants
      // de ce process — sans ce filtre la mesure se renderait toujours vraie.
      const out = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${process.pid}' | ` +
          `Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*gate-daemon*' }).ProcessId"`,
        { encoding: "utf8", windowsHide: true, timeout: 15_000 }
      );
      return out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line))
        .map(Number);
    }
    const out = execSync(`ps -o pid=,args= --ppid ${process.pid}`, {
      encoding: "utf8",
      timeout: 15_000
    });
    return out
      .split("\n")
      .filter((line) => line.includes("gate-daemon"))
      .map((line) => Number.parseInt(line.trim().split(/\s+/)[0], 10))
      .filter((pid) => Number.isFinite(pid));
  } catch {
    return [];
  }
}

async function waitFor(probe: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (probe()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// Context minimal : setup() n'appelle que ces quatre surface (adapters/
// opencode/novahiz-plugin.ts — mcp.transform L1525/L1552, event.subscribe
// L1581, session.hook L1613/L1737/L1763, tool.hook L1794/L1939).
function stubContext(): Context {
  const editor = { get: () => undefined, set: () => undefined };
  return {
    mcp: {
      transform: async (callback: (target: typeof editor) => void) => {
        callback(editor);
      }
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          if (signal.aborted) return;
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true })
          );
        }
      })
    },
    session: { hook: async () => undefined },
    tool: { hook: async () => undefined }
  } as unknown as Context;
}

test("warm-start: setup() spawn le daemon avant tout appel runGate", async () => {
  // Garde-fou contre le faux positif ci-dessus: si le test visait un autre
  // HOME, cette phrase echoue avec une explication au lieu de passer.
  assert.ok(
    existsSync(join(REPO_ROOT, "src", "gate-daemon.ts")),
    `le daemon vise est celui du repo (${join(REPO_ROOT, "src", "gate-daemon.ts")}), pas une installation`
  );
  assert.equal(
    childGateDaemons().length,
    0,
    "baseline nette attendue (aucun daemon enfant de ce process)"
  );
  const cleanup = await novahizPlugin.setup(stubContext());
  try {
    const spawned = await waitFor(() => childGateDaemons().length >= 1, 15_000);
    assert.ok(spawned, "daemon vivant juste apres setup(), sans aucun appel gate");
  } finally {
    if (typeof cleanup === "function") await cleanup();
  }
  const gone = await waitFor(() => childGateDaemons().length === 0, 10_000);
  assert.ok(gone, "le cleanup doit tuer le daemon qu'il a spawn");
});

test("reload: les cycles setup/cleanup ne laissent aucun daemon", async () => {
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    const cleanup = await novahizPlugin.setup(stubContext());
    try {
      const spawned = await waitFor(() => childGateDaemons().length >= 1, 15_000);
      assert.ok(spawned, `cycle ${cycle}: daemon spawn au chargement`);
    } finally {
      if (typeof cleanup === "function") await cleanup();
    }
  }
  const clean = await waitFor(() => childGateDaemons().length === 0, 10_000);
  assert.ok(clean, "apres 2 cycles, zero daemon orphelin de ce process");
});
