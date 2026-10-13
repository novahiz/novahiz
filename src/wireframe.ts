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

export type CreateScreenResult = {
  slug: string;
  created: boolean;
  screenFile: string;
  sectionFiles: string[];
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
  if (existsSync(screenFile)) {
    // Jamais d'écrasement: le wireframe existant fait foi, il se met à jour
    // par édition explicite (mark/édition), pas par une recréation.
    return { slug, created: false, screenFile, sectionFiles: [] };
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
  return { slug, created: true, screenFile, sectionFiles };
}

export function createSection(project: string, screenSlug: string, name: string): { file: string; created: boolean } {
  const dir = join(wireframeDir(project), screenSlug, "sections");
  if (!existsSync(join(wireframeDir(project), screenSlug, "screen.md"))) {
    throw new Error(`écran inconnu: ${screenSlug} (créez-le d'abord avec createScreen)`);
  }
  mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir).filter((file) => file.endsWith(".md"));
  const next = existing.length + 1;
  const id = `${String(next).padStart(2, "0")}-${slugify(name)}`;
  const file = join(dir, `${id}.md`);
  if (existsSync(file)) return { file, created: false };
  writeFileSync(file, SECTION_TEMPLATE(screenSlug, next, slugify(name), name, now()), "utf8");
  rebuildIndex(project);
  return { file, created: true };
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
