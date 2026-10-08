// install/ui.mjs — interface d'installation Novahiz.
//
// Deux modes, decides a l'execution :
//   - "anim" : terminal TTY (ou NOVAHIZ_UI=anim force) — banniere coloree,
//     barre de progression vivante re-dessinee sur la derniere ligne, une
//     ligne permanente par etape terminee avec duree, details indentes ;
//   - "plain" : sortie pipee (npm redirige les scripts, CI, NO_COLOR) — journal
//     pas-à-pas, une ligne par etape, aucune sequence d'ecran. Une animation
//     avec \r dans un pipe recrache des dizaines de lignes de bruit : on ne
//     l'essaie jamais hors TTY.
//
// Toute l'ecriture passe par `write` (injectable) : les tests capturent la
// sortie sans toucher au stdout reel.

import { readFileSync } from "node:fs";

const ESC = "\x1b[";
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Polices banniere : FIGlet `banner` (Ryan Youck, distribution standard,
// BSD-3). Choix motive par la recherche (labascii/figlet.org) : police ASCII
// pure -> lisibles dans TOUS les terminaux (pas de blocs Unicode variables de
// largeur selon la police du terminal, ni de codepage a casser), style
// "gros titre" pour un wordmark. 7 lignes, ~57 colonnes, tient en 80.
export const BANNER_COLORS = ["36", "38;5;75", "38;5;105", "38;5;141", "38;5;171", "38;5;201", "35"];

export const BANNER = [
  " #     # ####### #     #    #    #     # ### #######",
  " ##    # #     # #     #   # #   #     #  #       #",
  " # #   # #     # #     #  #   #  #     #  #      #",
  " #  #  # #     # #     # #     # #######  #     #",
  " #   # # #     #  #   #  ####### #     #  #    #",
  " #    ## #     #   # #   #     # #     #  #   #",
  " #     # #######    #    #     # #     # ### #######"
];

export function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Barre de progression pure : `renderBar(0.42, 20)` -> "[████████░░░░░░░░░░░░]" */
export function renderBar(ratio, width) {
  const w = Math.max(1, Math.trunc(width));
  const clamped = Math.min(1, Math.max(0, ratio));
  const filled = Math.round(clamped * w);
  return `[${"█".repeat(filled)}${"░".repeat(w - filled)}]`;
}

/** Mode d'affichage : plain sauf TTY (ou forçage NOVAHIZ_UI). */
export function resolveMode(env = process.env, isTTY = process.stdout.isTTY === true) {
  if (env.NOVAHIZ_UI === "plain") return "plain";
  if (env.NOVAHIZ_UI === "anim") return "anim";
  if (env.CI === "true") return "plain";
  return isTTY ? "anim" : "plain";
}

function colorsEnabled(env = process.env, mode = "plain") {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return true;
  return mode === "anim";
}

/**
 * Cree l'interface d'installation.
 *
 * @param {object} opts
 * @param {string[]} opts.steps   libelles d'etapes, dans l'ordre d'execution
 * @param {boolean} [opts.dryRun] prefixe "[dry-run] " sur les details
 * @param {(text: string) => void} [opts.write] cible d'ecriture (tests)
 * @param {number} [opts.columns] largeur de terminal (tests)
 */
export function createInstallerUI(opts = {}) {
  const steps = Array.isArray(opts.steps) ? opts.steps : [];
  const dryRun = Boolean(opts.dryRun);
  const env = opts.env ?? process.env;
  const mode = opts.mode ?? resolveMode(env);
  const colors = colorsEnabled(env, mode);
  const write = typeof opts.write === "string" ? (text) => opts.write.push(text) : opts.write ?? ((text) => process.stdout.write(text));

  let index = -1; // etape courante (-1 = hors etape)
  let currentLabel = "";
  let stepStart = 0;
  const totalStart = Date.now();
  let liveShown = false;
  let suspended = false;
  let frame = 0;
  let finished = false;

  const paint = (code, text) => (colors ? `${ESC}${code}m${text}${ESC}0m` : text);
  const columns = () => {
    if (typeof opts.columns === "number" && opts.columns > 0) return opts.columns;
    return process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  };
  const elapsed = (since) => {
    const s = (Date.now() - since) / 1000;
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  };
  const prefix = () => (dryRun ? "[dry-run] " : "");
  const doneCount = () => index + 1;
  const counterText = () => {
    const total = steps.length > 0 ? steps.length : doneCount();
    return `${Math.min(doneCount(), total)}/${total}`;
  };
  const ratio = () => {
    if (steps.length === 0) return 0;
    return Math.min(1, doneCount() / steps.length);
  };

  // --- ligne vivante (mode anim uniquement) --------------------------------
  function liveLine() {
    const pct = Math.round(ratio() * 100);
    const width = Math.max(8, Math.min(28, columns() - 46));
    const bar = renderBar(ratio(), width);
    const spin = paint("36", SPINNER[frame % SPINNER.length]);
    return `  ${spin} ${bar} ${String(pct).padStart(3)}%  ${counterText().padStart(6)}  ${currentLabel}`;
  }
  function clearLive() {
    if (liveShown) {
      write(`\r${ESC}2K`);
      liveShown = false;
    }
  }
  function renderLive() {
    if (mode !== "anim" || !liveShown || suspended) return;
    write(`\r${ESC}2K${liveLine()}`);
  }
  /** Efface la ligne vivante le temps d'ecrire du contenu permanent. */
  function withLivePaused(fn) {
    const wasShown = liveShown;
    clearLive();
    fn();
    if (wasShown) {
      liveShown = true;
      renderLive();
    }
  }
  function permanent(text) {
    withLivePaused(() => write(`${text}\n`));
  }

  /** Detail sous l'etape courante (les appels `note()` historiques). */
  function note(message) {
    const text = `${prefix()}${message}`;
    permanent(index >= 0 ? `    ${text}` : `  ${text}`);
  }
  /** Sort brute multi-lignes (stdout de sous-process capture). */
  function raw(text) {
    if (!text) return;
    for (const line of String(text).split(/\r?\n/)) {
      if (line.trim().length > 0) permanent(`    ${line}`);
    }
  }

  // --- cycle de vie ---------------------------------------------------------
  /** Banniere : art FIGlet `banner`, ou repli compact si le terminal est trop etroit. */
  function banner() {
    const version = opts.version ?? packageVersion();
    const artWidth = 2 + Math.max(...BANNER.map((row) => row.length));
    const cols = columns();
    if (cols < artWidth + 2) {
      // Repli lisible : jamais de retour a la ligne au milieu du wordmark.
      write(`  ${paint("1;36", `NOVAHIZ v${version}`)}\n`);
      write(`  ${paint("2", "deterministic workflow for OpenCode")}\n\n`);
      return;
    }
    const lines = [];
    BANNER.forEach((row, i) => lines.push(`  ${paint(BANNER_COLORS[i], row)}`));
    lines.push(`  ${paint("2", `deterministic workflow for OpenCode — v${version}`)}`);
    lines.push("");
    write(`${lines.join("\n")}\n`);
  }

  /** Debut d'etape : cloture la precedente (duree) puis affiche la nouvelle. */
  function step(label) {
    finishStep("done");
    index += 1;
    currentLabel = label;
    stepStart = Date.now();
    if (mode === "anim") {
      frame++;
      liveShown = true;
      renderLive();
    } else {
      write(`  ${paint("36", "▸")} ${paint("2", `[${counterText()}]`)} ${label}\n`);
    }
  }

  function finishStep(status, detail) {
    if (index < 0 || stepStart === 0) return;
    const took = elapsed(stepStart);
    stepStart = 0;
    const symbol =
      status === "skip"
        ? paint("2", "–")
        : status === "warn"
          ? paint("33", "!")
          : status === "fail"
            ? paint("31", "✖")
            : paint("32", "✔");
    const suffix = detail ? ` — ${detail}` : "";
    if (mode === "anim") {
      // la ligne vivante est effacee puis remplacee par la ligne permanente
      withLivePaused(() =>
        write(`  ${symbol} ${paint("2", `[${counterText()}]`)} ${currentLabel} ${paint("2", `(${took})`)}${suffix}\n`)
      );
    } else {
      write(`  ${symbol} ${paint("2", `[${counterText()}]`)} ${currentLabel} ${paint("2", `(${took})`)}${suffix}\n`);
    }
  }

  /** Passe en suspension : un enfant stdio:inherit va ecrire lui-meme. */
  function suspend() {
    if (mode !== "anim") return;
    clearLive();
    suspended = true;
  }
  function resume() {
    if (mode !== "anim") return;
    suspended = false;
    if (index >= 0 && stepStart !== 0) {
      liveShown = true;
      renderLive();
    }
  }

  /** Termine la derniere etape puis imprime le bloc final. */
  function finish(summaryLines = []) {
    if (finished) return;
    finished = true;
    finishStep("done");
    clearLive();
    if (summaryLines.length > 0) write("\n");
    for (const line of summaryLines) write(`  ${line}\n`);
    if (summaryLines.length > 0) write("\n");
    const total = elapsed(totalStart);
    const bar = renderBar(1, 16);
    write(`  ${paint("32", "✔")} ${paint("1;36", "installation complete")} ${paint("2", `${bar} 100%  (${total})`)}\n`);
  }

  return { banner, step, note, raw, suspend, resume, finish, finishStep, resolveMode: () => mode, colors: () => colors };
}
