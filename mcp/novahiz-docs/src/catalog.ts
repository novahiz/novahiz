// Chargement et garanties de forme du bouquet curé (data/catalog.json).
// Le catalogue est la source des entrees de resolution : il ne contient que
// des informations structurelles (identifiant, aliases, depot, sources de
// documentation) — aucun texte de documentation n'habite ici, il reste dans
// l'index FTS5 alimente par l'ingestion.

import { readFileSync } from "node:fs";

export interface CatalogEntry {
  /** Identifiant canonique, ex. "nextjs" — c'est ce que les outils renvoient. */
  id: string;
  /** Nom affiché, ex. "Next.js". */
  name: string;
  /** Écosystème de packages : npm | pypi | dart | go | crates | jvm | other. */
  ecosystem: string;
  /** Écritures alternatives acceptées à la même enseigne ("next", "next.js"). */
  aliases: string[];
  /** Dépôt GitHub "org/repo" du projet (source du README en repli). */
  repo: string;
  /** Page d'entrée de la documentation du projet. */
  docsUrl: string;
  /** URL llms.txt servie en 200 au 04/10/2026 ; null = non mesurée ou absente. */
  llmsTxt: string | null;
}

export interface CatalogFile {
  version: number;
  libraries: CatalogEntry[];
}

const ECOSYSTEMS = new Set(["npm", "pypi", "dart", "go", "crates", "jvm", "other"]);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function fail(detail: string): never {
  throw new Error(`catalog.json : ${detail}`);
}

function assertEntry(value: unknown, index: number): asserts value is CatalogEntry {
  if (typeof value !== "object" || value === null) fail(`entrée ${index} : objet attendu`);
  const entry = value as Partial<CatalogEntry>;
  if (typeof entry.id !== "string" || entry.id.length === 0) fail(`entrée ${index} : id absent`);
  if (typeof entry.name !== "string" || entry.name.length === 0) fail(`entrée ${entry.id} : name absent`);
  if (typeof entry.ecosystem !== "string" || !ECOSYSTEMS.has(entry.ecosystem)) {
    fail(`entrée ${entry.id} : ecosystem inconnu ${String(entry.ecosystem)}`);
  }
  if (!Array.isArray(entry.aliases) || entry.aliases.some((alias) => typeof alias !== "string")) {
    fail(`entrée ${entry.id} : aliases doit être un tableau de chaînes`);
  }
  if (typeof entry.repo !== "string" || !REPO_RE.test(entry.repo)) fail(`entrée ${entry.id} : repo "org/repo" attendu`);
  if (typeof entry.docsUrl !== "string" || !entry.docsUrl.startsWith("https://")) {
    fail(`entrée ${entry.id} : docsUrl https attendue`);
  }
  if (entry.llmsTxt !== null && (typeof entry.llmsTxt !== "string" || !entry.llmsTxt.startsWith("https://"))) {
    fail(`entrée ${entry.id} : llmsTxt doit être null ou une URL https`);
  }
}

let cached: CatalogEntry[] | null = null;

/** Charge le bouquet (une seule lecture disque, puis cache en mémoire). */
export function loadCatalog(): readonly CatalogEntry[] {
  if (cached !== null) return cached;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(new URL("../data/catalog.json", import.meta.url), "utf8")) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`illisible (${detail})`);
  }
  if (typeof parsed !== "object" || parsed === null) fail("racine : objet attendu");
  const file = parsed as Partial<CatalogFile>;
  if (typeof file.version !== "number" || !Array.isArray(file.libraries)) fail("version ou libraries absent");
  const seen = new Set<string>();
  for (const [index, entry] of file.libraries.entries()) {
    assertEntry(entry, index);
    if (seen.has(entry.id)) fail(`id dupliqué : ${entry.id}`);
    seen.add(entry.id);
  }
  cached = file.libraries;
  return cached;
}

export function getEntry(id: string): CatalogEntry | undefined {
  return loadCatalog().find((entry) => entry.id === id);
}
