// Tests de la memoire automatique vault (V-AUTO) du plugin OpenCode :
// resolution du bloc memory.auto.vault (defauts full-on, bornes, kill-switch)
// et formatage des hits d'injection (buildVaultLines).
//
// Le plugin est importe tel quel — il n'enregistre aucun hook a l'import
// (seules des constantes et des fonctions exportees sont evaluees).

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildVaultLines, resolveMemoryAuto } from "../adapters/opencode/novahiz-plugin.ts";

describe("resolveMemoryAuto: defauts vault", () => {
  test("config absente -> vault active par defaut (actif partout)", () => {
    const resolved = resolveMemoryAuto(null, undefined);
    assert.ok(resolved, "memory auto actif par defaut");
    assert.deepEqual(resolved.vault, { enabled: true, k: 3, minScore: 0.25, every: 3, budgetTokens: 600 });
  });

  test("kill-switch NOVAHIZ_MEM_AUTO coupe aussi le vault", () => {
    assert.equal(resolveMemoryAuto(null, "off"), null);
    assert.equal(resolveMemoryAuto(null, "disabled"), null);
    assert.equal(resolveMemoryAuto(null, "0"), null);
  });

  test("memory.auto.vault.enabled=false coupe le vault, le reste survit", () => {
    const resolved = resolveMemoryAuto({ auto: { vault: { enabled: false } } }, undefined);
    assert.ok(resolved);
    assert.equal(resolved.vault.enabled, false);
    assert.equal(resolved.read.k, 3, "les defauts read restent intacts");
  });

  test("valeurs hors bornes retombent sur les defauts", () => {
    const resolved = resolveMemoryAuto({ auto: { vault: { k: 99, minScore: 5, every: 0, budgetTokens: 10 } } }, undefined);
    assert.ok(resolved);
    assert.deepEqual(resolved.vault, { enabled: true, k: 3, minScore: 0.25, every: 3, budgetTokens: 600 });
  });

  test("valeurs valides sont prises en compte", () => {
    const resolved = resolveMemoryAuto({ auto: { vault: { k: 5, minScore: 0.4, every: 1, budgetTokens: 900 } } }, undefined);
    assert.ok(resolved);
    assert.deepEqual(resolved.vault, { enabled: true, k: 5, minScore: 0.4, every: 1, budgetTokens: 900 });
  });
});

describe("buildVaultLines: formatage et filtres", () => {
  const cfg = { enabled: true, k: 3, minScore: 0.25, every: 3, budgetTokens: 600 };

  test("deux lignes par hit: chemin+titre puis extrait", () => {
    const { injectedRels, details } = buildVaultLines(
      [{ rel: "Trading/a.md", title: "Note A", score: 0.75, snippet: "contenu  utile   ici" }],
      cfg
    );
    assert.deepEqual(injectedRels, ["Trading/a.md"]);
    assert.equal(details.length, 2);
    assert.match(details[0], /- Trading\/a\.md \[0\.75\] — Note A/);
    assert.match(details[1], /^ {2}contenu utile ici$/);
  });

  test("k borne le nombre de hits injectes", () => {
    const hits = [1, 2, 3, 4, 5].map((i) => ({ rel: `n${i}.md`, title: `N${i}`, score: 0.9, snippet: "x" }));
    const { injectedRels } = buildVaultLines(hits, cfg);
    assert.equal(injectedRels.length, 3);
  });

  test("minScore filtre les hits trop faibles", () => {
    const hits = [
      { rel: "bon.md", title: "Bon", score: 0.5, snippet: "x" },
      { rel: "faible.md", title: "Faible", score: 0.1, snippet: "y" }
    ];
    const { injectedRels } = buildVaultLines(hits, cfg);
    assert.deepEqual(injectedRels, ["bon.md"]);
  });

  test("hit sans rel ou sans titre degrades proprement", () => {
    const { injectedRels, details } = buildVaultLines([{ rel: "", title: "X" }, { title: "sans rel" }], cfg);
    assert.equal(injectedRels.length, 0);
    assert.equal(details.length, 0);
    const ok = buildVaultLines([{ rel: "seul.md", score: 0.9 }], cfg);
    assert.deepEqual(ok.details, ["- seul.md [0.90] — seul.md"], "titre absent -> nom de fichier");
  });

  test("extrait tronque a 220 caracteres", () => {
    const long = "z".repeat(500);
    const { details } = buildVaultLines([{ rel: "a.md", title: "A", score: 1, snippet: long }], cfg);
    assert.equal(details[1].trim().length, 220);
  });
});
