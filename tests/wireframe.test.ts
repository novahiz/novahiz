// Tests du pipeline wireframe-first (2026-10-12): slugification, frontmatter,
// init idempotent, creation d'ecran et de sections, reconstruction de l'index
// depuis le disque, piece jointe shape et cycle de vie draft/approved/stale.
// Tout tourne en temporaire: aucun fichier reel touche.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import {
  attachScreen,
  createScreen,
  createSection,
  initWireframes,
  listScreens,
  markStatus,
  parseFrontmatter,
  rebuildIndex,
  slugify,
  wireframeDir
} from "../src/wireframe.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-wireframe-"));
  made.push(dir);
  return dir;
}

describe("wireframe: slugify / parseFrontmatter", () => {
  test("les accents et espaces deviennent des tirets", () => {
    assert.equal(slugify("Tableau de Bord Utilisateur"), "tableau-de-bord-utilisateur");
    assert.equal(slugify("  Écran d'accueil !  "), "ecran-d-accueil");
  });

  test("une chaine vide ou symbolique tombe sur 'screen'", () => {
    assert.equal(slugify("!!!"), "screen");
    assert.equal(slugify(""), "screen");
  });

  test("parseFrontmatter lit les scalaires", () => {
    const meta = parseFrontmatter("---\nid: accueil\ntitle: Accueil\nstatus: draft\n---\n\n# Accueil\n");
    assert.deepEqual(meta, { id: "accueil", title: "Accueil", status: "draft" });
  });

  test("parseFrontmatter rend un objet vide sans frontmatter", () => {
    assert.deepEqual(parseFrontmatter("# texte libre\n"), {});
  });
});

describe("wireframe: initWireframes", () => {
  test("cree wireframes/ + INDEX.md, puis est idempotent", () => {
    const project = tempDir();
    const first = initWireframes(project);
    assert.equal(first.created, true);
    assert.ok(existsSync(join(project, "wireframes", "INDEX.md")));
    const second = initWireframes(project);
    assert.equal(second.created, false);
    const index = readFileSync(join(project, "wireframes", "INDEX.md"), "utf8");
    assert.match(index, /Généré par novahiz/);
    assert.match(index, /\| Écran \| Sections \|/);
  });
});

describe("wireframe: createScreen / createSection", () => {
  test("un ecran porte ses sections dans l'ordre, avec skeleton rempli", () => {
    const project = tempDir();
    initWireframes(project);
    const result = createScreen(project, {
      name: "Catalogue formations",
      objective: "Permettre à l'apprenant de comparer et s'inscrire.",
      sections: ["En-tête et filtres", "Grille de formations", "Pagination"]
    });
    assert.equal(result.created, true);
    assert.equal(result.slug, "catalogue-formations");
    assert.equal(result.sectionFiles.length, 3);
    const screen = readFileSync(result.screenFile, "utf8");
    assert.match(screen, /En-tête et filtres.*01-en-tete-et-filtres\.md/);
    assert.match(screen, /status: draft/);
    const section = readFileSync(result.sectionFiles[0], "utf8");
    assert.match(section, /\*\*Intent\*\*/);
    assert.match(section, /\[ \] Empty/);
    assert.match(section, /\*\*reuse\*\*/);
  });

  test("createScreen n'ecrase jamais un ecran existant", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, { name: "Accueil", sections: ["Hero"] });
    const again = createScreen(project, { name: "Accueil", sections: ["Hero", "Pied"] });
    assert.equal(again.created, false);
    const screens = listScreens(project);
    assert.equal(screens[0].sections.length, 1, "le wireframe d'origine fait foi");
  });

  test("createSection refuse un ecran inconnu, append numerote sur le connu", () => {
    const project = tempDir();
    initWireframes(project);
    assert.throws(() => createSection(project, "fantome", "Section"), /écran inconnu/);
    createScreen(project, { name: "Profil", sections: ["Identité"] });
    const added = createSection(project, "profil", "Préférences");
    assert.equal(added.created, true);
    assert.match(added.file, /02-preferences\.md$/);
  });
});

describe("wireframe: rebuildIndex depuis le disque", () => {
  test("l'index reflete les ecrans et sections reels", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, { name: "Dashboard", sections: ["KPI", "Graphique"] });
    const indexFile = rebuildIndex(project);
    const index = readFileSync(indexFile, "utf8");
    assert.match(index, /\[Dashboard\]\(dashboard\/screen\.md\)/);
    assert.match(index, /01-kpi, 02-graphique/);
    assert.match(index, /## Sections/);
    assert.match(index, /\| Dashboard \| 01-kpi \| draft \|/);
  });
});

describe("wireframe: attachScreen (piece jointe impeccable shape)", () => {
  test("le bloc contient le screen et toutes ses sections", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, { name: "Recherche", objective: "Trouver une formation.", sections: ["Barre", "Résultats"] });
    const attached = attachScreen(project, "recherche");
    assert.equal(attached.files.length, 3, "screen.md + 2 sections");
    assert.match(attached.promptBlock, /spécification structurelle faisant foi/);
    assert.match(attached.promptBlock, /### wireframes\/recherche\/screen\.md/);
    assert.match(attached.promptBlock, /### wireframes\/recherche\/sections\/01-barre\.md/);
    assert.match(attached.promptBlock, /### wireframes\/recherche\/sections\/02-resultats\.md/);
  });

  test("attachScreen d'un ecran inconnu est une erreur claire", () => {
    const project = tempDir();
    initWireframes(project);
    assert.throws(() => attachScreen(project, "fantome"), /écran inconnu/);
  });
});

describe("wireframe: markStatus (cycle de vie)", () => {
  test("le statut et la date de mise a jour bougent, les autres non", () => {
    const project = tempDir();
    initWireframes(project);
    const { screenFile, sectionFiles } = createScreen(project, { name: "Paiement", sections: ["Formulaire"] });
    const marked = markStatus(project, "paiement", "approved");
    assert.equal(marked.status, "approved");
    assert.match(readFileSync(screenFile, "utf8"), /status: approved/);
    // Le statut de l'ecran ne touche pas a celui de la section.
    assert.match(readFileSync(sectionFiles[0], "utf8"), /status: draft/);
    const stale = markStatus(project, "paiement", "stale", "01-formulaire");
    assert.equal(stale.status, "stale");
    assert.match(readFileSync(sectionFiles[0], "utf8"), /status: stale/);
  });

  test("un statut hors cycle de vie est refuse", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, { name: "Connexion" });
    assert.throws(() => markStatus(project, "connexion", "final" as never), /statut invalide/);
  });
});

describe("wireframe: wireframeDir", () => {
  test("le dossier vit a la racine du projet", () => {
    assert.equal(wireframeDir("C:/proj/demo"), join("C:/proj/demo", "wireframes"));
  });
});
