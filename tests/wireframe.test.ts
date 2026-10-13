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
  createSections,
  initWireframes,
  listScreens,
  markStatus,
  parseFrontmatter,
  planSections,
  rebuildIndex,
  reviewScreen,
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

describe("wireframe: sections oubliees et decision mono/multi", () => {
  test("un ecran cree sans sections porte le signal et un plan, jamais un succes silencieux", () => {
    const project = tempDir();
    initWireframes(project);
    const bare = createScreen(project, { name: "Tableau de bord" });
    assert.equal(bare.created, true);
    assert.equal(bare.needsSections, true, "l'ecran sans sections doit le dire");
    assert.equal(bare.sectionFiles.length, 0);
    assert.equal(bare.plan.screenClass, "list");
    assert.equal(bare.plan.needsMultiple, true, "un tableau de bord est multi-sections");

    // La recuperation en un seul appel: on part du plan propose.
    const filled = createSections(project, bare.slug, bare.plan.sections);
    assert.ok(filled.created.length >= 3, "le plan doit proposer au moins 3 sections");
    assert.equal(filled.indexRebuilds, 1, "une seule reconstruction d'index pour tout le lot");

    const after = createScreen(project, { name: "Tableau de bord" });
    assert.equal(after.needsSections, false, "l'ecran est maintenant complet");
    assert.equal(after.created, false);
    assert.ok(after.sectionFiles.length >= 3, "le retour anticipe doit refeter l'etat reel du disque");
    assert.equal(reviewScreen(project, "tableau-de-bord").verdict, "pass");
  });

  test("un trou dans la numerotation ne reutilise plus un index deja pris", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, { name: "Profil", sections: ["Identite", "Preferences", "Securite"] });
    rmSync(join(project, "wireframes", "profil", "sections", "02-preferences.md"));
    const added = createSection(project, "profil", "Notifications");
    assert.equal(added.created, true);
    // 01 et 03 sont pris: le suivant est 04, pas le compte (3) deja utilise.
    assert.match(added.file, /04-notifications\.md$/);
  });

  test("createSections est idempotente et n'ecrase jamais", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, { name: "Recherche", sections: ["Barre"] });
    const first = createSections(project, "recherche", ["Barre", "Resultats"]);
    assert.deepEqual(first.created, ["Resultats"], "Barre existe deja");
    assert.equal(first.existing.length, 1);
    const again = createSections(project, "recherche", ["Resultats"]);
    assert.equal(again.created.length, 0);
    assert.equal(listScreens(project)[0].sections.length, 2, "aucune section dupliquee");
  });

  test("planSections classe et justifie, sans pretendre avoir raison", () => {
    const form = planSections("Paiement", "Regler une commande en trois etapes.");
    assert.equal(form.screenClass, "form");
    assert.equal(form.needsMultiple, true);
    assert.equal(form.minimum, 3);
    assert.ok(form.reasons.length >= 3, "chaque decision porte sa justification");
    assert.match(form.reasons.join(" "), /classe « form »/);
    assert.equal(form.heuristic, true, "le caractere heuristique est declare");

    const unknown = planSections("Zzzq");
    assert.equal(unknown.screenClass, "default");
    assert.equal(unknown.needsMultiple, false);
    assert.match(unknown.reasons.join(" "), /aucun element de classe reconnu/);
  });
});

describe("wireframe: reviewScreen (revue critique)", () => {
  test("un ecran sans sections est signale, pas ignore", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, { name: "Catalogue" });
    const review = reviewScreen(project, "catalogue");
    assert.equal(review.verdict, "gaps");
    assert.equal(review.gaps[0].id, "no-section");
    assert.ok(review.questions.length >= 5, "la revue impose ses questions critiques");
    assert.equal(review.heuristic, true);
  });

  test("la revue nomme chaque section manquante et dit pourquoi", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, { name: "Liste de courses", sections: ["Contexte et filtres"] });
    const review = reviewScreen(project, "liste-de-courses");
    assert.equal(review.verdict, "gaps");
    const labels = review.gaps.map((gap) => gap.label);
    assert.ok(labels.includes("Contenu principal"), "le contenu principal doit etre nomme");
    assert.ok(labels.includes("Etats vides et pagination"), "l'etat vide doit etre nomme");
    assert.ok(review.gaps.every((gap) => gap.why.length > 0), "aucun manque sans justification");
  });

  test("un ecran complet passe la revue", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, {
      name: "Paiement",
      sections: ["Champs et saisie", "Validation et erreurs", "Confirmation"]
    });
    const review = reviewScreen(project, "paiement");
    assert.equal(review.verdict, "pass");
    assert.equal(review.gaps.length, 0);
    assert.equal(review.sectionCount, 3);
    assert.equal(review.screenClass, "form");
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
    const { screenFile, sectionFiles } = createScreen(project, {
      name: "Paiement",
      sections: ["Champs et saisie", "Validation et erreurs", "Confirmation"]
    });
    const marked = markStatus(project, "paiement", "approved");
    assert.equal(marked.status, "approved");
    assert.match(readFileSync(screenFile, "utf8"), /status: approved/);
    // Le statut de l'ecran ne touche pas a celui de la section.
    assert.match(readFileSync(sectionFiles[0], "utf8"), /status: draft/);
    const stale = markStatus(project, "paiement", "stale", "01-champs-et-saisie");
    assert.equal(stale.status, "stale");
    assert.match(readFileSync(sectionFiles[0], "utf8"), /status: stale/);
  });

  test("approved est refuse tant qu'une section importante manque", () => {
    const project = tempDir();
    initWireframes(project);
    createScreen(project, { name: "Paiement", sections: ["Formulaire"] });
    assert.throws(
      () => markStatus(project, "paiement", "approved"),
      (error: Error) => {
        assert.match(error.message, /approbation refusee/);
        assert.match(error.message, /Validation et erreurs/);
        assert.match(error.message, /action="sections"/);
        return true;
      },
      "le blocage doit nommer la section manquante et la commande pour la creer"
    );
    // Un ecran complet, lui, passe: le blocage n'est pas decoratif.
    createSections(project, "paiement", ["Validation et erreurs", "Confirmation"]);
    assert.equal(markStatus(project, "paiement", "approved").status, "approved");
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
