/**
 * P4 — index SQLite hybride de la memoire: table `memory` + FTS5.
 *
 * Contrat (plan valide): markdown = source de verite; SQLite = INDEX DERIVE,
 * rebuildable a tout moment via l'outil MCP `memory_rebuild`. Zero dependance
 * externe: node:sqlite (natif Node >= 22.5, SQLite embarque avec FTS5 —
 * verifie ici sur SQLite 3.53.3).
 *
 * Degradation (jamais de rupture): toute indisponibilite — FTS5 non compile,
 * base verrouillee par un autre processus au-dela du busy_timeout, index
 * illisible, requete mal formee — est transformee en `null`, et l'appelant
 * (searchSlots) retombe sur la recherche fichiers existante.
 *
 * Fraicheur: la synchro compare la signature (mtime+taille) de index.json a
 * celle memorisee dans memory_meta. Toute mutation de la memoire reecrit
 * index.json, donc le prochain appel de recherche re-synchronise l'index.
 *
 * Cycle d'import: ce module ne reimporte PAS src/memory.ts (memory.ts
 * l'importe). Les corps de slots arrivent via un callback `readBody` fourni
 * par l'appelant.
 */
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fold } from "./classify.ts";

/** Miroir local de INDEX_FILE (memory.ts) pour eviter un import circulaire. */
const INDEX_FILE = "index.json";

export type FtsSlot = {
  id: string;
  file: string;
  title: string;
  status: string;
  updated: string;
};

export type FtsSyncResult = {
  synced: true;
  slots: number;
  sig: string;
};

/** Lit le corps (resume+details) d'un slot; peut lancer sur fichier illisible. */
export type FtsBodyReader = (slot: FtsSlot) => string;

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  // Ecritures concurrentes (plusieurs sessions meme projet): attendre plutot
  // qu'echouer; au-dela, l'erreur est avallee par l'appelant -> repli fichiers.
  db.exec("PRAGMA busy_timeout = 3000");
  return db;
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      root TEXT NOT NULL,
      slot_id TEXT NOT NULL,
      file TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      updated TEXT NOT NULL,
      body TEXT NOT NULL,
      UNIQUE (root, slot_id)
    )
  `);
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5 (
      title, body,
      content = 'memory', content_rowid = 'rowid',
      tokenize = 'unicode61 remove_diacritics 1'
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_meta (
      root TEXT PRIMARY KEY,
      sig TEXT NOT NULL,
      slots INTEGER NOT NULL,
      synced_at TEXT NOT NULL
    )
  `);
}

function indexSignature(root: string): string | null {
  try {
    const stat = statSync(join(root, INDEX_FILE));
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return null;
  }
}

function readIndexSlots(root: string): FtsSlot[] | null {
  try {
    const parsed = JSON.parse(readFileSync(join(root, INDEX_FILE), "utf8")) as {
      slots?: unknown;
    };
    if (!Array.isArray(parsed.slots)) return null;
    const slots: FtsSlot[] = [];
    for (const raw of parsed.slots) {
      const entry = raw as Partial<FtsSlot>;
      if (typeof entry.id !== "string" || typeof entry.file !== "string") continue;
      slots.push({
        id: entry.id,
        file: entry.file,
        title: typeof entry.title === "string" ? entry.title : entry.id,
        status: typeof entry.status === "string" ? entry.status : "active",
        updated: typeof entry.updated === "string" ? entry.updated : ""
      });
    }
    return slots;
  } catch {
    return null;
  }
}

/**
 * Re-synchro complete (transaction): le markdown reste la source de verite,
 * SQLite n'est qu'un reflet. Un slot illisible est indexe a vide (P1: un
 * fichier casse ne fait jamais echouer l'ensemble).
 */
function syncIn(db: DatabaseSync, root: string, readBody: FtsBodyReader): FtsSyncResult {
  const sig = indexSignature(root);
  if (sig === null) throw new Error("index.json absent");
  const slots = readIndexSlots(root);
  if (slots === null) throw new Error("index.json illisible");
  ensureSchema(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM memory WHERE root = ?").run(root);
    const insert = db.prepare(
      "INSERT OR REPLACE INTO memory (root, slot_id, file, title, status, updated, body) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    for (const slot of slots) {
      let body = "";
      try {
        body = readBody(slot);
      } catch {
        // Slot declare mais fichier absent/ilisible: indexable a vide.
        body = "";
      }
      insert.run(root, slot.id, slot.file, slot.title, slot.status, slot.updated, body);
    }
    // Index derive: FTS5 rebati depuis la table de contenu (toutes racines).
    db.exec("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
    db.prepare(
      `INSERT INTO memory_meta (root, sig, slots, synced_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(root) DO UPDATE SET sig = excluded.sig, slots = excluded.slots, synced_at = excluded.synced_at`
    ).run(root, sig, slots.length, new Date().toISOString());
    db.exec("COMMIT");
    return { synced: true, slots: slots.length, sig };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ROLLBACK best-effort (transaction deja close par SQLite).
    }
    throw error;
  }
}

/** Synchro forcee (outil MCP memory_rebuild). `null` = indisponible. */
export function syncMemoryFts(
  dbPath: string,
  root: string,
  readBody: FtsBodyReader
): FtsSyncResult | null {
  let db: DatabaseSync | null = null;
  try {
    db = openDb(dbPath);
    return syncIn(db, root, readBody);
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Fermeture best-effort.
    }
  }
}

/**
 * Meme tokenisation que relevance.ts (fold, tokens >= 2), traduite en
 * expressions FTS5: chaque token en prefix (`"mot"*`, phrase suivie de `*`),
 * relie par AND. `null` = rien a chercher -> l'appelant garde le repli.
 */
function buildMatch(query: string): string | null {
  const tokens = [
    ...new Set(
      fold(query)
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 2)
    )
  ];
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(" AND ");
}

export type FtsQueryResult = {
  ids: string[];
};

/**
 * Recherche via l'index: fraicheur garantie (re-synchro si index.json a bouge),
 * sinon MATCH + bm25. `null` = indisponible (=> repli fichiers) ou rien a
 * chercher. Seuls les ids sont renvoyes: le classement final reste le moteur
 * existant (scores 0..1 et seuils de confiance preserves).
 */
export function queryMemoryFts(
  dbPath: string,
  root: string,
  query: string,
  limit: number,
  options: { includeArchived?: boolean; readBody: FtsBodyReader }
): FtsQueryResult | null {
  let db: DatabaseSync | null = null;
  try {
    const sig = indexSignature(root);
    if (sig === null) return null;
    db = openDb(dbPath);
    ensureSchema(db);
    const meta = db.prepare("SELECT sig FROM memory_meta WHERE root = ?").get(root) as
      | { sig?: string }
      | undefined;
    if (!meta || meta.sig !== sig) {
      syncIn(db, root, options.readBody);
    }
    const match = buildMatch(query);
    if (match === null) return null;
    const rows = db
      .prepare(
        `SELECT m.slot_id AS id
         FROM memory_fts JOIN memory m ON m.rowid = memory_fts.rowid
         WHERE memory_fts MATCH ? AND m.root = ? AND (? = 1 OR m.status = 'active')
         ORDER BY bm25(memory_fts)
         LIMIT ?`
      )
      .all(match, root, options.includeArchived === true ? 1 : 0, limit) as unknown as Array<{
      id: string;
    }>;
    return { ids: rows.map((row) => row.id) };
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Fermeture best-effort.
    }
  }
}
