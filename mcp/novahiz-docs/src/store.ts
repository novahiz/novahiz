// Index documentaire local : SQLite + FTS5, sur node:sqlite du runtime.
// Contrainte "zero friction" : ce module n'ouvre AUCUN reseau — ni fetch, ni
// module http(s). Tout est fichier local ; le reseau n'appartient qu'au
// remplissage de l'index (couche ingest, etape S3).
//
// Deux tables :
//   - chunks      : la verite documentaire + la citation (library, version,
//                   source_url, license, fetched_at, heading_path) ;
//   - chunks_fts  : index de recherche FTS5 (tokenizer trigram, BM25),
//                   tableinee classique (pas content=) pour que les
//                   suppressions restent de simples DELETE.
// Le trigram donne la recherche sous-chaine sur les identifiants techniques
// (useState, useQuery) ; les mots de plus de 3 caracteres tombent dedans aussi.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface PageMeta {
  library: string;
  version: string;
  sourceUrl: string;
  license: string;
  /** Horodatage ISO ; defaut = date courante au moment de l'indexation. */
  fetchedAt?: string;
}

export interface IndexedChunk {
  headingPath: string[];
  ord: number;
  body: string;
}

export interface Passage {
  library: string;
  version: string;
  sourceUrl: string;
  license: string;
  fetchedAt: string;
  headingPath: string[];
  ord: number;
  /** Extrait surligne autour de la correspondance (marqueurs [ ... ]). */
  snippet: string;
  /** Score BM25 : plus bas = plus pertinent. */
  score: number;
}

export interface SearchOptions {
  library?: string;
  limit?: number;
}

export interface IndexedPage {
  library: string;
  version: string;
  sourceUrl: string;
  license: string;
  fetchedAt: string;
  chunks: number;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    library TEXT NOT NULL,
    version TEXT NOT NULL,
    source_url TEXT NOT NULL,
    license TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    heading_path TEXT NOT NULL,
    ord INTEGER NOT NULL,
    body TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chunks_page ON chunks(library, source_url);
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    body,
    tokenize = 'trigram'
  );
`;

export function openStore(dbPath: string): DatabaseSync {
  const isMemory = dbPath === ":memory:";
  const absolute = isMemory ? dbPath : resolve(dbPath);
  if (!isMemory) mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  if (!isMemory) {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  }
  db.exec(SCHEMA);
  return db;
}

// Echange atomique d'une page : ce qui existait pour (library, source_url)
// part, le nouveau contenu prend sa place — re-indexer ne duplique jamais.
export function indexPage(db: DatabaseSync, meta: PageMeta, chunks: IndexedChunk[]): number {
  const fetchedAt = meta.fetchedAt ?? new Date().toISOString();
  db.exec("BEGIN");
  try {
    const existing = db
      .prepare("SELECT id FROM chunks WHERE library = ? AND source_url = ?")
      .all(meta.library, meta.sourceUrl) as Array<{ id: number }>;
    const dropIndex = db.prepare("DELETE FROM chunks_fts WHERE rowid = ?");
    for (const row of existing) dropIndex.run(row.id);
    db.prepare("DELETE FROM chunks WHERE library = ? AND source_url = ?").run(meta.library, meta.sourceUrl);

    const insertChunk = db.prepare(
      "INSERT INTO chunks (library, version, source_url, license, fetched_at, heading_path, ord, body) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertIndex = db.prepare("INSERT INTO chunks_fts (rowid, body) VALUES (?, ?)");
    for (const chunk of chunks) {
      const inserted = insertChunk.run(
        meta.library,
        meta.version,
        meta.sourceUrl,
        meta.license,
        fetchedAt,
        JSON.stringify(chunk.headingPath),
        chunk.ord,
        chunk.body
      );
      insertIndex.run(Number(inserted.lastInsertRowid), chunk.body);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return chunks.length;
}

// Transformation d'une requete metier en expression FTS5. Chaque mot devient
// une phrase entre guillemets (les guillemets interieurs sont impossibles
// puisque les mots sont decoupes sur la ponctuation) jointe par AND :
//   - "useState" sur trigram = recherche sous-chaine, pas seulement mot entier ;
//   - les mots de moins de 3 caracteres n'existent pas en trigram, ils sont
//     ecartes plutot que de faire echouer toute la requete ;
//   - null = requete injouable, appelant retourne une liste vide.
export function toMatchQuery(raw: string): string | null {
  const words = raw.split(/[^\p{L}\p{N}_]+/u).filter((word) => word.length >= 3);
  if (words.length === 0) return null;
  return words.map((word) => `"${word}"`).join(" AND ");
}

export function search(db: DatabaseSync, query: string, options: SearchOptions = {}): Passage[] {
  const match = toMatchQuery(query);
  if (match === null) return [];
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 5), 1), 50);
  const filterLibrary = options.library !== undefined && options.library.length > 0;
  const sql =
    "SELECT c.library, c.version, c.source_url, c.license, c.fetched_at, c.heading_path, c.ord, " +
    "snippet(chunks_fts, 0, '[', ']', '…', 16) AS snippet, bm25(chunks_fts) AS score " +
    "FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid " +
    `WHERE chunks_fts MATCH ?${filterLibrary ? " AND c.library = ?" : ""} ` +
    "ORDER BY bm25(chunks_fts) LIMIT ?";
  const params: Array<string | number> = [match];
  if (filterLibrary) params.push(options.library as string);
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Array<{
    library: string;
    version: string;
    source_url: string;
    license: string;
    fetched_at: string;
    heading_path: string;
    ord: number;
    snippet: string;
    score: number;
  }>;
  return rows.map((row) => ({
    library: row.library,
    version: row.version,
    sourceUrl: row.source_url,
    license: row.license,
    fetchedAt: row.fetched_at,
    headingPath: parseHeadingPath(row.heading_path),
    ord: row.ord,
    snippet: row.snippet,
    score: row.score
  }));
}

function parseHeadingPath(stored: string): string[] {
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    // Valeur cassee d'un ancien index : on retombe sur le champ brut.
  }
  return stored.length > 0 ? [stored] : [];
}

// Etat de l'index pour list_libraries : une ligne par page indexee.
export function listIndexed(db: DatabaseSync): IndexedPage[] {
  const rows = db
    .prepare(
      "SELECT library, version, source_url, license, fetched_at, COUNT(*) AS chunks " +
        "FROM chunks GROUP BY library, source_url ORDER BY library"
    )
    .all() as Array<{
    library: string;
    version: string;
    source_url: string;
    license: string;
    fetched_at: string;
    chunks: number;
  }>;
  return rows.map((row) => ({
    library: row.library,
    version: row.version,
    sourceUrl: row.source_url,
    license: row.license,
    fetchedAt: row.fetched_at,
    chunks: Number(row.chunks)
  }));
}

export function countChunks(db: DatabaseSync, library?: string): number {
  const row =
    library === undefined
      ? (db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number })
      : (db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE library = ?").get(library) as { n: number });
  return Number(row.n);
}
