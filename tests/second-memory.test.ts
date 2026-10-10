// Tests de l'arborescence fixe : routage (matchNode / routePath), audit
// structurel (auditStructure) et contrat de bout en bout de `second-memory doctor`.
//
// Deux niveaux :
//  - unitaires, en mémoire, sur le moteur exporté ;
//  - E2E, en invoquant le CLI sur un vault jetable (NOVAHIZ_SM_VAULT), parce que
//    le contrat réel d'un vault — arborescence produite + codes de sortie — ne
//    se voit pas depuis l'intérieur du module.
//
// Aucun vault réel n'est lu ni écrit : tout part dans le répertoire temporaire.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { auditStructure, isCategoryDir, matchNode, rewriteIndexCategories, routePath, structureMarkdown, updateLinksAfterRename } from "../src/commands/second-memory.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "src", "cli.ts");

// Avant le premier appel à loadStructure() (lazy, donc l'import ci-dessus suffit).
process.env.NOVAHIZ_HOME = repoRoot;

const made: string[] = [];
const emptyMemory = mkdtempSync(join(tmpdir(), "novahiz-sm-mem-"));
made.push(emptyMemory);
// Racine mémoire bornée pour tout le processus : readBinding/routePath ne doit
// jamais lire le vault.json de la machine hôte (déterminisme + hermétisme).
process.env.NOVAHIZ_SM_MEMORY = emptyMemory;

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
}

/** Un dossier vault vide, unique à ce test. */
function vaultOf(prefix: string): string {
  const vault = join(tempDir(prefix), "vault");
  mkdirSync(vault, { recursive: true });
  return vault;
}

function writeNote(vault: string, rel: string, title: string, body: string): void {
  const file = join(vault, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\ntype: resource\ntitle: ${title}\n---\n\n# ${title}\n\n${body}\n`, "utf8");
}

type Run = { code: number; stdout: string; stderr: string };

function run(args: string[], vault: string): Run {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      NOVAHIZ_HOME: repoRoot,
      NOVAHIZ_SM_VAULT: vault,
      NOVAHIZ_SM_MEMORY: emptyMemory
    }
  });
  return { code: r.status ?? -1, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
}

const output = (r: Run): string => `${r.stdout}${r.stderr}`;

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

// --- matchNode ---------------------------------------------------------------

const node = (name: string, keywords: string[]): { name: string; kind: "domain"; keywords: string[] } => ({
  name,
  kind: "domain",
  keywords
});
/** Le texte arrive normalisé et entouré d'espaces, comme le fait routePath. */
const pad = (text: string): string => ` ${text.toLowerCase()} `;

describe("matchNode", () => {
  const domains = [node("Code", ["api", "code"]), node("Security", ["owasp", "securite", "audit"])];

  test("le score l'emporte sur l'ordre du catalogue", () => {
    const hit = matchNode(domains, pad("Audit OWASP et api"));
    assert.equal(hit.matched, true);
    assert.equal(hit.node?.name, "Security", "2 hits Security contre 1 hit Code");
    assert.equal(hit.score, 2);
  });

  test("aucun hit → repli sur le premier nœud, matched à false", () => {
    const hit = matchNode(domains, pad("rien a voir"));
    assert.equal(hit.matched, false);
    assert.equal(hit.score, 0);
    assert.equal(hit.node?.name, "Code");
  });

  test("égalité de score → l'ordre du catalogue tranche", () => {
    const tie = matchNode([node("A", ["guide"]), node("B", ["api"])], pad("guide et api"));
    assert.equal(tie.score, 1);
    assert.equal(tie.node?.name, "A");
  });

  test("frontière de mot: 'app' ne matche pas dans 'apple'", () => {
    const one = [node("Code", ["app"])];
    assert.equal(matchNode(one, pad("apple pie")).matched, false);
    assert.equal(matchNode(one, pad("une app de test")).matched, true);
  });
});

// --- routePath ---------------------------------------------------------------

describe("routePath", () => {
  /** Chemin du segment final (les segments sont cumulatifs). */
  const rel = (text: string, kind: "memory" | "docs" | "journal" | "decisions" | "auto" = "auto", project?: string): string => {
    const segments = routePath(text, kind, project);
    return segments.length === 0 ? "" : segments[segments.length - 1].rel;
  };

  test("domaine → branche → feuille → projet", () => {
    assert.equal(rel("Revue de securite checklist OWASP et api"), "Security/Audits/docs/general");
  });

  test("un mot-clé de branche seul route vers son domaine", () => {
    assert.equal(rel("Flutter state management"), "Code/Mobile/memory/general");
  });

  test("sans signal de domaine → aucun chemin (la note part en Inbox)", () => {
    assert.deepEqual(routePath("Pain, lait, fromage.", "auto"), []);
  });

  test("feuille 'notes': ni memory/docs ni niveau projet", () => {
    assert.equal(rel("matin journal"), "Journal/Daily");
  });

  test("le kind forcé docs ignore les mots-clés", () => {
    assert.equal(rel("Flutter state management", "docs"), "Code/Mobile/docs/general");
  });

  test("le projet frontmatter est slugifié, vide → general", () => {
    assert.equal(rel("Flutter state management", "auto", "Mon Projet"), "Code/Mobile/memory/mon-projet");
    assert.equal(rel("Flutter state management", "auto"), "Code/Mobile/memory/general");
  });

  test("les segments sont cumulatifs, c'est ce qu'enchaîne ensureTarget", () => {
    const segments = routePath("Revue de securite checklist OWASP et api", "auto");
    assert.deepEqual(
      segments.map((segment) => segment.rel),
      ["Security", "Security/Audits", "Security/Audits/docs", "Security/Audits/docs/general"]
    );
  });

  test("journal keywords → feuille journal de la branche (projet compris)", () => {
    assert.equal(rel("flutter carnet debrief"), "Code/Mobile/journal/general");
  });

  test("decisions keywords → feuille decisions (l'emporte sur journal)", () => {
    assert.equal(rel("flutter decision arbitrage carnet"), "Code/Mobile/decisions/general");
  });

  test("le kind forcé journal/decisions ignore les mots-clés", () => {
    assert.equal(rel("Flutter state management", "journal"), "Code/Mobile/journal/general");
    assert.equal(rel("Flutter state management", "decisions"), "Code/Mobile/decisions/general");
  });

  test("binding projet : la branche liée l'emporte sur les mots-clés ; périmé → repli", () => {
    const mem = tempDir("novahiz-sm-bind-");
    const previous = process.env.NOVAHIZ_SM_MEMORY;
    process.env.NOVAHIZ_SM_MEMORY = mem;
    try {
      writeFileSync(
        join(mem, "vault.json"),
        JSON.stringify({ "lie-projet": { domain: "Trading", branch: "Strategies" } }),
        "utf8"
      );
      // Sans binding, « flutter » route vers Code/Mobile ; le binding prime.
      assert.equal(rel("flutter state management", "auto", "Lie Projet"), "Trading/Strategies/memory/lie-projet");
      // Binding périmé (domaine hors catalogue) : repli exact sur le routage par mots-clés.
      writeFileSync(
        join(mem, "vault.json"),
        JSON.stringify({ "lie-projet": { domain: "Nope", branch: "Nope" } }),
        "utf8"
      );
      assert.equal(rel("flutter state management", "auto", "Lie Projet"), "Code/Mobile/memory/lie-projet");
    } finally {
      if (previous === undefined) delete process.env.NOVAHIZ_SM_MEMORY;
      else process.env.NOVAHIZ_SM_MEMORY = previous;
    }
  });
});

// --- auditStructure ----------------------------------------------------------

describe("auditStructure", () => {
  /** Vault minimal conforme : squelette système + INDEX aux catégories vides. */
  function skeleton(): string {
    const vault = tempDir("novahiz-sm-audit-");
    for (const folder of ["Inbox", "Archive", "Templates", "Excalidraw"]) mkdirSync(join(vault, folder), { recursive: true });
    writeFileSync(join(vault, "INDEX.md"), "# Second Memory\n\n## Categories\n\n## System\n", "utf8");
    writeFileSync(join(vault, "log.md"), "# Log\n", "utf8");
    // Le canonique, pas un stub : sinon le vault « conforme » signalerait
    // structureDrift (contenu différent du catalogue) dès la première ligne.
    writeFileSync(join(vault, "STRUCTURE.md"), structureMarkdown(), "utf8");
    return vault;
  }

  test("vault conforme → audit entièrement vide", () => {
    assert.deepEqual(auditStructure(skeleton()), {
      missing: [],
      rootNotes: [],
      unknownFolders: [],
      foldersWithoutMoc: [],
      unlinked: [],
      partialDomains: [],
      indexDrift: [],
      structureDrift: false
    });
  });

  test("STRUCTURE.md dont le contenu dérive du catalogue → structureDrift", () => {
    const vault = skeleton();
    // Une édition à la main (ou un catalogue mis à jour) écarte le gravé du
    // canonique : doctor doit le voir et le régénérer.
    writeFileSync(join(vault, "STRUCTURE.md"), "# Vault structure\n\nAncienne carte.\n", "utf8");
    assert.equal(auditStructure(vault).structureDrift, true);

    writeFileSync(join(vault, "STRUCTURE.md"), structureMarkdown(), "utf8");
    assert.equal(auditStructure(vault).structureDrift, false, "le canonique restauré ne dérive plus");
  });

  test("les dates du frontmatter ne comptent pas comme une dérive", () => {
    const vault = skeleton();
    // Même carte écrite un autre jour : seul `updated:` change, ce n'est pas
    // une dérive de contenu.
    const otherDay = structureMarkdown().replace(/^updated:.*$/m, "updated: 2020-01-01");
    writeFileSync(join(vault, "STRUCTURE.md"), otherDay, "utf8");
    assert.equal(auditStructure(vault).structureDrift, false);
  });

  test("dossier absent → missing", () => {
    const audit = auditStructure(tempDir("novahiz-sm-audit-"));
    for (const expected of ["INDEX.md", "STRUCTURE.md", "Inbox", "Archive", "Templates"]) {
      assert.ok(audit.missing.includes(expected), `devrait signaler ${expected}`);
    }
  });

  test("log.md disparu → signalé dans missing (le fichier systeme compte)", () => {
    const vault = skeleton();
    rmSync(join(vault, "log.md"), { force: true });

    const audit = auditStructure(vault);
    assert.ok(audit.missing.includes("log.md"), "log.md doit figurer dans missing");
    assert.deepEqual(audit.missing, ["log.md"], "rien d'autre n'a disparu");
  });

  test("isCategoryDir exclut les dossiers systeme du catalogue, pas seulement les 3 historiques", () => {
    // Excalidraw est declare systemFolder dans le catalogue : il ne doit pas
    // etre traite comme une categorie (c'est ce qui injectait son MOC dans
    // ## Categories et bloquait doctor a exit 1).
    assert.equal(isCategoryDir("Excalidraw"), false);
    assert.equal(isCategoryDir("Inbox"), false);
    assert.equal(isCategoryDir("Archive"), false);
    assert.equal(isCategoryDir("Templates"), false);
    assert.equal(isCategoryDir("Trading"), true, "un domaine du catalogue reste une categorie");
    assert.equal(isCategoryDir(".obsidian"), false, "les dossiers caches sont exclus");
  });

  test("note racine, MOC manquant et INDEX qui dérive sont tous détectés", () => {
    const vault = skeleton();
    writeNote(vault, "loose.md", "Loose", "du contenu");
    mkdirSync(join(vault, "Code", "Mobile"), { recursive: true });
    writeFileSync(join(vault, "INDEX.md"), "# Second Memory\n\n## Categories\n- [[Inbox/_MOC|Inbox MOC]]\n", "utf8");

    const audit = auditStructure(vault);
    assert.deepEqual(audit.rootNotes, ["loose.md"]);
    // Les deux niveaux sont sans MOC, les deux sont réparables : le parent
    // manquant ne masque jamais l'enfant.
    assert.deepEqual(audit.foldersWithoutMoc, ["Code", "Code/Mobile"]);
    assert.ok(audit.indexDrift.includes("INDEX missing [[Code/_MOC|Code MOC]]"));
    assert.ok(audit.indexDrift.includes("INDEX stray [[Inbox/_MOC|Inbox MOC]]"));
  });

  test("dossier hors catalogue signalé, dossiers système laissés tranquilles", () => {
    const vault = skeleton();
    mkdirSync(join(vault, "Cours"), { recursive: true });

    const audit = auditStructure(vault);
    assert.deepEqual(audit.unknownFolders, ["Cours"]);
    // Hors catalogue, la seule réparation automatisable est son MOC (le
    // déplacement reste manuel — ce champ n'entre donc pas dans `remaining`).
    // Inbox/Archive/Templates, eux, n'entrent dans aucune des deux listes.
    assert.deepEqual(audit.foldersWithoutMoc, ["Cours"]);
    assert.deepEqual(audit.rootNotes, []);
    assert.deepEqual(audit.missing, []);
  });

  test("domaine à moitié construit → partialDomains", () => {
    const vault = skeleton();
    mkdirSync(join(vault, "Code", "Mobile"), { recursive: true });
    writeFileSync(join(vault, "Code", "_MOC.md"), "# Code MOC\n", "utf8");
    writeFileSync(join(vault, "Code", "Mobile", "_MOC.md"), "# Mobile MOC\n", "utf8");

    const audit = auditStructure(vault);
    assert.equal(audit.partialDomains.length, 1);
    assert.match(audit.partialDomains[0], /^Code \(\d+ folder\(s\) missing\)$/);
  });
});

// --- rewriteIndexCategories (convergence de doctor --apply) --------------------

describe("rewriteIndexCategories", () => {
  test("cree la section si absente — sinon --apply ne converge jamais", () => {
    const vault = tempDir("novahiz-sm-index-");
    writeFileSync(join(vault, "INDEX.md"), "# Second Memory\n\n## System\n- [[Inbox]]\n", "utf8");

    rewriteIndexCategories(vault, "## Categories", ["[[Trading/_MOC|Trading MOC]]"]);

    const index = readFileSync(join(vault, "INDEX.md"), "utf8");
    assert.ok(index.includes("## Categories"), "la section doit etre creee");
    assert.ok(index.includes("- [[Trading/_MOC|Trading MOC]]"));
    assert.ok(
      index.indexOf("## Categories") < index.indexOf("## System"),
      "inseree avant ## System pour respecter la place convenue"
    );
  });

  test("reecrit la section si presente, en retirant les liens obsoletes", () => {
    const vault = tempDir("novahiz-sm-index-");
    writeFileSync(
      join(vault, "INDEX.md"),
      "# Second Memory\n\n## Categories\n- [[Old/_MOC|Old MOC]]\n\n## System\n- [[Inbox]]\n",
      "utf8"
    );

    rewriteIndexCategories(vault, "## Categories", ["[[Trading/_MOC|Trading MOC]]"]);

    const index = readFileSync(join(vault, "INDEX.md"), "utf8");
    assert.ok(index.includes("- [[Trading/_MOC|Trading MOC]]"));
    assert.ok(!index.includes("[[Old/_MOC"), "le lien obsolete doit disparaitre");
  });
});

// --- updateLinksAfterRename (liens apres renommage) -------------------------

describe("updateLinksAfterRename", () => {
  test("un rename met a jour les liens qui pointaient sur l'ancien nom", () => {
    const vault = tempDir("novahiz-sm-relink-");
    writeNote(vault, "00-README.md", "Test", "contenu");
    writeNote(vault, "index.md", "Index", "voir [[00-README]] et [[00-README|alias]] puis [[00-README#section]]");

    const updated = updateLinksAfterRename(vault, "00-README.md", "00-readme.md");

    const index = readFileSync(join(vault, "index.md"), "utf8");
    assert.ok(index.includes("[[00-readme]]"), "le lien basename doit etre mis a jour");
    assert.ok(index.includes("[[00-readme|alias]]"), "le lien avec alias doit etre mis a jour");
    assert.ok(index.includes("[[00-readme#section]]"), "le lien avec ancre doit etre mis a jour");
    assert.ok(!index.includes("[[00-README]]"), "l'ancien lien doit disparaitre");
    assert.ok(updated.includes("index.md"), "le fichier modifie doit etre rapporte");
  });

  test("un rename de chemin met a jour les liens en forme chemin complet", () => {
    const vault = tempDir("novahiz-sm-relink-");
    mkdirSync(join(vault, "Trading", "Strategies", "docs"), { recursive: true });
    writeNote(vault, "Trading/Strategies/docs/00-README.md", "Test", "contenu");
    writeNote(vault, "Trading/Strategies/docs/_MOC.md", "MOC", "- [[Trading/Strategies/docs/00-README]]");

    updateLinksAfterRename(vault, "Trading/Strategies/docs/00-README.md", "Trading/Strategies/docs/00-readme.md");

    const moc = readFileSync(join(vault, "Trading", "Strategies", "docs", "_MOC.md"), "utf8");
    assert.ok(moc.includes("[[Trading/Strategies/docs/00-readme]]"), "le lien chemin complet doit etre mis a jour");
    assert.ok(!moc.includes("00-README"), "l'ancien nom doit disparaitre");
  });
});

// --- doctor, de bout en bout -------------------------------------------------

describe("second-memory doctor (bout en bout)", () => {
  test("init crée le squelette canonique et est idempotent", () => {
    const vault = vaultOf("novahiz-sm-e2e-");
    const first = run(["second-memory", "init", "--no-plugins"], vault);
    assert.equal(first.code, 0, output(first));

    for (const item of ["INDEX.md", "log.md", "STRUCTURE.md", "Inbox", "Archive", "Templates", "Templates/project.md"]) {
      assert.ok(existsSync(join(vault, item)), `manquant après init: ${item}`);
    }
    assert.ok(!existsSync(join(vault, ".obsidian")), "--no-plugins ne doit rien télécharger");

    const second = run(["second-memory", "init", "--no-plugins"], vault);
    assert.equal(second.code, 0, output(second));
    assert.match(output(second), /already initialized/);
  });

  test("log.md supprimé: doctor sort en 1, --apply le recrée et retombe à 0", () => {
    const vault = vaultOf("novahiz-sm-e2e-");
    run(["second-memory", "init", "--no-plugins"], vault);
    assert.ok(existsSync(join(vault, "log.md")));
    rmSync(join(vault, "log.md"), { force: true });

    const dry = run(["second-memory", "doctor", "--no-plugins", "--json"], vault);
    assert.equal(dry.code, 1, `un fichier systeme absent doit faire sortir en 1: ${output(dry)}`);
    assert.ok((JSON.parse(dry.stdout) as { remaining: number }).remaining >= 1);
    assert.match((JSON.parse(dry.stdout) as { checks: Array<{ name: string; detail: string }> }).checks
      .find((check) => check.name === "skeleton")?.detail ?? "", /log\.md/);

    // La réparation existe déjà : missing non vide → initVault (L1795-1799).
    const apply = run(["second-memory", "doctor", "--apply", "--no-plugins", "--json"], vault);
    assert.equal(apply.code, 0, `--apply doit converger: ${output(apply)}`);
    assert.ok(existsSync(join(vault, "log.md")), "log.md doit avoir été recréé");
  });

  test("STRUCTURE.md écarté du catalogue: doctor sort en 1, --apply le régénère", () => {
    const vault = vaultOf("novahiz-sm-e2e-");
    run(["second-memory", "init", "--no-plugins"], vault);
    const file = join(vault, "STRUCTURE.md");
    // Corruption minimale (une ligne en fin de fichier) : ni le frontmatter,
    // ni le H1, ni les liens — seul le contenu gravé dérive du canonique.
    writeFileSync(file, `${readFileSync(file, "utf8")}\nCarte éditée à la main.\n`, "utf8");

    const dry = run(["second-memory", "doctor", "--no-plugins", "--json"], vault);
    assert.equal(dry.code, 1, `une carte dérivée doit faire sortir en 1: ${output(dry)}`);
    const dryReport = JSON.parse(dry.stdout) as { actions: string[] };
    assert.ok(
      dryReport.actions.some((action) => action.includes("would regenerate STRUCTURE.md")),
      `le dry-run doit l'annoncer: ${JSON.stringify(dryReport.actions)}`
    );

    const apply = run(["second-memory", "doctor", "--apply", "--no-plugins", "--json"], vault);
    assert.equal(apply.code, 0, `--apply doit converger: ${output(apply)}`);
    const applyReport = JSON.parse(apply.stdout) as { actions: string[] };
    assert.ok(
      applyReport.actions.some((action) => action.includes("regenerated STRUCTURE.md")),
      `--apply doit régénérer: ${JSON.stringify(applyReport.actions)}`
    );
    const regenerated = readFileSync(file, "utf8");
    assert.match(regenerated, /^---\ntype: doc\ntitle: Vault structure/m, "le canonique est réécrit");
    assert.equal(regenerated.includes("Carte éditée à la main."), false, "la édition manuelle a disparu");
  });

  test("renommage casse seule: un fichier majuscule passe en minuscules (faux positif Windows)", () => {
    const vault = vaultOf("novahiz-sm-e2e-");
    run(["second-memory", "init", "--no-plugins"], vault);
    // Le cas reel du bug : un fichier avec majuscules dans un dossier categorie.
    writeNote(vault, "Trading/Strategies/docs/00-README.md", "Test", "contenu");

    const apply = run(["second-memory", "doctor", "--apply", "--no-plugins", "--json"], vault);
    assert.equal(apply.code, 0, output(apply));
    assert.ok(
      existsSync(join(vault, "Trading", "Strategies", "docs", "00-readme.md")),
      "le fichier doit etre renomme en minuscules"
    );
  });

  // Garde-fou : un fichier déclaré `systemFile` mais jamais créé par init rend
  // tout diagnostic non convergent (cas README.md, corrigé le 2026-10-07).
  test("systemFiles du catalogue ⊆ fichiers réellement créés par init", () => {
    const catalog = JSON.parse(readFileSync(join(repoRoot, "catalog", "vault-structure.json"), "utf8")) as {
      systemFiles: string[];
    };
    assert.ok(Array.isArray(catalog.systemFiles) && catalog.systemFiles.length > 0);

    const vault = vaultOf("novahiz-sm-e2e-");
    const init = run(["second-memory", "init", "--no-plugins"], vault);
    assert.equal(init.code, 0, output(init));

    for (const file of catalog.systemFiles) {
      assert.ok(existsSync(join(vault, file)), `${file} est déclaré systemFile mais init ne le crée pas`);
    }
  });

  test("exit 1 tant qu'une note reste à la racine, exit 0 après --apply", () => {
    const vault = vaultOf("novahiz-sm-e2e-");
    run(["second-memory", "init", "--no-plugins"], vault);
    writeNote(vault, "note-vide.md", "Courses du samedi", "Pain, lait, fromage.");

    const dry = run(["second-memory", "doctor", "--no-plugins", "--json"], vault);
    assert.equal(dry.code, 1, `un doctor sur un vault non conforme doit sortir en 1: ${output(dry)}`);
    assert.equal((JSON.parse(dry.stdout) as { remaining: number }).remaining, 1);

    const apply = run(["second-memory", "doctor", "--apply", "--no-plugins", "--json"], vault);
    assert.equal(apply.code, 0, output(apply));
    assert.ok(existsSync(join(vault, "Inbox", "note-vide.md")), "note sans signal garee dans Inbox, pas a la racine");
    assert.ok(!existsSync(join(vault, "note-vide.md")), "la note a bien quitte la racine");

    const again = run(["second-memory", "doctor", "--no-plugins", "--json"], vault);
    assert.equal(again.code, 0, `le vault repare doit retomber a 0: ${output(again)}`);
    assert.equal((JSON.parse(again.stdout) as { remaining: number }).remaining, 0);
  });

  test("routage de bout en bout: chaque note a son emplacement predetermine", () => {
    const vault = vaultOf("novahiz-sm-e2e-");
    run(["second-memory", "init", "--no-plugins"], vault);

    const expected: Record<string, string> = {
      "a-owasp.md": "Security/Audits/docs/general/a-owasp.md",
      "b-flutter.md": "Code/Mobile/memory/general/b-flutter.md",
      "c-journal.md": "Journal/Daily/c-journal.md",
      "d-sidecar.md": "DevOps/Infra/memory/general/d-sidecar.md",
      "e-crypto.md": "Trading/Strategies/memory/general/e-crypto.md",
      "f-figma.md": "Design/Interface/memory/general/f-figma.md"
    };
    const bodies: Record<string, [string, string]> = {
      "a-owasp.md": ["Revue de securite checklist OWASP", "Audit de l'API et durcissement."],
      "b-flutter.md": ["Flutter state management", "Comment empecher les rebuilds inutiles."],
      "c-journal.md": ["Rappel dentiste", "Appeler le cabinet mardi matin."],
      "d-sidecar.md": ["Pattern sidecar", "Le sidecar porte le proxy du pod, proxy kubernetes."],
      "e-crypto.md": ["Strategie crypto", "Setup de trading sur le marche, backtest."],
      "f-figma.md": ["Maquette Figma", "Ecran et layout du dashboard, navigation."]
    };
    for (const [rel, [title, body]] of Object.entries(bodies)) writeNote(vault, rel, title, body);

    const apply = run(["second-memory", "doctor", "--apply", "--no-plugins", "--json"], vault);
    assert.equal(apply.code, 0, output(apply));

    for (const [note, rel] of Object.entries(expected)) {
      assert.ok(existsSync(join(vault, rel)), `${note} aurait du atterrir en ${rel}`);
      assert.ok(!existsSync(join(vault, note)), `${note} ne doit plus etre a la racine`);
    }

    // Un seul point d'entree: l'INDEX ne liste que les domaines actifs.
    const index = readFileSync(join(vault, "INDEX.md"), "utf8");
    for (const domain of ["Code", "Trading", "Design", "DevOps", "Security", "Journal"]) {
      assert.ok(index.includes(`- [[${domain}/_MOC|${domain} MOC]]`), `INDEX doit lier ${domain}`);
    }
    assert.ok(!index.includes("[[Inbox/_MOC"), "les dossiers systeme n'entrent pas dans ## Categories");

    // Chaque dossier cree possede son MOC et est relie a son parent.
    for (const folder of ["Code", "Code/Mobile", "Code/Mobile/memory", "Security", "Security/Audits"]) {
      assert.ok(existsSync(join(vault, folder, "_MOC.md")), `${folder} sans _MOC.md`);
    }

    const lint = run(["second-memory", "lint"], vault);
    assert.equal(lint.code, 0, output(lint));
    assert.match(output(lint), /no issues found/);
  });
});

// --- project-init -------------------------------------------------------------

describe("project-init", () => {
  const branch = ["--branch", "Code/Mobile"];

  test("dry-run n'écrit rien ; --apply crée docs/journal/decisions + binding ; idempotent", () => {
    const vault = vaultOf("novahiz-sm-pinit-");
    run(["second-memory", "init", "--no-plugins"], vault);

    const dry = run(["second-memory", "project-init", "--name", "Projet Test", ...branch], vault);
    assert.equal(dry.code, 0, output(dry));
    assert.match(output(dry), /would create folder/);
    assert.ok(!existsSync(join(vault, "Code", "Mobile", "docs", "projet-test")), "dry-run ne crée rien");

    const apply = run(["second-memory", "project-init", "--name", "Projet Test", ...branch, "--apply"], vault);
    assert.equal(apply.code, 0, output(apply));
    for (const leaf of ["docs", "journal", "decisions"]) {
      assert.ok(
        existsSync(join(vault, "Code", "Mobile", leaf, "projet-test", "_MOC.md")),
        `${leaf}/projet-test sans _MOC.md`
      );
    }
    assert.ok(!existsSync(join(vault, "Code", "Mobile", "memory", "projet-test")), "pas de dossier memory/ pour un projet");

    const binding = JSON.parse(readFileSync(join(emptyMemory, "vault.json"), "utf8")) as Record<
      string,
      { domain: string; branch: string }
    >;
    assert.equal(binding["projet-test"]?.domain, "Code");
    assert.equal(binding["projet-test"]?.branch, "Mobile");

    const again = run(["second-memory", "project-init", "--name", "Projet Test", ...branch, "--apply"], vault);
    assert.equal(again.code, 0, output(again));
    assert.match(output(again), /exists: Code\/Mobile\/docs\/projet-test/);
  });

  test("branche inconnue → exit 1, aucune création", () => {
    const vault = vaultOf("novahiz-sm-pinit2-");
    run(["second-memory", "init", "--no-plugins"], vault);
    const bad = run(["second-memory", "project-init", "--name", "Autre", "--branch", "Code/Nope", "--apply"], vault);
    assert.equal(bad.code, 1, output(bad));
    assert.match(output(bad), /unknown branch/);
    assert.ok(!existsSync(join(vault, "Code", "Nope")), "aucune création sur branche inconnue");
  });

  test("sans signal de branche → exit 1 avec le conseil --branch", () => {
    const vault = vaultOf("novahiz-sm-pinit3-");
    run(["second-memory", "init", "--no-plugins"], vault);
    const r = run(["second-memory", "project-init", "--name", "ZorglubXyz"], vault);
    assert.equal(r.code, 1, output(r));
    assert.match(output(r), /--branch/);
  });
});

// --- sync : la mémoire projet reste locale ------------------------------------

describe("sync: archive du miroir ancien", () => {
  test("archive les notes miroir, preserve l'import inverse, idempotent", () => {
    const vault = vaultOf("novahiz-sm-sync2-");
    run(["second-memory", "init", "--no-plugins"], vault);
    const dir = join(vault, "Code", "Mobile", "memory", "general");
    mkdirSync(dir, { recursive: true });
    // Note miroir de l'ancien sync (novahiz_slot_id, pas d'opt-in) : à archiver.
    writeFileSync(
      join(dir, "slot-001-note.md"),
      "---\ntype: resource\ntitle: miroir\nnovahiz_slot_id: slot-001\nnovahiz_synced_at: \"2026-10-08T10:00:00.000Z\"\n---\n\n# miroir\n",
      "utf8"
    );
    // Note importée depuis le vault (opt-in) : elle reste, c'est une note utilisateur.
    writeFileSync(
      join(dir, "importee.md"),
      "---\ntype: resource\ntitle: importee\nnovahiz_slot_id: slot-042\nnovahiz_slot_sync: true\n---\n\n# importee\n",
      "utf8"
    );

    const dry = run(["second-memory", "sync"], vault);
    assert.equal(dry.code, 0, output(dry));
    assert.match(output(dry), /would archive project-memory note: Code\/Mobile\/memory\/general\/slot-001-note\.md/);
    assert.ok(!output(dry).includes("importee"), "la note importée ne doit pas être archivée");

    const apply = run(["second-memory", "sync", "--apply"], vault);
    assert.equal(apply.code, 0, output(apply));
    assert.ok(!existsSync(join(dir, "slot-001-note.md")), "la note miroir doit être archivée");
    assert.ok(existsSync(join(dir, "importee.md")), "la note importée reste dans le vault");
    assert.ok(readdirSync(join(vault, "Archive", ".backup")).length >= 1, "sauvegarde sous Archive/.backup");

    const again = run(["second-memory", "sync"], vault);
    assert.equal(again.code, 0, output(again));
    assert.match(output(again), /no project-memory notes in the vault/);

    const doctor = run(["second-memory", "doctor", "--no-plugins"], vault);
    assert.match(output(doctor), /memory: no project-memory notes/);
  });
});
