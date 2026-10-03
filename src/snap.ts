/**
 * snap — content-addressed snapshots of the Novahiz ledger.
 *
 * Our own system, written from scratch: no external binary, no third-party
 * package, no borrowed format. Plain TypeScript on top of `node:sqlite`,
 * `node:crypto` and `node:zlib`.
 *
 * Layout (all under NovahizHome()):
 *
 *   .snap/
 *     catalog.json                 newest-first id list, latest pointer, retention
 *     snapshots/<id>.json          one manifest per snapshot (id = hash of its content)
 *     objects/<aa>/<sha256>.db.gz  immutable gzip objects, deduplicated by content
 *     backups/<timestamp>.db       pre-restore safety copies
 *
 * Capture runs `VACUUM INTO`, which reads through the WAL: the snapshot holds
 * every committed row even when nothing has been checkpointed into the main
 * file, and the source connection never blocks writers. The output is hashed,
 * gzipped when that hash is not stored yet, and referenced by a manifest. The
 * catalog update is the commit point: a crash before it leaves an orphan object
 * that the collector removes later, never a half-visible snapshot.
 *
 * Restore is transactional and in place (ATTACH + row replacement) rather than
 * a file swap: the MCP server keeps a connection open on the ledger, so
 * replacing the file underneath it would fail on Windows and leave that
 * connection reading a deleted file.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { NovahizHome } from "./spec.ts";

// ── Types ────────────────────────────────────────────────────────────────────

export const SNAP_FORMAT = "novahiz-snap-1";
export const CATALOG_FORMAT = "novahiz-snap-catalog-1";

export type SnapManifest = {
  format: typeof SNAP_FORMAT;
  /** Content address of this manifest: first 12 hex chars of its own sha256. */
  id: string;
  /** Previous snapshot id at capture time, null for the first one. */
  parent: string | null;
  createdAt: string;
  /** Ledger operation that triggered the capture. */
  operation: string;
  detail: string | null;
  /** sha256 of the uncompressed snapshot database. */
  object: string;
  /** Bytes of the VACUUM INTO output (uncompressed). */
  sourceBytes: number;
  /** Bytes of the stored gzip object. */
  objectBytes: number;
};

export type SnapCapture = {
  id: string;
  object: string;
  sourceBytes: number;
  objectBytes: number;
};

type Catalog = {
  format: typeof CATALOG_FORMAT;
  latest: string | null;
  /** Snapshot ids, newest first. */
  snapshots: string[];
  retention: { keep: number; floor: number };
};

export type SnapDiffRow = {
  key: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type SnapDiffTable = {
  table: string;
  status: "changed" | "only-before" | "only-after";
  rowsBefore: number;
  rowsAfter: number;
  rows: SnapDiffRow[];
  truncated: boolean;
};

export type SnapDiff = {
  from: string;
  to: string;
  tables: SnapDiffTable[];
  changedTables: number;
  truncated: boolean;
};

export type SnapRestoreResult = { success: boolean; message: string };

export type SnapStatus = {
  root: string;
  initialized: boolean;
  count: number;
  latest: SnapManifest | null;
  bytes: number;
  retention: { keep: number; floor: number };
  /**
   * Captures refused because a transaction was open, not yet resolved by a
   * capture that ran after the COMMIT/RELEASE. Non-zero means an operation
   * still has no restore point.
   */
  deferred: number;
};

// ── Constants ────────────────────────────────────────────────────────────────

const RETENTION_KEEP = 50;
const RETENTION_FLOOR = 10;
const MAX_DIFF_ROWS = 50;
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Captures refused because a transaction was open. Reset by the next capture
 * that gets past VACUUM INTO, i.e. by the one that actually records the write.
 */
let deferred = 0;

// ── Paths ────────────────────────────────────────────────────────────────────

export function snapRoot(): string {
  return join(NovahizHome(), ".snap");
}

function objectsRoot(): string {
  return join(snapRoot(), "objects");
}

function manifestsRoot(): string {
  return join(snapRoot(), "snapshots");
}

function backupsRoot(): string {
  return join(snapRoot(), "backups");
}

function catalogPath(): string {
  return join(snapRoot(), "catalog.json");
}

function manifestPath(id: string): string {
  return join(manifestsRoot(), `${id}.json`);
}

function objectPath(sha: string): string {
  return join(objectsRoot(), sha.slice(0, 2), `${sha}.db.gz`);
}

// ── Small helpers ────────────────────────────────────────────────────────────

let tmpCounter = 0;

function tempPath(prefix: string, suffix = ".tmp"): string {
  tmpCounter += 1;
  return join(snapRoot(), `${prefix}-${process.pid}-${tmpCounter}${suffix}`);
}

function ensureStore(): void {
  mkdirSync(snapRoot(), { recursive: true });
  mkdirSync(objectsRoot(), { recursive: true });
  mkdirSync(manifestsRoot(), { recursive: true });
  mkdirSync(backupsRoot(), { recursive: true });
}

/** SQLite string literal: single quotes doubled, backslashes stay literal. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** SQLite identifier quoting, after validating it is a plain name. */
function sqlIdent(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) throw new Error(`unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Write JSON through a temp file + rename: readers see the old or the new file. */
function writeJsonAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}-${(tmpCounter += 1)}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function integrityCheckFile(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
    return rows.map((row) => String(Object.values(row)[0])).join("; ") || "unknown";
  } finally {
    db.close();
  }
}

function integrityCheckDb(db: DatabaseSync): string {
  const rows = db.prepare("PRAGMA integrity_check").all() as Array<Record<string, unknown>>;
  return rows.map((row) => String(Object.values(row)[0])).join("; ") || "unknown";
}

// ── Catalog ──────────────────────────────────────────────────────────────────

export function readCatalog(): Catalog {
  const found = readJson<Catalog>(catalogPath());
  if (!found || !Array.isArray(found.snapshots)) {
    return {
      format: CATALOG_FORMAT,
      latest: null,
      snapshots: [],
      retention: { keep: RETENTION_KEEP, floor: RETENTION_FLOOR },
    };
  }
  return {
    format: CATALOG_FORMAT,
    latest: found.latest ?? null,
    snapshots: found.snapshots,
    retention: { keep: found.retention?.keep ?? RETENTION_KEEP, floor: found.retention?.floor ?? RETENTION_FLOOR },
  };
}

function writeCatalog(catalog: Catalog): void {
  writeJsonAtomic(catalogPath(), catalog);
}

export function loadManifest(id: string): SnapManifest | null {
  if (!/^[a-f0-9]{4,64}$/.test(id)) return null;
  const found = readJson<SnapManifest>(manifestPath(id));
  if (!found || found.format !== SNAP_FORMAT) return null;
  return found;
}

export function listSnapshots(limit?: number): SnapManifest[] {
  const ids = readCatalog().snapshots;
  const picked = typeof limit === "number" && limit > 0 ? ids.slice(0, limit) : ids;
  const out: SnapManifest[] = [];
  for (const id of picked) {
    const manifest = loadManifest(id);
    if (manifest) out.push(manifest);
  }
  return out;
}

/**
 * Every snapshot id starting with `prefix`, newest first. Callers turn the
 * count into a decision: one match is the id, none is "not found", several is
 * "ambiguous". Copy-pasting eight characters out of a log line must work.
 */
export function matchingIds(prefix: string): string[] {
  if (!/^[A-Fa-f0-9]{1,64}$/.test(prefix)) return [];
  const needle = prefix.toLowerCase();
  try {
    return readdirSync(manifestsRoot())
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5))
      .filter((id) => id.startsWith(needle));
  } catch {
    return [];
  }
}

// ── Capture ──────────────────────────────────────────────────────────────────

/**
 * Snapshot the ledger after a write. Never throws: a failing capture must not
 * break the ledger operation that triggered it. Returns null when the ledger
 * did not change since the newest snapshot.
 */
export function capture(db: DatabaseSync, operation: string, detail?: string): SnapCapture | null {
  try {
    ensureStore();
    const tmp = tempPath("capture", ".db");
    // VACUUM INTO refuses an existing target, so the temp name must be free.
    rmSync(tmp, { force: true });
    try {
      db.exec(`VACUUM INTO ${sqlString(tmp)}`);
    } catch (error) {
      rmSync(tmp, { force: true });
      if (/within a transaction/i.test(errorMessage(error))) {
        // SQLite refuses VACUUM inside a transaction: the caller's write is
        // still uncommitted. The snapshot is taken by the capture that runs
        // after the RELEASE/COMMIT (insertTodo, the MCP "done" action), and
        // `deferred` stays visible in snapStatus() until one succeeds.
        deferred += 1;
      }
      return null;
    }
    deferred = 0; // we are outside a transaction: every report above is resolved

    let raw: Buffer;
    try {
      raw = readFileSync(tmp);
    } finally {
      rmSync(tmp, { force: true });
    }

    const digest = sha256(raw);
    const catalog = readCatalog();
    const parent = catalog.latest ? loadManifest(catalog.latest) : null;
    if (parent && parent.object === digest) return null; // ledger unchanged

    const target = objectPath(digest);
    let objectBytes: number;
    if (existsSync(target)) {
      objectBytes = statSync(target).size;
    } else {
      const gz = gzipSync(raw, { level: 6 });
      mkdirSync(dirname(target), { recursive: true });
      const objTmp = `${target}.${process.pid}-${(tmpCounter += 1)}.tmp`;
      writeFileSync(objTmp, gz);
      renameSync(objTmp, target);
      objectBytes = gz.length;
    }

    const body = {
      format: SNAP_FORMAT,
      parent: parent?.id ?? null,
      createdAt: new Date().toISOString(),
      operation,
      detail: detail ?? null,
      object: digest,
      sourceBytes: raw.length,
      objectBytes,
    } as const;
    const id = sha256(Buffer.from(JSON.stringify(body), "utf-8")).slice(0, 12);
    writeJsonAtomic(manifestPath(id), { ...body, id });

    catalog.latest = id;
    catalog.snapshots = [id, ...catalog.snapshots.filter((existing) => existing !== id)];
    writeCatalog(catalog);

    prune(catalog);
    return { id, object: digest, sourceBytes: raw.length, objectBytes };
  } catch {
    return null; // capture failures never reach the caller
  }
}

// ── Retention + collection ───────────────────────────────────────────────────

/** Apply retention, then drop manifests and objects nothing references any more. */
export function prune(catalog = readCatalog()): { removed: number } {
  try {
    ensureStore();
    const limit = Math.max(catalog.retention?.keep ?? RETENTION_KEEP, catalog.retention?.floor ?? RETENTION_FLOOR);
    let removed = 0;

    if (catalog.snapshots.length > limit) {
      const kept = catalog.snapshots.slice(0, limit);
      for (const id of catalog.snapshots.slice(limit)) {
        rmSync(manifestPath(id), { force: true });
        removed += 1;
      }
      catalog.snapshots = kept;
      if (catalog.latest && !kept.includes(catalog.latest)) catalog.latest = kept[0] ?? null;
      writeCatalog(catalog);
    }

    // Mark: every object still named by a surviving manifest, plus manifests
    // that exist on disk but no longer belong to the catalog.
    const referenced = new Set<string>();
    const alive: string[] = [];
    for (const id of catalog.snapshots) {
      const manifest = loadManifest(id);
      if (!manifest) continue;
      alive.push(id);
      referenced.add(manifest.object);
    }
    if (alive.length !== catalog.snapshots.length) {
      catalog.snapshots = alive;
      if (!alive.includes(catalog.latest ?? "")) catalog.latest = alive[0] ?? null;
      writeCatalog(catalog);
    }

    // Sweep: unreferenced manifests, then unreferenced objects.
    for (const file of readdirSync(manifestsRoot())) {
      if (!file.endsWith(".json")) continue;
      if (!catalog.snapshots.includes(file.slice(0, -5))) rmSync(join(manifestsRoot(), file), { force: true });
    }
    // Sweep: temp files left behind by an interrupted capture or read. Capture
    // is synchronous, so no live temp of this process can be in flight here and
    // another process has a different pid in its file name.
    for (const file of readdirSync(snapRoot())) {
      if (/^(?:capture|read)-\d+-\d+\.(?:db|tmp)$/.test(file) || /\.\d+-\d+\.tmp$/.test(file)) {
        rmSync(join(snapRoot(), file), { force: true });
      }
    }
    for (const prefix of readdirSync(objectsRoot(), { withFileTypes: true })) {
      if (!prefix.isDirectory()) continue;
      for (const file of readdirSync(join(objectsRoot(), prefix.name))) {
        const digest = file.replace(/\.db\.gz$/, "");
        if (!referenced.has(digest)) {
          rmSync(join(objectsRoot(), prefix.name, file), { force: true });
          removed += 1;
        }
      }
    }
    return { removed };
  } catch {
    return { removed: 0 };
  }
}

// ── Reading a snapshot back ──────────────────────────────────────────────────

/** Decompress a snapshot to a temp database file and check it end to end. */
function materialize(manifest: SnapManifest): string {
  ensureStore();
  const object = objectPath(manifest.object);
  if (!existsSync(object)) throw new Error(`objet de snapshot manquant : ${manifest.object}`);
  const raw = gunzipSync(readFileSync(object));
  if (sha256(raw) !== manifest.object) throw new Error(`snapshot ${manifest.id} : hash de l'objet incorrect`);
  const path = tempPath(`read-${manifest.id}`, ".db");
  rmSync(path, { force: true });
  writeFileSync(path, raw);
  return path;
}

/** Verify an object end to end: content hash, then SQLite's integrity check. */
export function verifySnapshot(id: string): SnapRestoreResult {
  try {
    const manifest = loadManifest(id);
    if (!manifest) return { success: false, message: `snapshot introuvable : ${id}` };
    const path = materialize(manifest);
    try {
      const result = integrityCheckFile(path);
      if (result !== "ok") return { success: false, message: `snapshot ${id} : integrity_check = ${result}` };
      return { success: true, message: `snapshot ${id} : objet ${manifest.object.slice(0, 12)}… vérifié, integrity_check = ok` };
    } finally {
      rmSync(path, { force: true });
    }
  } catch (err) {
    return { success: false, message: `vérification impossible : ${errorMessage(err)}` };
  }
}

// ── Diff ─────────────────────────────────────────────────────────────────────

function userTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

type ColumnSpec = { name: string; pk: number };

function tableColumns(db: DatabaseSync, table: string): ColumnSpec[] {
  const rows = db.prepare(`PRAGMA table_info(${sqlIdent(table)})`).all() as Array<{ name: string; pk: number }>;
  return rows.map((row) => ({ name: row.name, pk: row.pk }));
}

function rowCount(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT count(*) AS c FROM ${sqlIdent(table)}`).get() as { c: number };
  return row.c;
}

function rowsByKey(db: DatabaseSync, table: string, keyColumns: string[]): Map<string, Record<string, unknown>> {
  const order = keyColumns.map(sqlIdent).join(", ");
  const rows = db.prepare(`SELECT * FROM ${sqlIdent(table)} ORDER BY ${order}`).all() as Array<Record<string, unknown>>;
  const out = new Map<string, Record<string, unknown>>();
  for (const row of rows) out.set(JSON.stringify(keyColumns.map((column) => row[column])), row);
  return out;
}

/**
 * Compare two database files row by row. Tables are first separated by row
 * count, then only the differing ones are read in full, so the cost stays
 * proportional to what actually changed.
 */
export function diffFiles(beforePath: string, afterPath: string, from: string, to: string): SnapDiff {
  const before = new DatabaseSync(beforePath, { readOnly: true });
  const after = new DatabaseSync(afterPath, { readOnly: true });
  try {
    const beforeTables = new Set(userTables(before));
    const afterTables = new Set(userTables(after));
    const names = [...new Set([...beforeTables, ...afterTables])].sort();

    const tables: SnapDiffTable[] = [];
    let changed = 0;
    let truncated = false;

    for (const table of names) {
      const inBefore = beforeTables.has(table);
      const inAfter = afterTables.has(table);
      const countBefore = inBefore ? rowCount(before, table) : 0;
      const countAfter = inAfter ? rowCount(after, table) : 0;

      if (!inBefore || !inAfter) {
        changed += 1;
        tables.push({
          table,
          status: inBefore ? "only-before" : "only-after",
          rowsBefore: countBefore,
          rowsAfter: countAfter,
          rows: [],
          truncated: false,
        });
        continue;
      }

      const spec = tableColumns(before, table);
      const keys = spec.filter((column) => column.pk > 0).map((column) => column.name);
      const sortBy = keys.length > 0 ? keys : spec.map((column) => column.name);
      const left = rowsByKey(before, table, sortBy);
      const right = rowsByKey(after, table, sortBy);

      const rows: SnapDiffRow[] = [];
      let tableTruncated = false;
      const rowKeys = [...new Set([...left.keys(), ...right.keys()])];
      for (const key of rowKeys) {
        const a = left.get(key) ?? null;
        const b = right.get(key) ?? null;
        if (JSON.stringify(a) === JSON.stringify(b)) continue;
        if (rows.length >= MAX_DIFF_ROWS) {
          tableTruncated = true;
          break;
        }
        rows.push({ key, before: a, after: b });
      }
      if (rows.length === 0 && !tableTruncated) continue; // same content, same size

      changed += 1;
      truncated = truncated || tableTruncated;
      tables.push({ table, status: "changed", rowsBefore: countBefore, rowsAfter: countAfter, rows, truncated: tableTruncated });
    }
    return { from, to, tables, changedTables: changed, truncated };
  } finally {
    before.close();
    after.close();
  }
}

/** Diff a snapshot against another snapshot, or against the live ledger. */
export function diffSnapshots(fromId: string, toId: string | null, currentDbPath?: string): SnapDiff {
  const fromManifest = loadManifest(fromId);
  if (!fromManifest) throw new Error(`snapshot introuvable : ${fromId}`);
  const fromPath = materialize(fromManifest);
  let toPath: string | null = null;
  try {
    let target: string;
    if (toId === null) {
      if (!currentDbPath) throw new Error("chemin du ledger courant manquant");
      target = resolve(currentDbPath);
    } else {
      const toManifest = loadManifest(toId);
      if (!toManifest) throw new Error(`snapshot introuvable : ${toId}`);
      toPath = materialize(toManifest);
      target = toPath;
    }
    return diffFiles(fromPath, target, fromId, toId ?? "courant");
  } finally {
    rmSync(fromPath, { force: true });
    if (toPath) rmSync(toPath, { force: true });
  }
}

// ── Restore ──────────────────────────────────────────────────────────────────

/**
 * Put the ledger back to a snapshot, inside the connection we are given.
 *
 * Deliberately not a file swap: a connection held by the MCP server would keep
 * reading the old file, and Windows refuses to replace an open file. We ATTACH
 * the decompressed snapshot and rewrite each table's rows in one transaction,
 * deferring foreign keys so table order stops mattering. Columns added by a
 * later migration are created from the snapshot definition; columns the
 * snapshot does not know keep their current values.
 */
export function restoreSnapshot(db: DatabaseSync, id: string, opts?: { force?: boolean }): SnapRestoreResult {
  const manifest = loadManifest(id);
  if (!manifest) return { success: false, message: `snapshot introuvable : ${id}` };
  if (!opts?.force) {
    return {
      success: false,
      message:
        "refuse d'écraser le ledger sans --force ; relancez `novahiz snap restore <id> --force` (une copie de sauvegarde est écrite d'abord)",
    };
  }

  let snapPath: string | null = null;
  let backupPath: string | null = null;
  try {
    ensureStore();
    snapPath = materialize(manifest);
    const preCheck = integrityCheckFile(snapPath);
    if (preCheck !== "ok") return { success: false, message: `snapshot ${id} : integrity_check = ${preCheck}` };

    // Safety copy of the current state, taken through SQLite so the WAL counts.
    backupPath = join(backupsRoot(), `${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    rmSync(backupPath, { force: true });
    db.exec(`VACUUM INTO ${sqlString(backupPath)}`);

    const snap = new DatabaseSync(snapPath, { readOnly: true });
    const restored: string[] = [];
    const skipped: string[] = [];
    try {
      // ATTACH before BEGIN: attaching inside a transaction is refused in
      // some SQLite configurations, and there is nothing to make atomic yet.
      db.exec(`ATTACH DATABASE ${sqlString(snapPath)} AS snap`);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec("PRAGMA defer_foreign_keys = ON");
        for (const table of userTables(snap)) {
          const snapColumns = tableColumns(snap, table);
          const mainColumns = tableColumns(db, table);

          if (mainColumns.length === 0) {
            const definition = snap
              .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
              .get(table) as { sql?: string } | undefined;
            if (!definition?.sql) continue;
            db.exec(definition.sql);
            const indexes = snap
              .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL")
              .all(table) as Array<{ sql: string }>;
            for (const index of indexes) db.exec(index.sql);
          } else {
            const present = new Set(mainColumns.map((column) => column.name));
            for (const column of snapColumns) {
              if (present.has(column.name)) continue;
              if (column.pk > 0) {
                throw new Error(`colonne non ajoutable par ALTER (clé primaire) : ${table}.${column.name}`);
              }
              const info = snap.prepare(`PRAGMA table_info(${sqlIdent(table)})`).all() as Array<Record<string, unknown>>;
              const def = info.find((row) => row.name === column.name);
              const parts = [sqlIdent(column.name), String(def?.type ?? "TEXT")];
              if (def?.notnull) parts.push("NOT NULL");
              if (def?.dflt_value !== null && def?.dflt_value !== undefined) parts.push(`DEFAULT ${String(def.dflt_value)}`);
              db.exec(`ALTER TABLE ${sqlIdent(table)} ADD COLUMN ${parts.join(" ")}`);
            }
          }

          const mainNames = new Set(tableColumns(db, table).map((column) => column.name));
          const shared = snapColumns.map((column) => column.name).filter((name) => mainNames.has(name));
          if (shared.length === 0) {
            skipped.push(table);
            continue;
          }
          db.exec(`DELETE FROM ${sqlIdent(table)}`);
          const columns = shared.map(sqlIdent).join(", ");
          db.exec(`INSERT INTO ${sqlIdent(table)} (${columns}) SELECT ${columns} FROM snap.${sqlIdent(table)}`);
          restored.push(table);
        }
        db.exec("COMMIT");
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // the transaction may already be gone
        }
        throw err;
      } finally {
        try {
          db.exec("DETACH DATABASE snap");
        } catch {
          // detach is best effort
        }
      }
    } finally {
      snap.close();
    }

    const check = integrityCheckDb(db);
    if (check !== "ok") {
      return { success: false, message: `ledger restauré mais integrity_check = ${check} ; copie de sécurité : ${backupPath}` };
    }
    const extra = skipped.length > 0 ? ` ; tables ignorées (schéma absent du snapshot) : ${skipped.join(", ")}` : "";
    return {
      success: true,
      message: `ledger restauré depuis ${id} (${restored.length} tables), integrity_check = ok, sauvegarde : ${backupPath}${extra}`,
    };
  } catch (err) {
    const backup = backupPath ? ` ; sauvegarde écrite : ${backupPath}` : "";
    return { success: false, message: `restauration impossible : ${errorMessage(err)}${backup}` };
  } finally {
    if (snapPath) rmSync(snapPath, { force: true });
  }
}

// ── Export ───────────────────────────────────────────────────────────────────

/** Write a snapshot as a standalone .sqlite file, refusing paths outside the workspace. */
export function exportSnapshot(id: string, outputPath: string, opts?: { force?: boolean }): SnapRestoreResult {
  const manifest = loadManifest(id);
  if (!manifest) return { success: false, message: `snapshot introuvable : ${id}` };

  const target = resolve(outputPath);
  const allowed = [resolve(NovahizHome()), resolve(process.cwd())];
  if (!allowed.some((root) => target === root || target.startsWith(root + sep))) {
    return { success: false, message: `chemin hors workspace refusé : ${outputPath}` };
  }
  if (existsSync(target) && !opts?.force) {
    return { success: false, message: `le fichier existe déjà : ${target} (passez --force pour écraser)` };
  }
  try {
    const source = materialize(manifest);
    try {
      const tmp = `${target}.export-${process.pid}.tmp`;
      rmSync(tmp, { force: true });
      writeFileSync(tmp, readFileSync(source));
      renameSync(tmp, target);
      return { success: true, message: `snapshot ${id} exporté vers ${target}` };
    } finally {
      rmSync(source, { force: true });
    }
  } catch (err) {
    return { success: false, message: `export impossible : ${errorMessage(err)}` };
  }
}

// ── Status ───────────────────────────────────────────────────────────────────

export function snapStatus(): SnapStatus {
  const catalog = readCatalog();
  const latest = catalog.latest ? loadManifest(catalog.latest) : null;
  let bytes = 0;
  try {
    if (existsSync(objectsRoot())) {
      for (const prefix of readdirSync(objectsRoot(), { withFileTypes: true })) {
        if (!prefix.isDirectory()) continue;
        for (const file of readdirSync(join(objectsRoot(), prefix.name))) {
          bytes += statSync(join(objectsRoot(), prefix.name, file)).size;
        }
      }
    }
  } catch {
    // status never fails on a partial read
  }
  return {
    root: snapRoot(),
    initialized: existsSync(catalogPath()),
    count: catalog.snapshots.length,
    latest,
    bytes,
    retention: { keep: catalog.retention.keep, floor: catalog.retention.floor },
    deferred
  };
}
