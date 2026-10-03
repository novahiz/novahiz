/**
 * `novahiz snap` — snapshots of the Novahiz ledger.
 *
 * Our own system, written from scratch: no external binary, no third-party
 * package, no borrowed format. Plain TypeScript over `node:sqlite`; every file
 * lives under `<NovahizHome>/.snap` and every snapshot is addressed by the hash
 * of its own content.
 *
 * Subcommands: save, list, show, diff, restore, export, verify, prune, status.
 *
 * Restore never swaps the database file: the MCP server holds an open
 * connection on the ledger, and Windows refuses to replace an open file. The
 * store rewrites the rows in one transaction instead, so the live connection
 * sees the old state or the new one, never a torn one.
 */
import { writeSync } from "node:fs";
import { dbPathFor, emit, flagOn, type Parsed } from "./context.ts";
import { loadSpec, NovahizHome } from "../spec.ts";
import { openDb } from "../db.ts";
import {
  capture,
  diffSnapshots,
  exportSnapshot,
  listSnapshots,
  loadManifest,
  matchingIds,
  prune,
  restoreSnapshot,
  snapStatus,
  verifySnapshot,
  type SnapCapture,
  type SnapDiff,
  type SnapManifest,
  type SnapRestoreResult,
} from "../snap.ts";

const HELP = `novahiz snap — snapshots of the ledger (ours, no external tool)

Usage:
  novahiz snap save [-m MSG]         Snapshot the ledger now
  novahiz snap list [N]              Show the newest N snapshots (default 20)
  novahiz snap show <id>             Show one manifest
  novahiz snap diff <id> [<id>|current]  Compare two snapshots (or with the live ledger)
  novahiz snap restore <id> --force  Put the ledger back (a backup is written first)
  novahiz snap export <id> <path> [--force]  Write a standalone .sqlite file
  novahiz snap verify [<id>]         Check object hashes and SQLite integrity
  novahiz snap prune                 Apply retention, collect orphans and temp files
  novahiz snap status                Store status
  novahiz snap help                  Show this help

Options:
  --json, --format json   Machine-readable output
  --force                 Required by restore, and by an export that would overwrite
  -m, --message <text>    Note stored in the manifest for save

IDs are the first 12 hex characters of the manifest's own sha256; list shows
them, and any prefix long enough to be unique is accepted.
`;

/** Exit immediately with a message on stderr (a returning fail() kept running). */
function fail(message: string): never {
  writeSync(2, `error: ${message}\n`);
  process.exit(1);
}

function ledgerPath(): string {
  const root = NovahizHome();
  return dbPathFor(root, loadSpec(root));
}

function flagJson(parsed: Parsed): boolean {
  return flagOn(parsed, "json") || String(parsed.flags.format ?? "").toLowerCase() === "json";
}

function forceOn(parsed: Parsed): boolean {
  return flagOn(parsed, "force");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ["Ko", "Mo", "Go"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function shortDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

/** Bounded single-line rendering of an arbitrary row value. */
function compact(value: unknown, limit: number): string {
  const text = value === null || value === undefined ? "∅" : JSON.stringify(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…`;
}

/** `-m MSG` and `--message MSG` both annotate the manifest. */
function detailOf(argv: string[], parsed: Parsed): string | undefined {
  const fromFlag = parsed.flags.message;
  if (typeof fromFlag === "string" && fromFlag.length > 0) return fromFlag;
  const marker = argv.findIndex((arg) => arg === "-m");
  if (marker === -1) return undefined;
  const words: string[] = [];
  for (let index = marker + 1; index < argv.length && !argv[index].startsWith("-"); index += 1) {
    words.push(argv[index]);
  }
  return words.length > 0 ? words.join(" ") : undefined;
}

/**
 * Accept an exact id or any unambiguous prefix, and fail with the precise
 * reason otherwise: "not found" and "ambiguous" are different answers.
 */
function snapIdOf(input: string): string {
  const matches = matchingIds(input);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) fail(`snapshot introuvable : ${input}`);
  const shown = matches.slice(0, 5).join(", ");
  const extra = matches.length > 5 ? ` … (+${matches.length - 5})` : "";
  fail(`préfixe ambigu : "${input}" correspond à ${matches.length} snapshots : ${shown}${extra}`);
}

function manifestOf(input: string): SnapManifest {
  const manifest = loadManifest(snapIdOf(input));
  if (!manifest) fail(`manifeste illisible : ${input}`);
  return manifest;
}

// ── Renderers ────────────────────────────────────────────────────────────────

function renderManifest(manifest: SnapManifest): string {
  const lines = [
    `id           ${manifest.id}`,
    `parent       ${manifest.parent ?? "aucun"}`,
    `capturé      ${shortDate(manifest.createdAt)}`,
    `opération    ${manifest.operation}${manifest.detail ? ` — ${manifest.detail}` : ""}`,
    `contenu      sha256:${manifest.object}`,
    `taille       ${formatBytes(manifest.sourceBytes)} → ${formatBytes(manifest.objectBytes)}`,
    `compression  ${manifest.sourceBytes > 0 ? Math.round((manifest.objectBytes / manifest.sourceBytes) * 100) : 100} %`,
  ];
  return lines.join("\n");
}

function renderList(items: SnapManifest[]): string {
  if (items.length === 0) return "aucun snapshot";
  const rows = items.map(
    (manifest) =>
      `${manifest.id}  ${shortDate(manifest.createdAt)}  ${manifest.operation.padEnd(16)} ` +
      `${formatBytes(manifest.sourceBytes)} → ${formatBytes(manifest.objectBytes)}` +
      (manifest.detail ? `  ${manifest.detail}` : ""),
  );
  return [`id           date                 opération          taille`, ...rows, `${items.length} snapshot(s)`].join("\n");
}

function renderDiff(diff: SnapDiff): string {
  const header = `diff ${diff.from} → ${diff.to} · ${diff.changedTables} table(s) modifiée(s)`;
  if (diff.tables.length === 0) return `${header}\naucune différence`;
  const MAX_ROWS = 8;
  const lines: string[] = [header];
  for (const table of diff.tables) {
    lines.push(`  ${table.table}  ${table.status}  ${table.rowsBefore} → ${table.rowsAfter} ligne(s)`);
    if (table.status !== "changed") continue;
    const shown = table.rows.slice(0, MAX_ROWS);
    for (const row of shown) {
      const marker = row.before === null ? "+" : row.after === null ? "-" : "~";
      const key = row.key.replace(/^\[|\]$/g, "").slice(0, 60);
      const detail =
        marker === "~"
          ? `avant ${compact(row.before, 96)}\n         après ${compact(row.after, 96)}`
          : marker === "+"
            ? compact(row.after, 160)
            : compact(row.before, 160);
      lines.push(`    ${marker} ${key}  ${detail}`);
    }
    const rest = table.rows.length - shown.length;
    if (rest > 0) lines.push(`    … ${rest} ligne(s) supplémentaire(s) (dans le JSON --json)`);
    if (table.truncated) lines.push(`    … arrêté à 50 lignes pour cette table (JSON --json)`);
  }
  if (diff.truncated) lines.push("… diff partiel : augmentez ou ciblez une table précise via --json");
  return lines.join("\n");
}

function renderStatus(): { value: ReturnType<typeof snapStatus>; text: string } {
  const status = snapStatus();
  const lines = [
    `magasin      ${status.root}`,
    status.initialized
      ? `snapshots    ${status.count} (rétention ${status.retention.keep}, plancher ${status.retention.floor})`
      : `snapshots    0 — magasin non initialisé (aucune écriture encore)`,
    `dernier      ${
      status.latest
        ? `${status.latest.id}  ${shortDate(status.latest.createdAt)}  ${status.latest.operation}`
        : "aucun"
    }`,
    `taille       ${formatBytes(status.bytes)}`,
    `différées    ${status.deferred} capture(s) en attente d'une écriture hors transaction`,
  ];
  if (status.deferred > 0) {
    lines.push("attention    des écritures n'ont pas encore de point de restauration");
  }
  return { value: status, text: lines.join("\n") };
}

// ── Subcommands ──────────────────────────────────────────────────────────────

function snapSave(argv: string[], parsed: Parsed): void {
  const before = snapStatus().latest?.id ?? null;
  const detail = detailOf(argv, parsed);
  // capture:false — this subcommand exists to record *its own* operation and
  // message, so nothing may snapshot the ledger before it gets the chance.
  const db = openDb(ledgerPath(), { capture: false });
  let created: SnapCapture | null = null;
  try {
    created = capture(db, "manual", detail);
  } finally {
    db.close();
  }

  const latest = snapStatus().latest;
  if (created) {
    emit(
      parsed,
      { id: created.id, object: created.object, sourceBytes: created.sourceBytes, objectBytes: created.objectBytes },
      () => `ok: snapshot ${created.id} · ${formatBytes(created.sourceBytes)} → ${formatBytes(created.objectBytes)}`,
    );
    return;
  }
  if (latest && latest.id !== before) {
    // Opening the ledger already captured (session pruning changed it): the
    // snapshot exists, this run just was not the one that wrote it.
    emit(
      parsed,
      { id: latest.id, capturedOnOpen: true, operation: latest.operation },
      () => `ok: snapshot ${latest.id} (capturé à l'ouverture : ${latest.operation})`,
    );
    return;
  }
  emit(parsed, { id: before, changed: false }, () => `aucun changement dans le ledger depuis ${before ?? "le début"}`);
}

function snapList(argv: string[], parsed: Parsed): void {
  const requested = Number.parseInt(argv[1] ?? "20", 10);
  const limit = Number.isFinite(requested) && requested > 0 ? requested : 20;
  const items = listSnapshots(limit);
  emit(parsed, items, () => renderList(items));
}

function snapShow(argv: string[], parsed: Parsed): void {
  const input = argv[1];
  if (!input) fail("usage: novahiz snap show <id>");
  const manifest = manifestOf(input);
  emit(parsed, manifest, () => renderManifest(manifest));
}

function snapDiff(argv: string[], parsed: Parsed): void {
  const input = argv[1];
  if (!input) fail("usage: novahiz snap diff <id> [<id>|current]");
  const from = snapIdOf(input);
  const second = argv[2];
  const to = second === undefined || second === "current" ? null : snapIdOf(second);
  const diff = diffSnapshots(from, to, to === null ? ledgerPath() : undefined);
  emit(parsed, diff, () => renderDiff(diff));
}

function snapRestore(argv: string[], parsed: Parsed): void {
  const input = argv[1];
  if (!input) fail("usage: novahiz snap restore <id> --force");
  const id = snapIdOf(input);
  const db = openDb(ledgerPath());
  let result: SnapRestoreResult;
  try {
    result = restoreSnapshot(db, id, { force: forceOn(parsed) });
  } finally {
    db.close();
  }
  if (!result.success) fail(result.message);
  emit(parsed, result, () => `ok: ${result.message}`);
}

function snapExport(argv: string[], parsed: Parsed): void {
  const args = argv.slice(1).filter((arg) => !arg.startsWith("-"));
  const input = args[0];
  const output = args[1];
  if (!input || !output) fail("usage: novahiz snap export <id> <path> [--force]");
  const result = exportSnapshot(snapIdOf(input), output, { force: forceOn(parsed) });
  if (!result.success) fail(result.message);
  emit(parsed, result, () => `ok: ${result.message}`);
}

function snapVerify(argv: string[], parsed: Parsed): void {
  const input = argv[1];
  if (input) {
    const id = snapIdOf(input);
    const result = verifySnapshot(id);
    if (!result.success) fail(result.message);
    emit(parsed, { id, success: true }, () => `ok: ${result.message}`);
    return;
  }

  const items = listSnapshots();
  if (items.length === 0) {
    emit(parsed, { checked: 0, failed: 0, failures: [] }, () => "aucun snapshot à vérifier");
    return;
  }
  const lines: string[] = [];
  const failures: string[] = [];
  for (const manifest of items) {
    const result = verifySnapshot(manifest.id);
    if (result.success) {
      lines.push(`ok    ${manifest.id}  ${shortDate(manifest.createdAt)}  ${manifest.operation}`);
    } else {
      failures.push(result.message);
      lines.push(`FAIL  ${manifest.id}  ${result.message}`);
    }
  }
  const summary = `${items.length - failures.length}/${items.length} snapshot(s) valide(s)`;
  emit(parsed, { checked: items.length, failed: failures.length, failures }, () => [...lines, summary].join("\n"));
  if (failures.length > 0) process.exitCode = 1;
}

function snapPrune(parsed: Parsed): void {
  const { removed } = prune();
  emit(parsed, { removed }, () =>
    removed > 0
      ? `${removed} objet(s)/manifeste(s) récupéré(s)`
      : "magasin déjà propre, rien à récupérer",
  );
}

function snapStatusCommand(parsed: Parsed): void {
  const { value, text } = renderStatus();
  emit(parsed, value, () => text);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export function snapCommand(argv: string[], parsed: Parsed): void {
  const sub = argv[0] ?? "help";

  if (sub === "help" || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return;
  }

  switch (sub) {
    case "save":
      return snapSave(argv, parsed);
    case "list":
    case "log":
      return snapList(argv, parsed);
    case "show":
      return snapShow(argv, parsed);
    case "diff":
      return snapDiff(argv, parsed);
    case "restore":
      return snapRestore(argv, parsed);
    case "export":
      return snapExport(argv, parsed);
    case "verify":
      return snapVerify(argv, parsed);
    case "prune":
      return snapPrune(parsed);
    case "status":
      return snapStatusCommand(parsed);
    default:
      if (flagJson(parsed)) {
        writeSync(1, `${JSON.stringify({ error: `unknown subcommand: ${sub}`, subcommands: ["save", "list", "show", "diff", "restore", "export", "verify", "prune", "status"] }, null, 2)}\n`);
        process.exitCode = 1;
        return;
      }
      fail(`unknown subcommand: ${sub}. Use 'novahiz snap help'`);
  }
}
