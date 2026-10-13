// Pipeline wireframe-first (2026-10-12): création et maintenance du dossier
// `wireframes/` d'un projet. Le wireframe est la spécification structurelle
// faisant foi AVANT toute construction d'écran ou de section:
//
//   wireframes/
//     INDEX.md                      <- table de tous les écrans (reconstruite)
//     <screen-slug>/
//       screen.md                   <- structure globale de l'écran
//       sections/01-<section>.md    <- wireframe détaillé par section
//
// `attachScreen` produit la pièce jointe fournie au prompt d'impeccable shape
// (contenu complet, pas un simple chemin): shape en sort avec le brief
// d'Interaction and layout déjà spécifié.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type WireframeStatus = "draft" | "approved" | "stale";

export const WIREFRAME_STATUSES: WireframeStatus[] = ["draft", "approved", "stale"];

export function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "screen";
}

// Frontmatter YAML minimal (clé: valeur) — les fichiers wireframes sont
// produits par ce module, le parser n'a besoin que des scalaires.
export function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index > 0) out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return out;
}

function now(): string {
  return new Date().toISOString();
}

export function wireframeDir(project: string): string {
  return join(project, "wireframes");
}

export type SectionSummary = {
  id: string;
  title: string;
  status: string;
  file: string;
};

export type ScreenSummary = {
  slug: string;
  title: string;
  status: string;
  version: string;
  updated: string;
  file: string;
  sections: SectionSummary[];
};

// Inventaire lu depuis le disque (source de vérité), pas depuis un état.
export function listScreens(project: string): ScreenSummary[] {
  const root = wireframeDir(project);
  if (!existsSync(root)) return [];
  const screens: ScreenSummary[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const screenFile = join(root, entry.name, "screen.md");
    if (!existsSync(screenFile)) continue;
    const meta = parseFrontmatter(readFileSync(screenFile, "utf8"));
    const sectionsDir = join(root, entry.name, "sections");
    const sections: SectionSummary[] = [];
    if (existsSync(sectionsDir)) {
      for (const file of readdirSync(sectionsDir).filter((name) => name.endsWith(".md")).sort()) {
        const content = readFileSync(join(sectionsDir, file), "utf8");
        const sectionMeta = parseFrontmatter(content);
        sections.push({
          id: sectionMeta.id ?? file.replace(/\.md$/, ""),
          title: sectionMeta.title ?? file,
          status: sectionMeta.status ?? "draft",
          file: `wireframes/${entry.name}/sections/${file}`
        });
      }
    }
    screens.push({
      slug: entry.name,
      title: meta.title ?? entry.name,
      status: meta.status ?? "draft",
      version: meta.version ?? "1",
      updated: meta.updated ?? meta.created ?? "",
      file: `wireframes/${entry.name}/screen.md`,
      sections
    });
  }
  return screens;
}

// Idempotent: crée le dossier et l'index s'ils manquent, ne réécrit jamais un
// INDEX.md existant (rebuildIndex est la voie de mise à jour).
export function initWireframes(project: string): { dir: string; created: boolean } {
  const dir = wireframeDir(project);
  const created = !existsSync(dir);
  mkdirSync(dir, { recursive: true });
  const indexFile = join(dir, "INDEX.md");
  if (!existsSync(indexFile)) {
    writeFileSync(indexFile, renderIndex([]), "utf8");
  }
  return { dir, created };
}

const SECTION_TEMPLATE = (screenSlug: string, index: number, id: string, title: string, date: string): string => `---
id: ${String(index).padStart(2, "0")}-${id}
title: ${title}
kind: section
screen: ${screenSlug}
status: draft
version: 1
created: ${date}
updated: ${date}
---

# ${title}

## Rôle dans l'écran

À compléter: pourquoi cette section existe et ce qu'elle doit faire comprendre ou faire.

## Éléments

| Id | Élément | Type | Annotation |
| --- | --- | --- | --- |
| e1 | ... | text/bouton/champ/liste/carte/... | voir Annotations |

## Annotations

Une annotation par élément interactif, ancrée à l'élément (jamais à l'écran):

### e1

- **Intent**: pourquoi cet élément existe ici.
- **Behavior**: quand l'utilisateur X, le système répond Y (états, transitions, validation).
- **Constraints**: limites (min/max, troncature, débordement).

## États (obligatoires: compléter chaque ligne)

- [ ] Default
- [ ] Loading
- [ ] Empty
- [ ] Error
- [ ] Permission
- [ ] Responsive (comportement par breakpoint)

## Composants

- **reuse**: composants existants réutilisés ici (nom exact du composant).
- **new-component**: candidats à l'extraction en composant réutilisable.
`;

const SCREEN_TEMPLATE = (slug: string, title: string, objective: string, date: string, sections: string[]): string => `---
id: ${slug}
title: ${title}
kind: screen
status: draft
version: 1
created: ${date}
updated: ${date}
---

# ${title}

## Objectif

${objective || "À compléter: pour qui, quel problème, quel résultat attendu."}

## Flux

- **Entrée**: d'où l'utilisateur arrive-t-il.
- **Sortie principale**: quelle action termine l'écran.
- **Sorties secondaires**: navigations et échappatoires.

## Layout (ordre des sections)

${sections.length > 0
    ? sections.map((name, index) => `${index + 1}. **${name}** → \`sections/${String(index + 1).padStart(2, "0")}-${slugify(name)}.md\``).join("\n")
    : "À compléter: liste ordonnée des sections de l'écran."}

## États globaux de l'écran

- [ ] Loading global
- [ ] Empty global
- [ ] Error globale
- [ ] Permission refusée

## Breakpoints

- **Mobile (< 640px)**: à préciser par section.
- **Desktop (>= 1024px)**: à préciser par section.

## Pièce jointe shape

Ce dossier est joint tel quel au prompt d'impeccable shape (voir skill novahiz-wireframe, reference/shape-handoff.md). Toute divergence entre le code et ce wireframe remet le statut à \`stale\` puis le wireframe est mis à jour.
`;

// ---------------------------------------------------------------------------
// Planification et revue critique des sections
// ---------------------------------------------------------------------------
//
// CONTRAT HONNETE: ce qui suit est une REGLE DETERMINISTE, pas un esprit
// critique. Un script ne peut pas inventer de design. Ce qu'il peut faire, et
// ce qu'il fait ici:
//
//   1. classer l'ecran et declarer quelles sections une experience complete
//      exige — c'est objectivement lisible dans le titre et l'objectif;
//   2. rendre la revue OBLIGATOIRE: reviewScreen est appelee par markStatus
//      quand on demande `approved`, donc l'etape de reflexion ne peut pas etre
//      sautee. Le script garantit que la question est posee; c'est l'agent qui
//      y repond, section par section (CRITICAL_QUESTIONS).
//
// Toute suggestion est donc a CONFIRMER par l'agent, jamais appliquee en
// silence: `heuristic: true` le signale dans chaque resultat.

export type ScreenClass = "list" | "form" | "detail" | "settings" | "default";

export type SectionExpectation = {
  id: string;
  label: string;
  match: RegExp;
  why: string;
};

export type ClassRule = {
  id: ScreenClass;
  match: RegExp;
  min: number;
  reason: string;
  expectations: SectionExpectation[];
};

// Sans accents ni casse, et avec les traits d'union ramenes a un espace:
// "en-tete" doit tomber sur "en tete", sinon aucun motif a frontiere de mot
// ne l'aura jamais. Un espace conserve une frontiere la ou un remplacement
// par rien en supprimerait une ("liste" de "liste-de-courses").
const normalizeForMatch = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-–—]/g, " ");

// Les motifs declarent les FLEXIONS: \bconfirm\b refuse "confirmation",
// \bchamp\b refuse "champs", \bfiltre\b refuse "filtres". Chaque radical est
// donc suivi d'un pluriel ou d'un derive explicite, jamais d'une frontiere
// possee sur la forme de base seule.
const CLASS_RULES: ClassRule[] = [
  {
    id: "form",
    match: /\b(formulaire|inscription|connexion|login|sign\s?in|sign\s?up|signup|paiement|commande|checkout|payment|creer|creation|ajouter|ajout|editer|modifier|saisie|questionnaire|demande|onboarding)\b/,
    min: 3,
    reason:
      "un formulaire a trois responsabilites distinctes: saisir les champs, signaler les erreurs, confirmer le resultat. Les fusionner produit un ecran qui devient illisible des qu'une validation echoue",
    expectations: [
      { id: "fields", label: "Champs et saisie", match: /\b(champs?|saisie|formulaire|input|donnees?|identite|coordonnees?|adresse|informations?|fields?)\b/, why: "sans section de saisie, les champs n'ont pas de place assignee dans le layout" },
      { id: "validation", label: "Validation et erreurs", match: /\b(validation|erreurs?|errors?|retours?|messages?|alertes?|invalid|correction)\b/, why: "l'etat d'erreur est obligatoire: le template l'exige, et c'est la ou un formulaire echoue le plus souvent" },
      { id: "confirmation", label: "Confirmation ou recapitulatif", match: /\b(confirmations?|recapitulatif|recap|syntheses?|resumes?|verifications?|success|succes|revue|bilans?|rappels?)\b/, why: "sans confirmation, l'utilisateur ne sait jamais si l'action a reussi" },
    ],
  },
  {
    id: "list",
    match: /\b(liste|catalogue|tableau|resultat|recherche|search|dashboard|accueil|home|feed|grille|index|parcourir|browse|galerie|gallery|collection|kpi|statistique)\b/,
    min: 3,
    reason:
      "un listing a trois regions: cadrer la recherche, lister le contenu, gerer le vide et la pagination. Sans les trois, la page est deserte des que la requete ne renvoie rien",
    expectations: [
      { id: "context", label: "Contexte et filtres", match: /\b(contextes?|filtres?|tris?|recherches?|barres?|entetes?|en tete|header|onglets?|criteres?|navigation|sous titres?|suggestions?)\b/, why: "sans filtre ni entete, l'utilisateur ne peut pas restreindre un grand jeu de donnees" },
      { id: "content", label: "Contenu principal", match: /\b(contenus?|listes?|grilles?|resultats?|items?|catalogues?|cards?|cartes|lignes|principal|corps|body|elements?|donnees)\b/, why: "le listing lui-meme: c'est la raison d'etre de l'ecran" },
      { id: "empty", label: "Etats vides et pagination", match: /\b(vides?|empty|aucun|paginations?|pages?|suivant|chargements?|loading|suite|etats?)\b/, why: "l'etat vide est la ou les listings sont oublies, et le template l'exige" },
    ],
  },
  {
    id: "settings",
    match: /\b(parametre|reglage|preference|configuration|settings|compte|account|profil|profile|admin|gestion|securite|notification|confidentialite)\b/,
    min: 2,
    reason:
      "des reglages exigent un groupement thematique ET un retour d'enregistrement: sans le second, l'utilisateur ne sait pas si ses changements ont ete pris en compte",
    expectations: [
      { id: "grouping", label: "Groupes de reglages", match: /\b(groupes?|reglages?|parametres?|preferences?|blocs?|categories?|panneaux?|panels?|listes?|sections?)\b/, why: "des reglages disperses sans groupement sont impossibles a parcourir" },
      { id: "feedback", label: "Enregistrement et retour", match: /\b(enregistrement|enregistres?|sauvegardes?|save|appliques?|appliquer|retours?|confirmations?|valides?|sauvegarder)\b/, why: "sans retour d'enregistrement, l'utilisateur recharge la page pour savoir si ca a marche" },
    ],
  },
  {
    id: "detail",
    match: /\b(detail|fiche|article|post|vue|view|story|evenement|event|message|notification|commentaire|comment|lecture|read)\b/,
    min: 2,
    reason:
      "une fiche se lit en deux temps: situer l'objet (entete, contexte), puis agir dessus (actions). Une seule section force les deux dans le meme bloc",
    expectations: [
      { id: "header", label: "En-tete et contexte", match: /\b(entetes?|en tete|header|contextes?|titres?|meta|dates?|auteurs?|navigation|retour|fils?|illustrations?)\b/, why: "sans entete, l'utilisateur ne sait pas ou il est en revenant d'un lien" },
      { id: "body", label: "Contenu et actions", match: /\b(contenus?|corps|body|textes?|descriptions?|actions?|boutons?|buttons?|partager|editer|repondre|principal|lecture|pieces?|fichiers?)\b/, why: "le corps de la fiche et les actions qu'on peut mener dessus" },
    ],
  },
];

const DEFAULT_RULE: ClassRule = {
  id: "default",
  match: /^/,
  min: 1,
  reason:
    "aucune classe reconnue dans le titre ou l'objectif: le minimum structurel s'applique, et la question d'une seconde section reste ouverte",
  expectations: [],
};

// Questions que la revue exige d'avoir traitees avant approbation. Le script ne
// peut pas y repondre: il garantit qu'elles sont posees, et c'est l'agent qui
// les traite section par section.
const CRITICAL_QUESTIONS = [
  "Qui arrive sur cet ecran, et depuis quelle page precedente? Que doit-il comprendre en trois secondes?",
  "Que voit-on s'il n'y a AUCUNE donnee a afficher? (etat vide: message et action proposee)",
  "Que se passe-t-il si le chargement echoue ou que le reseau tombe? Quel etat voit l'utilisateur?",
  "Quelle est l'action principale de l'ecran, et est-elle reversible? Une confirmation est-elle necessaire?",
  "Que devient chaque section a 375px de large? Qu'est-ce qui passe en premier, qu'est-ce qui disparait?",
  "Quelle information manque encore pour que ce wireframe soit livrable sans question supplementaire?",
];

function ruleFor(name: string, objective?: string): { rule: ClassRule; matchedBy: string | null } {
  const haystack = normalizeForMatch(`${name} ${objective ?? ""}`);
  for (const rule of CLASS_RULES) {
    const found = haystack.match(rule.match);
    if (found) return { rule, matchedBy: found[0] };
  }
  return { rule: DEFAULT_RULE, matchedBy: null };
}

function screenBySlug(project: string, slug: string): ScreenSummary {
  const screen = listScreens(project).find((entry) => entry.slug === slug);
  if (!screen) throw new Error(`écran inconnu: ${slug}`);
  return screen;
}

export type PlanSectionsResult = {
  slug: string;
  screenClass: ScreenClass;
  needsMultiple: boolean;
  sections: string[];
  reasons: string[];
  minimum: number;
  matchedBy: string | null;
  heuristic: true;
};

// Suggestion mono/multi avec raisons. Rien n'est ecrit sur disque: l'agent
// confirme ou corrige, puis passe les sections retenues a createScreen.
export function planSections(name: string, objective?: string): PlanSectionsResult {
  const { rule, matchedBy } = ruleFor(name, objective);
  const reasons = [
    matchedBy
      ? `classe « ${rule.id} » deduite du titre ou de l'objectif (element reconnu: « ${matchedBy} »)`
      : `aucun element de classe reconnu dans « ${name} », classe par defaut appliquee`,
    rule.reason,
    rule.min > 1
      ? `minimum structurel de ${rule.min} sections pour cette classe`
      : `une seule section suffit structurellement pour cette classe`,
  ];
  return {
    slug: slugify(name),
    screenClass: rule.id,
    needsMultiple: rule.min > 1,
    sections: rule.expectations.map((expectation) => expectation.label),
    reasons,
    minimum: rule.min,
    matchedBy,
    heuristic: true,
  };
}

export type ReviewGap = {
  id: string;
  label: string;
  severity: "critical" | "major";
  why: string;
};

export type ReviewResult = {
  slug: string;
  title: string;
  screenClass: ScreenClass;
  sectionCount: number;
  minimum: number;
  verdict: "pass" | "gaps";
  gaps: ReviewGap[];
  missingSections: string[];
  questions: string[];
  checkedSections: { id: string; title: string }[];
  heuristic: true;
};

// La revue critique: detecte les sections importantes oubliees. Elle sert de
// garde a markStatus(..., "approved"): impossible d'approuver tant que le
// verdict n'est pas "pass".
export function reviewScreen(project: string, screenSlug: string): ReviewResult {
  const screen = screenBySlug(project, screenSlug);
  const { rule } = ruleFor(screen.title, undefined);
  const gaps: ReviewGap[] = [];

  if (screen.sections.length === 0) {
    gaps.push({
      id: "no-section",
      label: "aucune section",
      severity: "critical",
      why: "l'ecran n'a aucune structure. Ajoutez des sections avec l'action sections.",
    });
  } else if (screen.sections.length < rule.min) {
    gaps.push({
      id: "below-minimum",
      label: `${screen.sections.length} section(s) sur ${rule.min} attendues`,
      severity: "critical",
      why: `${rule.reason}.`,
    });
  }

  for (const expectation of rule.expectations) {
    const covered = screen.sections.some(
      (section) =>
        expectation.match.test(normalizeForMatch(section.title)) ||
        expectation.match.test(normalizeForMatch(section.id))
    );
    if (!covered) {
      gaps.push({
        id: expectation.id,
        label: expectation.label,
        severity: "major",
        why: expectation.why,
      });
    }
  }

  return {
    slug: screen.slug,
    title: screen.title,
    screenClass: rule.id,
    sectionCount: screen.sections.length,
    minimum: rule.min,
    verdict: gaps.length === 0 ? "pass" : "gaps",
    gaps,
    missingSections: gaps.map((gap) => gap.label),
    questions: CRITICAL_QUESTIONS,
    checkedSections: screen.sections.map((section) => ({ id: section.id, title: section.title })),
    heuristic: true,
  };
}

export type CreateScreenResult = {
  slug: string;
  created: boolean;
  screenFile: string;
  sectionFiles: string[];
  // Vrai quand l'ecran existe SANS aucune section: le signal que l'ecran est
  // incomplet. Jamais un succes silencieux.
  needsSections: boolean;
  plan: PlanSectionsResult;
};

export function createScreen(
  project: string,
  input: { name: string; objective?: string; sections?: string[] }
): CreateScreenResult {
  const slug = slugify(input.name);
  const dir = join(wireframeDir(project), slug);
  const screenFile = join(dir, "screen.md");
  const sectionNames = input.sections ?? [];
  const date = now();
  const plan = planSections(input.name, input.objective);

  // Sections deja presentes sur disque, pour signaler honnetement l'etat reel.
  const readSectionFiles = (): string[] => {
    const sectionsDir = join(dir, "sections");
    if (!existsSync(sectionsDir)) return [];
    return readdirSync(sectionsDir)
      .filter((file) => file.endsWith(".md"))
      .sort()
      .map((file) => join(sectionsDir, file));
  };

  if (existsSync(screenFile)) {
    // Jamais d'ecrasement: le wireframe existant fait foi, il se met a jour
    // par edition explicite (mark/edition), pas par une recreation. On renvoie
    // quand meme l'etat reel du disque: une liste vide aurait laisse croire que
    // l'ecran n'a aucune section alors qu'il en a.
    const sectionFiles = readSectionFiles();
    return {
      slug,
      created: false,
      screenFile,
      sectionFiles,
      needsSections: sectionFiles.length === 0,
      plan
    };
  }
  mkdirSync(join(dir, "sections"), { recursive: true });
  writeFileSync(screenFile, SCREEN_TEMPLATE(slug, input.name, input.objective ?? "", date, sectionNames), "utf8");
  const sectionFiles: string[] = [];
  sectionNames.forEach((name, index) => {
    const sectionId = `${String(index + 1).padStart(2, "0")}-${slugify(name)}`;
    const file = join(dir, "sections", `${sectionId}.md`);
    writeFileSync(file, SECTION_TEMPLATE(slug, index + 1, slugify(name), name, date), "utf8");
    sectionFiles.push(file);
  });
  rebuildIndex(project);
  return {
    slug,
    created: true,
    screenFile,
    sectionFiles,
    // Un ecran cree sans sections n'est jamais un succes silencieux: le champ
    // porte le signal, `plan` propose quoi en mettre.
    needsSections: sectionFiles.length === 0,
    plan
  };
}

// Numéro d'index suivant: MAX des index existants, jamais le COMPTE de fichiers.
// L'ancienne formule (`existing.length + 1`) se trompait des qu'un trou
// apparaissait dans la numerotation: 01, 02, 04 donnaient next = 4, le fichier
// 04 existait deja, et l'appelant recevait created:false sans explication —
// une section manquante sans aucun signal.
function nextSectionIndex(dir: string): number {
  if (!existsSync(dir)) return 1;
  let max = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const match = /^(\d+)-/.exec(file);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

// created:false a UNE seule signification ici: la section existe deja.
// Jamais un echec detourne.
function writeSection(dir: string, screenSlug: string, index: number, name: string): { file: string; created: boolean } {
  const id = `${String(index).padStart(2, "0")}-${slugify(name)}`;
  const file = join(dir, `${id}.md`);
  if (existsSync(file)) return { file, created: false };
  writeFileSync(file, SECTION_TEMPLATE(screenSlug, index, slugify(name), name, now()), "utf8");
  return { file, created: true };
}

export function createSection(project: string, screenSlug: string, name: string): { file: string; created: boolean } {
  const dir = join(wireframeDir(project), screenSlug, "sections");
  if (!existsSync(join(wireframeDir(project), screenSlug, "screen.md"))) {
    throw new Error(`écran inconnu: ${screenSlug} (créez-le d'abord avec createScreen)`);
  }
  mkdirSync(dir, { recursive: true });
  const result = writeSection(dir, screenSlug, nextSectionIndex(dir), name);
  // Inchange: une seule reconstruction d'index par appel.
  rebuildIndex(project);
  return result;
}

// Une section deja presente, a n'importe quel index, detectee par son slug.
// Sert a rendre la creation en lot idempotente: on n'ecrase jamais.
function findSectionBySlug(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null;
  const slug = slugify(name);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    if (file.replace(/^\d+-/, "").replace(/\.md$/, "") === slug) return join(dir, file);
  }
  return null;
}

export type CreateSectionsResult = {
  screen: string;
  sectionFiles: string[];
  created: string[];
  existing: string[];
  indexRebuilds: number;
  needsSections: boolean;
};

// Creation en lot: N sections, UNE seule reconstruction d'index. C'est la
// reponse a la lenteur — N appels MCP individuels chacun relisant tous les
// ecrans du projet devenaient N scans complets; ici il n'y en a qu'un.
export function createSections(
  project: string,
  screenSlug: string,
  names: string[]
): CreateSectionsResult {
  const dir = join(wireframeDir(project), screenSlug, "sections");
  if (!existsSync(join(wireframeDir(project), screenSlug, "screen.md"))) {
    throw new Error(`écran inconnu: ${screenSlug} (créez-le d'abord avec createScreen)`);
  }
  if (names.length === 0) {
    throw new Error("createSections: au moins une section est requise");
  }
  mkdirSync(dir, { recursive: true });

  let index = nextSectionIndex(dir);
  const sectionFiles: string[] = [];
  const created: string[] = [];
  const existing: string[] = [];

  for (const name of names) {
    const trimmed = name.trim();
    if (trimmed.length === 0) continue;
    // Une section du meme nom deja presente est signalee comme telle, jamais
    // reecrite: le wireframe existant fait foi.
    const already = findSectionBySlug(dir, trimmed);
    if (already) {
      existing.push(already);
      sectionFiles.push(already);
      continue;
    }
    const result = writeSection(dir, screenSlug, index, trimmed);
    if (result.created) {
      index += 1;
      created.push(trimmed);
      sectionFiles.push(result.file);
    } else {
      existing.push(result.file);
      sectionFiles.push(result.file);
    }
  }

  if (sectionFiles.length === 0) {
    throw new Error(`createSections: aucune section ajoutable sur ${screenSlug}`);
  }

  rebuildIndex(project);
  return {
    screen: screenSlug,
    sectionFiles,
    created,
    existing,
    indexRebuilds: 1,
    needsSections: false
  };
}

function renderIndex(screens: ScreenSummary[]): string {
  const rows = screens.length > 0
    ? screens.map((screen) =>
        `| [${screen.title}](${screen.slug}/screen.md) | ${screen.sections.length} | ${screen.sections.map((section) => section.id).join(", ") || "—"} | ${screen.status} | v${screen.version} | ${screen.updated.slice(0, 10)} |`
      ).join("\n")
    : "| — | 0 | — | — | — | — |";
  const sectionRows = screens.flatMap((screen) =>
    screen.sections.map((section) => {
      const file = section.file.split("/").pop() ?? section.file;
      return `| ${screen.title} | ${section.id} | ${section.status} | [${file}](${screen.slug}/sections/${file}) |`;
    })
  );
  return `# Wireframes — index

<!-- Généré par novahiz (novahiz_wireframe index). Ne pas éditer à la main:
     reconstruire avec l'action index. -->

| Écran | Sections | Ids de sections | Statut | Version | Mis à jour |
| --- | --- | --- | --- | --- | --- |
${rows}
${sectionRows.length > 0 ? `
## Sections

| Écran | Section | Statut | Fichier |
| --- | --- | --- | --- |
${sectionRows.join("\n")}
` : ""}`;
}

export function rebuildIndex(project: string): string {
  const indexFile = join(wireframeDir(project), "INDEX.md");
  const content = renderIndex(listScreens(project));
  writeFileSync(indexFile, content, "utf8");
  return indexFile;
}

// Pièce jointe pour impeccable shape: contenu COMPLET du screen.md et de
// toutes ses sections, préfixé des règles de conformité. Le bloc est collé
// dans le prompt de shape (choix utilisateur 2026-10-12), pas seulement
// référencé par chemin.
export function attachScreen(project: string, screenSlug: string): {
  screen: ScreenSummary;
  files: { path: string; content: string }[];
  promptBlock: string;
} {
  const screens = listScreens(project);
  const screen = screens.find((entry) => entry.slug === screenSlug);
  if (!screen) throw new Error(`écran inconnu: ${screenSlug}`);
  const files = [{ path: screen.file, content: readFileSync(join(project, screen.file), "utf8") }];
  for (const section of screen.sections) {
    files.push({ path: section.file, content: readFileSync(join(project, section.file), "utf8") });
  }
  const body = files
    .map((file) => `### ${file.path}\n\n${file.content.trim()}\n`)
    .join("\n");
  const promptBlock = [
    `<!-- novahiz-wireframe: pièce jointe écran « ${screen.title} » (statut ${screen.status}, v${screen.version}, ${screen.sections.length} section(s)) -->`,
    `Le wireframe ci-dessous est la **spécification structurelle faisant foi**: le brief et le code doivent s'y conformer section par section. Les annotations (intent/behavior/constraints) et les états listés sont contraignants; les ids d'éléments sont stables.`,
    ``,
    body
  ].join("\n");
  return { screen, files, promptBlock };
}

// Cycle de vie: draft -> approved -> stale (code divergent) -> mis à jour.
export function markStatus(
  project: string,
  screenSlug: string,
  status: WireframeStatus,
  sectionId?: string
): { path: string; status: WireframeStatus } {
  if (!WIREFRAME_STATUSES.includes(status)) {
    throw new Error(`statut invalide: ${status} (attendu: ${WIREFRAME_STATUSES.join(", ")})`);
  }

  // Le blocage porte sur l'ECRAN, pas sur une section: c'est la ou l'on decide
  // qu'un wireframe est fini. Tant que la revue trouve une section importante
  // oubliee, `approved` est refuse — sinon la verification reste optionnelle et
  // l'on retombe dans le probleme initial.
  if (status === "approved" && !sectionId) {
    const review = reviewScreen(project, screenSlug);
    if (review.verdict !== "pass") {
      // Le formateur d'erreurs du serveur coupe a 300 caracteres (sanitisation
      // commune a tous les tools) et retire les caracteres non-ASCII. La
      // commande de rattrapage doit donc PRECEDER les details: elle seule peut
      // etre utilisee par l'agent si le message est tronque.
      throw new Error(
        `approbation refusee pour ${screenSlug}: ${review.gaps.length} manque(s). ` +
          `Corrigez: novahiz_wireframe action="sections" (puis action="review"). ` +
          `Manques: ${review.gaps.map((gap) => `${gap.label} [${gap.severity}]`).join(", ")}`
      );
    }
  }

  const file = sectionId
    ? join(wireframeDir(project), screenSlug, "sections", `${sectionId}.md`)
    : join(wireframeDir(project), screenSlug, "screen.md");
  if (!existsSync(file)) throw new Error(`fichier wireframe introuvable: ${file}`);
  const content = readFileSync(file, "utf8");
  const updated = content
    .replace(/^status: .*$/m, `status: ${status}`)
    .replace(/^updated: .*$/m, `updated: ${now()}`);
  writeFileSync(file, updated, "utf8");
  return { path: file, status };
}
