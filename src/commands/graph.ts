/**
 * `novahiz graph` — the code graph, built in-process by our own lexer,
 * extractor and resolver (no external binary, no third-party package).
 *
 * Subcommands: build, status, fresh, find, all, trace, api, map, help —
 * each accepting any unambiguous prefix (b, fi, fr, …). Everything reads the
 * store under `<NovahizHome>/.graph/<sha12(root)>`; the indexed workspace is
 * never written to. `--json` (or `--format json`) switches every renderer to
 * machine-readable output; find/all/trace/api exit 1 when they match nothing,
 * grep-style, so scripts can branch on the status alone.
 */
import { writeSync } from "node:fs";

import { emit, flagOn, numberFlag, type Parsed } from "./context.ts";
import {
  graphFileApi,
  graphFind,
  graphFindAll,
  graphFreshness,
  graphRepoMap,
  graphTrace,
  type FileApiResult,
  type FindAllResult,
  type FindResult,
  type RepoMapNode,
  type RepoMapResult,
  type TraceResult,
} from "../graph/query.ts";
import { graphStatus, graphStoreDir, rebuildGraph, type GraphStatus } from "../graph/store.ts";

const HELP = `novahiz graph — the code graph, built in-process (ours, no external tool)

Usage:
  novahiz graph build                 Rebuild the index now (incremental: unchanged files reuse their object)
  novahiz graph status                Store status: location, build time, freshness
  novahiz graph fresh [--rebuild]     Drift check against the workspace (stat-only unless --rebuild)
  novahiz graph find <name> [--kind k] [--file f] [--limit n]   Locate declarations
  novahiz graph all <ident> [--file f]                          Every masked occurrence (strings/comments excluded)
  novahiz graph trace <symbol> [--file f] [--direction both|callers|callees] [--depth 1] [--limit 20]
  novahiz graph api <file>            Signatures-only view of one file (exports, imports, definitions)
  novahiz graph map [--path p] [--depth 3]                      Aggregated tree of the workspace
  novahiz graph help                  Show this help

Options:
  --json, --format json   Machine-readable output
  --root <path>           Workspace to index (default: current directory)

Subcommands accept any unambiguous prefix (b, fi, fr, …). The index lives in
<NovahizHome>/.graph/<sha12(root)> — the workspace itself is never written to.
Exit code 1 when find/all/trace/api match nothing (grep-like).
`;

const SUBCOMMANDS = ["build", "status", "fresh", "find", "all", "trace", "api", "map", "help"];

/** Exit immediately with a message on stderr (a returning fail() kept running). */
function fail(message: string): never {
  writeSync(2, `error: ${message}\n`);
  process.exit(1);
}

/** Exact name first, then any unambiguous prefix — with a precise refusal. */
function pickSubcommand(input: string): string {
  if (SUBCOMMANDS.includes(input)) return input;
  const matches = SUBCOMMANDS.filter((sub) => sub.startsWith(input));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    fail(`préfixe ambigu : "${input}" correspond à ${matches.join(", ")}`);
  }
  fail(`sous-commande inconnue : "${input}" — essayez \`novahiz graph help\``);
}

function cap(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function rootOf(parsed: Parsed): string {
  const raw = parsed.flags.root;
  return typeof raw === "string" && raw.length > 0 ? raw : process.cwd();
}

function required(argv: string[], what: string): string {
  const value = argv[1];
  if (value === undefined || value.length === 0) {
    fail(`${what} manquant — voir \`novahiz graph help\``);
  }
  return value;
}

function optionalString(parsed: Parsed, name: string): string | undefined {
  const raw = parsed.flags[name];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

// ── Renderers (human mode; --json emits the raw result instead) ─────────────

function renderStatus(status: GraphStatus): string {
  const lines = [
    `magasin     ${status.storeDir}`,
    `état        ${status.exists ? "présent" : "absent (non construit)"}`,
    `construit   ${status.builtAt ?? "jamais"}`,
    `fichiers    ${status.total}`,
  ];
  const drift: string[] = [];
  if (status.added.length > 0) drift.push(`+${status.added.length} ajouté(s)`);
  if (status.changed.length > 0) drift.push(`~${status.changed.length} modifié(s)`);
  if (status.removed.length > 0) drift.push(`-${status.removed.length} supprimé(s)`);
  lines.push(`fraîcheur   ${status.stale ? `périmé${drift.length > 0 ? ` (${drift.join(", ")})` : ""}` : "à jour"}`);
  const lists: Array<[string, string[]]> = [
    ["ajoutés", status.added],
    ["modifiés", status.changed],
    ["supprimés", status.removed],
  ];
  for (const [label, list] of lists) {
    if (list.length === 0) continue;
    lines.push(`  ${label} :`);
    for (const path of list.slice(0, 5)) lines.push(`    ${path}`);
    if (list.length > 5) lines.push(`    … (+${list.length - 5})`);
  }
  return lines.join("\n");
}

function renderFind(result: FindResult): string {
  if (result.total === 0) return `aucun symbole ne correspond à "${result.query}"`;
  const lines = [`${result.total} symbole(s), ${result.hits.length} affiché(s)`];
  for (const hit of result.hits) {
    lines.push(`  ${hit.kind.padEnd(9)} ${hit.name}  ${hit.file}:${hit.line}`);
    lines.push(`              ${cap(hit.signature, 110)}`);
  }
  return lines.join("\n");
}

function renderAll(result: FindAllResult): string {
  if (result.files === 0) return `aucune occurrence de "${result.query}"`;
  const lines = [`${result.occurrences} occurrence(s) dans ${result.files} fichier(s)`];
  for (const file of result.results) {
    const shown = file.lines.join(", ");
    lines.push(`  ${file.file}  ×${file.count}  [${shown}${file.linesTruncated ? ", …" : ""}]`);
  }
  if (result.unavailable.length > 0) {
    lines.push(`  (objets indisponibles : ${result.unavailable.join(", ")})`);
  }
  return lines.join("\n");
}

function renderTrace(result: TraceResult, symbol: string): string {
  if (result.start === null) {
    if (result.candidates.length > 0) {
      const lines = [`symbole ambigu : ${result.matchCount} déclarations de "${symbol}" — précisez avec --file`];
      for (const candidate of result.candidates) {
        lines.push(`  ${candidate.kind.padEnd(9)} ${candidate.file}:${candidate.line}`);
      }
      return lines.join("\n");
    }
    return `aucun symbole nommé "${symbol}"`;
  }
  const start = result.start;
  const lines = [`${start.name} — ${start.file}:${start.line}  (${start.kind})`];
  let uncertainSeen = false;
  if (result.direction !== "callees") {
    lines.push("appelants :");
    if (result.callers.length === 0 && result.moduleCallers.length === 0) lines.push("  (aucun)");
    for (const hit of result.callers) {
      const confidence = hit.confidence ? ` [${hit.confidence}${hit.uncertain ? " ~" : ""}]` : "";
      if (hit.uncertain) uncertainSeen = true;
      lines.push(`  ${"·".repeat(Math.max(1, hit.hops))} ${hit.name}  ${hit.file}:${hit.line}${confidence}`);
    }
    for (const site of result.moduleCallers) {
      lines.push(`  niveau module  ${site.file} ×${site.count}`);
    }
  }
  if (result.direction !== "callers") {
    lines.push("appelés :");
    if (result.callees.length === 0) lines.push("  (aucun)");
    for (const hit of result.callees) {
      const confidence = hit.confidence ? ` [${hit.confidence}${hit.uncertain ? " ~" : ""}]` : "";
      if (hit.uncertain) uncertainSeen = true;
      lines.push(`  ${"·".repeat(Math.max(1, hit.hops))} ${hit.name}  ${hit.file}:${hit.line}${confidence}`);
    }
  }
  if (uncertainSeen) lines.push("  ~ = arête déduite du seul nom (unique ou méthode unique)");
  if (result.matchCount > 1) lines.push(`  (${result.matchCount} déclarations portent ce nom)`);
  return lines.join("\n");
}

function renderApi(result: FileApiResult, requested: string): string {
  if (!result.found || result.file === null) {
    const lines = [`fichier introuvable : ${requested}`];
    if (result.candidates.length > 0) {
      lines.push("candidats :");
      for (const path of result.candidates) lines.push(`  ${path}`);
    }
    return lines.join("\n");
  }
  const file = result.file;
  const lines = [
    `${file.path} — ${file.lines} lignes, ${file.symbolCount} symboles, sha256:${file.hash.slice(0, 12)}`,
  ];
  lines.push(`exports   ${result.exports.length > 0 ? cap(result.exports.join(", "), 160) : "(aucun)"}`);
  if (result.imports.length > 0) {
    lines.push("imports :");
    for (const imp of result.imports) {
      const target = imp.resolved !== null ? ` → ${imp.resolved}` : " (externe)";
      lines.push(`  L${String(imp.line).padStart(4)}  ${cap(imp.raw, 48)}${target}`);
    }
  }
  lines.push("définitions :");
  for (const def of result.definitions) {
    lines.push(
      `  L${String(def.line).padStart(4)}  ${def.kind.padEnd(9)} ${def.name}` +
        `${def.enclosing !== null ? `  (${def.enclosing})` : ""}  ${cap(def.signature, 90)}`,
    );
  }
  if (!result.detailAvailable) lines.push("(détail objet indisponible : exports/imports bruts non chargés)");
  return lines.join("\n");
}

function renderMap(result: RepoMapResult): string {
  const totals = result.totals;
  const lines = [
    `${result.prefix.length > 0 ? result.prefix : "."} — ${totals.files} fichiers, ` +
      `${totals.symbols} symboles, ${totals.lines} lignes`,
  ];
  const walk = (nodes: RepoMapNode[], prefix: string): void => {
    for (const node of nodes) {
      if (node.kind === "dir") {
        lines.push(`${prefix}${node.name}/  ${node.fileCount} fich, ${node.symbols} sym`);
        if (node.children) walk(node.children, `${prefix}  `);
      } else {
        lines.push(`${prefix}${node.name}  ${node.symbols} sym, ${node.lines} l`);
      }
    }
  };
  walk(result.tree, "  ");
  const s = result.stats;
  lines.push(
    `appels ${s.sites} : ${s.resolved} résolus (local ${s.local}, import ${s.import}, ` +
      `unique ${s.unique}, méthode ${s.method}), ${s.ambiguous} ambigus, ${s.unresolved} non résolus`,
  );
  return lines.join("\n");
}

// ── Command ──────────────────────────────────────────────────────────────────

export function graphCommand(argv: string[], parsed: Parsed): void {
  const input = argv[0] ?? "help";
  if (flagOn(parsed, "help") || input === "help") {
    process.stdout.write(HELP);
    return;
  }
  const sub = pickSubcommand(input);
  const root = rootOf(parsed);

  if (sub === "build") {
    const started = Date.now();
    const graph = rebuildGraph(root);
    const value = {
      root: graph.root,
      storeDir: graphStoreDir(root),
      files: graph.files.length,
      symbols: graph.symbols.length,
      calls: graph.calls.length,
      stats: graph.stats,
      durationMs: Date.now() - started,
    };
    emit(parsed, value, () =>
      [
        `index reconstruit : ${value.files} fichiers, ${value.symbols} symboles, ${value.calls} arêtes en ${value.durationMs} ms`,
        `magasin ${value.storeDir}`,
      ].join("\n"));
    return;
  }

  if (sub === "status") {
    const status = graphStatus(root);
    emit(parsed, status, () => renderStatus(status));
    return;
  }

  if (sub === "fresh") {
    const status = graphFreshness(root, { rebuild: flagOn(parsed, "rebuild") });
    emit(parsed, status, () => renderStatus(status));
    return;
  }

  if (sub === "find") {
    const query = required(argv, "requête");
    const result = graphFind(root, {
      query,
      kind: optionalString(parsed, "kind"),
      file: optionalString(parsed, "file"),
      limit: numberFlag(parsed, "limit", { min: 1, integer: true }),
    });
    emit(parsed, result, () => renderFind(result));
    if (result.total === 0) process.exitCode = 1;
    return;
  }

  if (sub === "all") {
    const query = required(argv, "identifiant");
    const result = graphFindAll(root, { query, file: optionalString(parsed, "file") });
    emit(parsed, result, () => renderAll(result));
    if (result.files === 0) process.exitCode = 1;
    return;
  }

  if (sub === "trace") {
    const symbol = required(argv, "symbole");
    const direction = optionalString(parsed, "direction");
    if (direction !== undefined && !["callers", "callees", "both"].includes(direction)) {
      fail(`--direction doit être callers, callees ou both (reçu "${direction}")`);
    }
    const result = graphTrace(root, {
      symbol,
      file: optionalString(parsed, "file"),
      direction: direction as "callers" | "callees" | "both" | undefined,
      depth: numberFlag(parsed, "depth", { min: 0, integer: true }),
      limit: numberFlag(parsed, "limit", { min: 1, integer: true }),
    });
    emit(parsed, result, () => renderTrace(result, symbol));
    if (result.start === null) process.exitCode = 1;
    return;
  }

  if (sub === "api") {
    const file = required(argv, "fichier");
    const result = graphFileApi(root, { file });
    emit(parsed, result, () => renderApi(result, file));
    if (!result.found) process.exitCode = 1;
    return;
  }

  if (sub === "map") {
    const result = graphRepoMap(root, {
      path: optionalString(parsed, "path"),
      depth: numberFlag(parsed, "depth", { min: 1, integer: true }),
    });
    emit(parsed, result, () => renderMap(result));
    return;
  }

  // pickSubcommand already covered every case; kept total for exhaustiveness.
}
