// Tests de l'interface d'installation (install/ui.mjs) : rendu de la
// banniere NOVAHIZ, barre de progression, bascule anim/plain, couleurs et
// repli terminal etroit. Tout passe par un writer injecte — aucun stdout
// reel, aucun fichier touche.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BANNER, createInstallerUI, packageVersion, renderBar, resolveMode } from "../install/ui.mjs";

const STEPS = ["Alpha", "Beta", "Gamma"];

function collect(opts: Record<string, unknown> = {}) {
  const out: string[] = [];
  const ui = createInstallerUI({ steps: STEPS, write: (text: string) => out.push(text), ...opts });
  return { ui, out, text: () => out.join("") };
}

describe("renderBar", () => {
  test("remplissage proportionnel", () => {
    assert.equal(renderBar(0, 10), "[░░░░░░░░░░]");
    assert.equal(renderBar(0.5, 10), "[█████░░░░░]");
    assert.equal(renderBar(1, 10), "[██████████]");
  });

  test("bornes : au-dela de 0/1 et largeur mini", () => {
    assert.equal(renderBar(-3, 4), "[░░░░]");
    assert.equal(renderBar(42, 4), "[████]");
    assert.equal(renderBar(0.5, 0), "[█]");
  });
});

describe("resolveMode", () => {
  test("TTY -> anim, pipe -> plain, CI -> plain", () => {
    assert.equal(resolveMode({}, true), "anim");
    assert.equal(resolveMode({}, false), "plain");
    assert.equal(resolveMode({ CI: "true" }, true), "plain");
  });

  test("NOVAHIZ_UI force le mode dans les deux sens", () => {
    assert.equal(resolveMode({ NOVAHIZ_UI: "anim" }, false), "anim");
    assert.equal(resolveMode({ NOVAHIZ_UI: "plain" }, true), "plain");
  });
});

describe("banniere NOVAHIZ (police FIGlet banner, ASCII pur)", () => {
  test("l'art contient les 7 lettres et tient en 80 colonnes", () => {
    // Signatures stables de la police banner pour NOVAHIZ (figlet smush :
    // pas de grille fixe, on accroche des motifs qui n'existent que si les
    // 7 glyphes sont bien presents). Attention : destructuration par
    // POSITION -> on indexe explicitement.
    const l0 = BANNER[0];
    const l3 = BANNER[3];
    const l5 = BANNER[5];
    const l6 = BANNER[6];
    assert.match(l0, /#######/, "O et Z en haut");
    assert.match(l3, /#######/, "croisillon du H");
    assert.match(l5, /# {4}##/, "pied diagonal du N en bas");
    assert.match(l6, /#######/, "base O + boucle basse du Z");
    assert.ok(BANNER.length >= 7, "7 lignes de glyphes");
    const width = Math.max(...BANNER.map((row: string) => row.length));
    assert.ok(width <= 57, `largeur ${width} <= 57 pour tenir en 80 colonnes`);
    // ASCII pur : aucun caractere Unicode (bloc/ligne) ne peut casser selon
    // la police du terminal.
    for (const row of BANNER) assert.match(String(row), /^[\x20-\x7e]+$/, "ligne ASCII uniquement");
  });

  test("banner() imprime l'art + tagline dans le mode plain", () => {
    const { ui, text } = collect({ mode: "plain", env: {} });
    ui.banner();
    const rendered = text();
    assert.ok(rendered.includes("deterministic workflow for OpenCode"));
    assert.ok(rendered.includes(`v${packageVersion()}`));
    assert.match(rendered, /# {6}#/, "art present");
    assert.equal(rendered.includes("\x1b["), false, "plain = pas d'ANSI");
  });

  test("terminal etroit -> repli compact, le wordmark reste lisible", () => {
    const { ui, text } = collect({ mode: "plain", env: {}, columns: 40 });
    ui.banner();
    const rendered = text();
    assert.equal(rendered.includes("#######"), false, "pas d'art qui retournerait a la ligne");
    assert.match(rendered, /NOVAHIZ v\d+\.\d+\.\d+/, "wordmark compact present");
  });
});

describe("flux plain : une ligne par etape", () => {
  test("▶ start, ✔ duree, details, resume final", () => {
    const { ui, text } = collect({ mode: "plain", env: {} });
    ui.banner();
    ui.step("Alpha");
    ui.note("detail alpha");
    ui.step("Beta");
    ui.finishStep("warn", "partiel");
    ui.step("Gamma");
    ui.resume();
    ui.finish(["Tout est OK."]);
    const rendered = text();
    assert.match(rendered, /▸ \[1\/3\] Alpha/);
    assert.match(rendered, / {4}detail alpha/);
    assert.match(rendered, /✔ \[1\/3\] Alpha \(\d+\.\d+s\)/);
    assert.match(rendered, /! \[2\/3\] Beta .* — partiel/);
    assert.match(rendered, /✔ \[3\/3\] Gamma/);
    assert.match(rendered, / {2}Tout est OK\./);
    assert.match(rendered, /installation complete .*100%/);
    assert.equal(rendered.includes("\r"), false, "pas d'animation dans le pipe");
  });

  test("prefixe dry-run sur les details", () => {
    const { ui, text } = collect({ mode: "plain", env: {}, dryRun: true });
    ui.step("Alpha");
    ui.note("copie");
    assert.match(text(), /\[dry-run\] copie/);
  });
});

describe("flux anim : ligne vivante re-dessinee", () => {
  test("CR + effacement + pourcentage + nettoyage final", () => {
    const { ui, text } = collect({ mode: "anim", env: {}, columns: 80 });
    ui.banner();
    ui.step("Alpha");
    ui.note("pendant");
    ui.step("Beta");
    ui.step("Gamma");
    ui.finish(["Fini."]);
    const rendered = text();
    assert.ok(rendered.includes("\r\x1b[2K"), "ligne vivante effacee/redessinee");
    assert.match(rendered, /\d{3}%\s+\d\/3\s+Gamma/, "pourcentage + compteur + libelle");
    assert.match(rendered, /█/, "barre de progression");
    assert.match(rendered, /Fini\./);
    // La sequence finale efface la ligne vivante PUIS imprime le resume :
    // le dernier CR est donc avant "Fini.", jamais au milieu.
    const lastCr = rendered.lastIndexOf("\r");
    assert.ok(lastCr < rendered.indexOf("Fini."), "nettoyage avant le resume");
    assert.ok(rendered.slice(lastCr).includes("Fini."), "resume apres le nettoyage");
  });

  test("suspend/resume : pas de tracage pendant un enfant inherit", () => {
    const { ui, text } = collect({ mode: "anim", env: {}, columns: 80 });
    ui.step("Alpha");
    ui.suspend();
    ui.note("enfant");
    ui.resume();
    ui.step("Beta");
    ui.finish([]);
    const rendered = text();
    // le detail ecrit pendant la suspension reste une ligne permanente
    assert.match(rendered, / {4}enfant/);
    // les codes ANSI entourent symboles et metadonnees : on strippe avant
    // de tester le contenu.
    const plain = rendered.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(plain.includes("✔"), "symbole de succes");
    assert.ok(plain.includes("[1/3] Alpha"), "etape Alpha cloturee");
  });
});

describe("couleurs", () => {
  test("NO_COLOR supprime tout escape ANSI", () => {
    const { ui, text } = collect({ mode: "anim", env: { NO_COLOR: "1" }, columns: 80 });
    ui.banner();
    ui.step("Alpha");
    ui.finish([]);
    assert.equal(text().includes("\x1b[3"), false, "pas de codes couleur");
  });

  test("mode anim colore par defaut", () => {
    const { ui, text } = collect({ mode: "anim", env: {}, columns: 80 });
    ui.banner();
    assert.ok(text().includes("\x1b[36m"), "cyan sur la premiere ligne");
  });
});
