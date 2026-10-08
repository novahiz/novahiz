// Couche lecture de novahiz-docs : du triplet (bibliothèque, requête, limite)
// au passage cité. Budget : moins de 100 ms sur l'index réel — le temps de
// réponse est mesuré dans la réponse, pas supposé. Aucune requête réseau :
// tout ce que cette couche rend existait déjà dans le fichier local.
//
// Règle de sortie : aucun passage ne quitte l'index sans sa citation
// (source_url, license, fetched_at, heading_path). Une réponse sans origine
// est un bug, pas un détail.

import type { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { loadCatalog, type CatalogEntry } from "./catalog.ts";
import { resolve } from "./resolve.ts";
import { countChunks, listIndexed, openStore, search, type Passage } from "./store.ts";

export interface QueryRequest {
  library: string;
  query: string;
  /** Nombre de passages, borné à [1, 20] (défaut 5). */
  limit?: number;
}

export interface QuotedPassage {
  /** Nom affiché de la bibliothèque, depuis le catalogue. */
  libraryName: string;
  headingPath: string[];
  /** Extrait surligné autour de la correspondance (marqueurs [ ... ]). */
  text: string;
  version: string;
  sourceUrl: string;
  license: string;
  fetchedAt: string;
  /** Score BM25 : plus bas = plus pertinent. */
  score: number;
}

export interface QueryOutcome {
  ok: boolean;
  /** Terme saisi par l'appelant. */
  library: string;
  /** Identifiant catalogue retenu quand il diffère de la saisie (alias, faute). */
  resolvedTo: string | null;
  query: string;
  passages: QuotedPassage[];
  /** Autres entrées plausibles du catalogue, pour corriger la saisie. */
  suggestions: string[];
  note: string | null;
  elapsedMs: number;
}

export interface LibraryStatus {
  id: string;
  name: string;
  ecosystem: string;
  docsUrl: string;
  indexed: boolean;
  chunks: number;
  fetchedAt: string | null;
}

export interface FindOutcome {
  query: string;
  matches: Array<{
    id: string;
    name: string;
    ecosystem: string;
    docsUrl: string;
    score: number;
    matchedOn: string;
    indexed: boolean;
  }>;
}

let shared: DatabaseSync | null = null;

/** Index ouvert une seule fois par processus ; NOVAHIZ_DOCS_DB le déplace (tests). */
export function docsDb(): DatabaseSync {
  if (shared === null) {
    const path = process.env.NOVAHIZ_DOCS_DB ?? fileURLToPath(new URL("../data/index.sqlite", import.meta.url));
    shared = openStore(path);
  }
  return shared;
}

function toQuoted(entry: CatalogEntry, passage: Passage): QuotedPassage {
  return {
    libraryName: entry.name,
    headingPath: passage.headingPath,
    text: passage.snippet,
    version: passage.version,
    sourceUrl: passage.sourceUrl,
    license: passage.license,
    fetchedAt: passage.fetchedAt,
    score: passage.score
  };
}

export function queryDocs(
  db: DatabaseSync,
  request: QueryRequest,
  catalog: readonly CatalogEntry[] = loadCatalog()
): QueryOutcome {
  const startedAt = performance.now();
  const typed = request.library.trim();
  const query = request.query.trim();
  const limit = Math.min(Math.max(Math.trunc(request.limit ?? 5), 1), 20);
  const finish = (outcome: Omit<QueryOutcome, "elapsedMs">): QueryOutcome => ({
    ...outcome,
    elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10
  });

  if (typed.length === 0 || query.length === 0) {
    return finish({
      ok: false,
      library: typed,
      resolvedTo: null,
      query,
      passages: [],
      suggestions: [],
      note: "library et query : chaînes non vides attendues"
    });
  }

  const matches = resolve(typed, catalog, { limit: 3 });
  if (matches.length === 0) {
    return finish({
      ok: false,
      library: typed,
      resolvedTo: null,
      query,
      passages: [],
      suggestions: [],
      note: `aucune bibliothèque du bouquet ne correspond à « ${typed} »`
    });
  }

  const entry = matches[0].entry;
  const passages = search(db, query, { library: entry.id, limit }).map((passage) => toQuoted(entry, passage));
  let note: string | null = null;
  if (passages.length === 0) {
    const total = countChunks(db, entry.id);
    note =
      total === 0
        ? `${entry.name} se résout mais son index est vide — remplissage : novahiz docs ingest ${entry.id}`
        : `${total} passages indexés pour ${entry.name}, mais aucun ne contient « ${query} »`;
  }
  return finish({
    ok: true,
    library: typed,
    resolvedTo: entry.id === typed ? null : entry.id,
    query,
    passages,
    suggestions: matches.slice(1).map((hit) => hit.entry.id),
    note
  });
}

export function findLibrary(
  db: DatabaseSync,
  query: string,
  catalog: readonly CatalogEntry[] = loadCatalog(),
  limit = 5
): FindOutcome {
  const indexed = new Set(listIndexed(db).map((page) => page.library));
  return {
    query,
    matches: resolve(query, catalog, { limit }).map((hit) => ({
      id: hit.entry.id,
      name: hit.entry.name,
      ecosystem: hit.entry.ecosystem,
      docsUrl: hit.entry.docsUrl,
      score: hit.score,
      matchedOn: hit.matchedOn,
      indexed: indexed.has(hit.entry.id)
    }))
  };
}

export function listLibraries(db: DatabaseSync, catalog: readonly CatalogEntry[] = loadCatalog()): LibraryStatus[] {
  const state = new Map<string, { chunks: number; fetchedAt: string }>();
  for (const page of listIndexed(db)) {
    const current = state.get(page.library);
    const chunks = (current?.chunks ?? 0) + page.chunks;
    const fetchedAt = current === undefined || page.fetchedAt > current.fetchedAt ? page.fetchedAt : current.fetchedAt;
    state.set(page.library, { chunks, fetchedAt });
  }
  return catalog.map((entry) => {
    const indexed = state.get(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      ecosystem: entry.ecosystem,
      docsUrl: entry.docsUrl,
      indexed: indexed !== undefined,
      chunks: indexed?.chunks ?? 0,
      fetchedAt: indexed?.fetchedAt ?? null
    };
  });
}
