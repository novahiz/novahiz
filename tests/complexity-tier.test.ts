// Tests golden du classifieur de complexite (2026-10-14).
//
// Verrouille deux families de regression a la fois:
//   - le fail-open francais: une creation d'ecran en FR devait passer en tier
//     full, sinon le wireframe ne se declenche jamais quand il faut (mesure
//     2026-10-14: "cree un ecran entier..." -> lite, "construis un formulaire
//     complexe" -> trivial).
//   - l'over-trigger: les motifs FR ne doivent PAS promouvoir une simple
//     mention de nom ("developpement", "generale") ni une micro-correction.
//
// Les banques de signaux sont anglophones par defaut; chaque cas porte sa
// langue pour qu'un trou soit visible d'un coup d'oeil.
import test from "node:test";
import assert from "node:assert/strict";
import { determineTier } from "../src/complexity.ts";

type Tier = "trivial" | "lite" | "full";

const CASES: { expect: Tier; lang: "FR" | "EN"; prompt: string }[] = [
  // Creations: DOIVENT monter en full (le wireframe s'y applique).
  { expect: "full", lang: "FR", prompt: "cree un ecran entier de gestion des commandes avec filtres et pagination" },
  { expect: "full", lang: "FR", prompt: "construis un formulaire d'inscription complexe en trois sections" },
  { expect: "full", lang: "FR", prompt: "cree la page de profil avec ses preferences" },
  { expect: "full", lang: "FR", prompt: "developpe un tableau de bord complet avec graphiques" },
  { expect: "full", lang: "FR", prompt: "realise la maquette du parcours de commande" },
  { expect: "full", lang: "EN", prompt: "create a full settings screen with sections for profile and billing" },
  { expect: "full", lang: "EN", prompt: "build a complete checkout flow with three steps" },

  // Micro-corrections: DOIVENT rester sous full (aucun pipeline design).
  { expect: "trivial", lang: "FR", prompt: "corrige le padding du header" },
  { expect: "trivial", lang: "FR", prompt: "ajoute 8px de marge a la carte" },
  { expect: "trivial", lang: "FR", prompt: "corrige l'alignement de la grille" },
  { expect: "trivial", lang: "FR", prompt: "renomme le composant Bouton" },
  { expect: "lite", lang: "FR", prompt: "change la couleur du bouton en bleu" },
  { expect: "lite", lang: "FR", prompt: "ajoute un bouton de connexion sur l'écran d'accueil" },
  { expect: "full", lang: "FR", prompt: "implémente un formulaire de connexion" },
  { expect: "lite", lang: "EN", prompt: "fix the button padding" },
  { expect: "lite", lang: "EN", prompt: "add a gap between the cards" },

  // Pieges d'over-trigger: une mention de nom n'est pas une action de creation.
  { expect: "trivial", lang: "FR", prompt: "corrige le texte general du header" },
  { expect: "trivial", lang: "FR", prompt: "note la developpement en cours" },
  // "met a jour" n'a pas d'equivalent dans la banque de reparation (delibere:
  // ajouter les verbes FR de correction ferait passer les micro-taches de
  // trivial a lite). L'assertion utile ici est "pas full".
  { expect: "trivial", lang: "FR", prompt: "met a jour la version generale" },
];

test("determineTier: creations FR/EN en full, micro-corrections sous full", () => {
  for (const c of CASES) {
    assert.equal(
      determineTier(c.prompt),
      c.expect,
      `[${c.lang}] "${c.prompt}" devrait etre ${c.expect}`
    );
  }
});

test("determineTier: aucun cas du jeu ne retombe en dessous de son tier attendu", () => {
  // Garde-fou directionnel: une regression qui ABaisse un tier est un
  // fail-open (le pipeline saute); celle qui LEVE un tier n'est qu'un surcout.
  const RANK: Record<Tier, number> = { trivial: 0, lite: 1, full: 2 };
  for (const c of CASES) {
    assert.ok(
      RANK[determineTier(c.prompt)] >= RANK[c.expect],
      `[${c.lang}] "${c.prompt}" est tombe en ${determineTier(c.prompt)} (attendu >= ${c.expect})`
    );
  }
});
