import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  autoDocsEnabled,
  clearDirty,
  dateStamp,
  isMajorPath,
  markDirty,
  readProjectConfig,
  readState,
  upsertChangesSection,
  writeProjectConfig
} from "../autodocs.ts";
import { emit, flagOn, type Parsed } from "./context.ts";
import { memoryRoot, writeEntry } from "../memory.ts";
import * as ui from "../render.ts";

const MAX_DOC_PATHS = 12;
const ARCHITECTURE = "novahiz-docs/ARCHITECTURE.md";

export type EnsureResult = "created" | "existing" | "failed";

export type FlushOutcome = {
  status: "flushed" | "marked" | "skipped" | "failed";
  reason: string;
  docsPath: string | null;
  docsUpdated: boolean;
  memorySlot: string | null;
  paths: string[];
  pending: number;
  lastSync: string | null;
};

export function ensureProjectAutoDocsConfig(cwd: string): EnsureResult {
  try {
    const config = readProjectConfig(cwd);
    if (config.autoDocs === true) return "existing";
    writeProjectConfig(cwd, { ...config, autoDocs: true });
    return "created";
  } catch {
    return "failed";
  }
}

function skipResult(reason: string, paths: string[] = []): FlushOutcome {
  const state = readState(process.cwd());
  return {
    status: "skipped",
    reason,
    docsPath: null,
    docsUpdated: false,
    memorySlot: null,
    paths,
    pending: state.pending.length,
    lastSync: state.lastSync
  };
}

function flushDocs(cwd: string, paths: string[]): { path: string; updated: boolean } {
  const docPath = join(cwd, "novahiz-docs", "ARCHITECTURE.md");
  if (!existsSync(docPath)) return { path: ARCHITECTURE, updated: false };
  const sample = paths.slice(0, MAX_DOC_PATHS);
  if (sample.length === 0) return { path: ARCHITECTURE, updated: false };
  const doc = readFileSync(docPath, "utf8");
  const lines = sample.map((path) => `${path} (${dateStamp()})`);
  const next = upsertChangesSection(doc, lines);
  if (next === doc) return { path: ARCHITECTURE, updated: false };
  writeFileSync(docPath, next, "utf8");
  return { path: ARCHITECTURE, updated: true };
}

function flushMemory(cwd: string, paths: string[]): string | null {
  const sample = paths.slice(0, MAX_DOC_PATHS);
  if (sample.length === 0) return null;
  try {
    const result = writeEntry({
      title: "Auto docs sync",
      description: "Change log written by novahiz autodocs",
      tags: ["autodocs", "sync"],
      root: memoryRoot(cwd),
      content: [`Sync: ${new Date().toISOString()}`, ...sample.map((path) => `- ${path}`)].join("\n")
    });
    return result.slot.id;
  } catch {
    return null;
  }
}

export function flushAutoDocs(cwd: string): FlushOutcome {
  if (!autoDocsEnabled(cwd)) {
    return skipResult("autoDocs disabled (set autoDocs=true in .novahiz/config.json or unset NOVAHIZ_AUTODOCS)");
  }
  const state = readState(cwd);
  if (!state.dirty && state.pending.length === 0) {
    return skipResult("nothing dirty", state.pending);
  }
  try {
    const paths = state.pending;
    const docs = flushDocs(cwd, paths);
    const memorySlot = flushMemory(cwd, paths);
    const next = clearDirty(cwd);
    return {
      status: "flushed",
      reason: `${paths.length} path(s) recorded`,
      docsPath: docs.path,
      docsUpdated: docs.updated,
      memorySlot,
      paths,
      pending: next.pending.length,
      lastSync: next.lastSync
    };
  } catch (error) {
    return {
      status: "failed",
      reason: (error as Error).message,
      docsPath: null,
      docsUpdated: false,
      memorySlot: null,
      paths: state.pending,
      pending: state.pending.length,
      lastSync: state.lastSync
    };
  }
}

function markFromArgs(cwd: string, mark: string | boolean, positionals: string[]): FlushOutcome {
  const raw =
    typeof mark === "string" && mark.length > 0
      ? mark
      : positionals.join(",");
  const list = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (list.length === 0) {
    return {
      status: "failed",
      reason: "--mark needs at least one path",
      docsPath: null,
      docsUpdated: false,
      memorySlot: null,
      paths: [],
      pending: readState(cwd).pending.length,
      lastSync: readState(cwd).lastSync
    };
  }
  const accepted: string[] = [];
  const rejected: string[] = [];
  for (const path of list) {
    if (isMajorPath(path)) {
      markDirty(cwd, path);
      accepted.push(path);
    } else {
      rejected.push(path);
    }
  }
  const state = readState(cwd);
  if (accepted.length === 0) {
    return {
      status: "skipped",
      reason: `no major path among ${rejected.join(", ")}`,
      docsPath: null,
      docsUpdated: false,
      memorySlot: null,
      paths: rejected,
      pending: state.pending.length,
      lastSync: state.lastSync
    };
  }
  return {
    status: "marked",
    reason:
      rejected.length > 0
        ? `marked ${accepted.length}, ignored ${rejected.length} non-major`
        : `marked ${accepted.length}`,
    docsPath: null,
    docsUpdated: false,
    memorySlot: null,
    paths: accepted,
    pending: state.pending.length,
    lastSync: state.lastSync
  };
}

function statusView(cwd: string): Record<string, unknown> {
  const config = readProjectConfig(cwd);
  const state = readState(cwd);
  return {
    cwd,
    autoDocs: config.autoDocs === true,
    enabled: autoDocsEnabled(cwd),
    dirty: state.dirty,
    pending: state.pending,
    lastSync: state.lastSync,
    sessions: state.sessions
  };
}

export function commandAutodocs(parsed: Parsed): void {
  const cwd = process.cwd();
  const wantFlush = flagOn(parsed, "flush");
  const markFlag = parsed.flags.mark;
  const isMark = markFlag !== undefined && markFlag !== false;

  let outcome: FlushOutcome | null = null;
  if (isMark) {
    outcome = markFromArgs(cwd, markFlag, parsed.positionals.slice(1));
  } else if (wantFlush) {
    outcome = flushAutoDocs(cwd);
  }

  const value = outcome
    ? { ...statusView(cwd), action: isMark ? "mark" : "flush", ...outcome }
    : { ...statusView(cwd), action: "status" };

  emit(parsed, value, () => {
    const view = statusView(cwd);
    const lines = [
      ui.heading("novahiz autodocs"),
      ui.kv([
        ["Cwd", String(view.cwd)],
        ["autoDocs", String(view.autoDocs)],
        ["Enabled", String(view.enabled)],
        ["Dirty", String(view.dirty)],
        ["Pending", String(view.pending)],
        ["Last sync", String(view.lastSync)]
      ])
    ];
    if (outcome) {
      lines.push(
        "",
        ui.kv([
          ["Action", outcome.status],
          ["Reason", outcome.reason],
          ["Docs", outcome.docsPath ? `${outcome.docsPath}${outcome.docsUpdated ? " updated" : " unchanged"}` : "n/a"],
          ["Memory", outcome.memorySlot ?? "n/a"]
        ])
      );
      lines.push(
        "",
        outcome.status === "failed" ? ui.style("red", outcome.reason) : ui.style("green", outcome.reason)
      );
    } else {
      lines.push("", ui.style("dim", "Use --flush to sync, --mark <path> to record a change."));
    }
    return lines.join("\n");
  });

  if (outcome?.status === "failed") process.exitCode = 1;
}
