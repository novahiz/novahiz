import { join } from "node:path";

// Lives under adapters/opencode on purpose: the installer copies it next to the
// plugin as a sibling, so the plugin imports it as "./tokens.ts". src/ and
// install/ reuse the same file through a relative path, keeping one source of
// truth for the defaults and helpers below.
export type TokensConfig = {
  enabled: boolean;
  trimOutputs: boolean;
  maxOutputBytes: number;
  keepHeadLines: number;
  keepTailLines: number;
  keepErrorLines: number;
  dedupeReads: boolean;
  capOutputTokens: number;
  trimTools: string[];
  readTools: string[];
};

export const MAX_SAVINGS_LINES = 20000;

export const DEFAULT_TOKENS: TokensConfig = {
  enabled: true,
  trimOutputs: true,
  maxOutputBytes: 40000,
  keepHeadLines: 120,
  keepTailLines: 40,
  keepErrorLines: 40,
  dedupeReads: true,
  capOutputTokens: 0,
  trimTools: ["read", "bash", "shell"],
  readTools: ["read"]
};

export function mergeTokensConfig(raw: unknown): TokensConfig {
  const source = raw && typeof raw === "object" ? (raw as Partial<TokensConfig>) : {};
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === "boolean" ? value : fallback;
  const count = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
  const list = (value: unknown, fallback: string[]): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [...fallback];
  return {
    enabled: bool(source.enabled, DEFAULT_TOKENS.enabled),
    trimOutputs: bool(source.trimOutputs, DEFAULT_TOKENS.trimOutputs),
    maxOutputBytes: count(source.maxOutputBytes, DEFAULT_TOKENS.maxOutputBytes),
    keepHeadLines: count(source.keepHeadLines, DEFAULT_TOKENS.keepHeadLines),
    keepTailLines: count(source.keepTailLines, DEFAULT_TOKENS.keepTailLines),
    keepErrorLines: count(source.keepErrorLines, DEFAULT_TOKENS.keepErrorLines),
    dedupeReads: bool(source.dedupeReads, DEFAULT_TOKENS.dedupeReads),
    capOutputTokens: count(source.capOutputTokens, DEFAULT_TOKENS.capOutputTokens),
    trimTools: list(source.trimTools, DEFAULT_TOKENS.trimTools),
    readTools: list(source.readTools, DEFAULT_TOKENS.readTools)
  };
}

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

const ERROR_LINE =
  /(^|\b)(error|exception|traceback|panic|fatal|failed|failure|assert(ion)? failed|typeerror|rangeerror|syntaxerror|referenceerror)\b|^\s*at\s+\S|^[A-Za-z0-9_./\\-]+:\d+(:\d+)?:/i;

export type TrimOutcome = { text: string; removedLines: number; removedTokens: number; originalBytes: number; keptBytes: number };

export function trimToolOutput(tool: string, output: string, config: TokensConfig): TrimOutcome | null {
  if (!config.enabled || !config.trimOutputs) return null;
  if (!config.trimTools.includes(tool)) return null;
  if (output.length === 0) return null;

  const lines = output.split("\n");
  const lineBudget = config.keepHeadLines + config.keepTailLines;
  const overBytes = Buffer.byteLength(output, "utf8") > config.maxOutputBytes;
  const overLines = lines.length > lineBudget;
  if (!overBytes && !overLines) return null;

  const head = lines.slice(0, config.keepHeadLines);
  const tailStart = Math.max(lines.length - config.keepTailLines, config.keepHeadLines);
  const tail = lines.slice(tailStart);
  const middle = lines.slice(config.keepHeadLines, tailStart);
  if (middle.length === 0) {
    if (!overBytes) return null;
    const keepChars = Math.floor(config.maxOutputBytes * 0.6);
    const tailChars = Math.floor(config.maxOutputBytes * 0.2);
    if (output.length <= keepChars + tailChars) return null;
    const removed = output.length - keepChars - tailChars;
    const marker = `[novahiz: ${removed} characters elided (~${Math.ceil(removed / 4)} tokens).]`;
    const removedTokens = Math.max(Math.ceil(removed / 4) - estimateTokens(marker), 0);
    const text = `${output.slice(0, keepChars)}${marker}${output.slice(output.length - tailChars)}`;
    return { text, removedLines: 0, removedTokens, originalBytes: Buffer.byteLength(output, "utf8"), keptBytes: Buffer.byteLength(text, "utf8") };
  }

  const kept: string[] = [];
  if (config.keepErrorLines > 0) {
    for (const line of middle) {
      if (ERROR_LINE.test(line)) {
        kept.push(line);
        if (kept.length >= config.keepErrorLines) break;
      }
    }
  }

  const removedTokens = Math.max(estimateTokens(middle.join("\n")) - estimateTokens(kept.join("\n")), 0);
  const marker = `[novahiz: ${middle.length} lines elided (~${removedTokens} tokens). Re-read the file or run the command again if you need the full output.]`;
  const text = [...head, ...kept, marker, ...tail].join("\n");
  return { text, removedLines: middle.length, removedTokens, originalBytes: Buffer.byteLength(output, "utf8"), keptBytes: Buffer.byteLength(text, "utf8") };
}

export type MinimalPart = {
  type?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown>;
    output?: string;
    metadata?: Record<string, unknown>;
  };
};

export type MinimalMessage = { parts?: MinimalPart[] };

export type DedupeOutcome = { stubbed: number; removedTokens: number; originalBytes: number; keptBytes: number };

// Walks every message on each request, so this is O(n) in conversation length.
// opencode compacts the history long before the cost matters.
export function dedupeStaleReads(messages: MinimalMessage[], config: TokensConfig): DedupeOutcome {
  if (!config.enabled || !config.dedupeReads) return { stubbed: 0, removedTokens: 0, originalBytes: 0, keptBytes: 0 };

  const reads = new Map<string, MinimalPart[]>();
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.type !== "tool" || !part.tool || !config.readTools.includes(part.tool)) continue;
      const state = part.state;
      if (!state || state.status !== "completed" || typeof state.output !== "string") continue;
      const input = state.input ?? {};
      const path = input.filePath ?? input.file_path ?? input.path;
      if (typeof path !== "string" || path.length === 0) continue;
      const offset = typeof input.offset === "number" ? input.offset : "";
      const limit = typeof input.limit === "number" ? input.limit : "";
      const key = `${path}\u0000${offset}\u0000${limit}`;
      const list = reads.get(key);
      if (list) list.push(part);
      else reads.set(key, [part]);
    }
  }

  let stubbed = 0;
  let removedTokens = 0;
  let originalBytes = 0;
  let keptBytes = 0;
  for (const parts of reads.values()) {
    if (parts.length < 2) continue;
    for (const part of parts.slice(0, -1)) {
      const state = part.state;
      if (!state || typeof state.output !== "string") continue;
      if (state.metadata?.novahizDeduped === true) continue;
      if (state.output.length === 0) continue;
      const lines = state.output.split("\n").length;
      const stub = `[novahiz: earlier read of this file superseded by a later read (${lines} lines omitted).]`;
      const saved = estimateTokens(state.output) - estimateTokens(stub);
      if (saved <= 0) continue;
      removedTokens += saved;
      originalBytes += Buffer.byteLength(state.output, "utf8");
      keptBytes += Buffer.byteLength(stub, "utf8");
      state.output = stub;
      state.metadata = { ...(state.metadata ?? {}), novahizDeduped: true };
      stubbed += 1;
    }
  }
  return { stubbed, removedTokens, originalBytes, keptBytes };
}

export type SavingsKind = "trim" | "dedupe" | "cap";

export type SavingsEntry = {
  at: string;
  session: string;
  tool: string;
  kind: SavingsKind;
  tokens: number;
  originalBytes?: number;
  keptBytes?: number;
};

export function savingsPath(home: string): string {
  return join(home, "build", "token-savings.jsonl");
}

export function encodeSavings(entry: SavingsEntry): string {
  return `${JSON.stringify(entry)}\n`;
}

export function pruneSavingsText(text: string, maxLines: number = MAX_SAVINGS_LINES): string {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length <= maxLines) return text;
  return `${lines.slice(lines.length - maxLines).join("\n")}\n`;
}

export function parseSavings(text: string): SavingsEntry[] {
  const entries: SavingsEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<SavingsEntry>;
      if (parsed && typeof parsed.tokens === "number" && Number.isFinite(parsed.tokens)) {
        entries.push({
          at: typeof parsed.at === "string" ? parsed.at : "",
          session: typeof parsed.session === "string" ? parsed.session : "",
          tool: typeof parsed.tool === "string" ? parsed.tool : "",
          kind: parsed.kind === "dedupe" || parsed.kind === "cap" ? parsed.kind : "trim",
          tokens: parsed.tokens,
          originalBytes: typeof parsed.originalBytes === "number" && Number.isFinite(parsed.originalBytes) ? parsed.originalBytes : undefined,
          keptBytes: typeof parsed.keptBytes === "number" && Number.isFinite(parsed.keptBytes) ? parsed.keptBytes : undefined
        });
      }
    } catch {
      continue;
    }
  }
  return entries;
}

export type SavingsFilter = { since?: string; session?: string };

function parseSince(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+)([dhm])$/i.exec(value.trim());
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const factor = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
    return Date.now() - amount * factor;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterSavings(entries: SavingsEntry[], filter: SavingsFilter): SavingsEntry[] {
  const since = parseSince(filter.since);
  const session = filter.session ?? "";
  return entries.filter((entry) => {
    if (session.length > 0 && entry.session !== session) return false;
    if (since !== null) {
      const at = Date.parse(entry.at);
      if (!Number.isFinite(at) || at < since) return false;
    }
    return true;
  });
}

export type SavingsSummary = {
  events: number;
  totalSaved: number;
  totalOriginalBytes: number;
  totalKeptBytes: number;
  byKind: Record<SavingsKind, number>;
  byTool: Record<string, number>;
  sessions: number;
};

export function summarizeSavings(entries: SavingsEntry[]): SavingsSummary {
  const byKind: Record<SavingsKind, number> = { trim: 0, dedupe: 0, cap: 0 };
  const byTool: Record<string, number> = {};
  const sessions = new Set<string>();
  let totalSaved = 0;
  let totalOriginalBytes = 0;
  let totalKeptBytes = 0;
  for (const entry of entries) {
    byKind[entry.kind] += entry.tokens;
    byTool[entry.tool] = (byTool[entry.tool] ?? 0) + entry.tokens;
    if (entry.session.length > 0) sessions.add(entry.session);
    totalSaved += entry.tokens;
    totalOriginalBytes += entry.originalBytes ?? 0;
    totalKeptBytes += entry.keptBytes ?? 0;
  }
  return {
    events: entries.length,
    totalSaved,
    totalOriginalBytes,
    totalKeptBytes,
    byKind,
    byTool,
    sessions: sessions.size
  };
}

export type ValueSpread = { count: number; min: number; median: number; max: number; mean: number };

export type CalibrationReport = {
  events: number;
  trimEvents: number;
  instrumentedTrims: number;
  removedBytes: ValueSpread;
  removedTokens: ValueSpread;
  bytesPerToken: number | null;
  reReads: number;
  byTool: Record<string, { events: number; removedBytes: number; removedTokens: number }>;
};

function spreadOf(values: number[]): ValueSpread {
  if (values.length === 0) return { count: 0, min: 0, median: 0, max: 0, mean: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return { count: sorted.length, min: sorted[0], median, max: sorted[sorted.length - 1], mean: sum / sorted.length };
}

// Summarizes trimmed events so the thresholds can be judged against real usage
// instead of guessed. Bytes come from the recorded original/kept sizes.
export function buildCalibration(entries: SavingsEntry[]): CalibrationReport {
  const trims = entries.filter((entry) => entry.kind === "trim");
  const instrumented = trims.filter(
    (entry) => typeof entry.originalBytes === "number" && typeof entry.keptBytes === "number"
  );
  const removedBytes: number[] = [];
  const removedTokens: number[] = [];
  const byTool: Record<string, { events: number; removedBytes: number; removedTokens: number }> = {};
  let totalRemovedBytes = 0;
  let totalRemovedTokens = 0;
  for (const entry of instrumented) {
    const bytes = (entry.originalBytes ?? 0) - (entry.keptBytes ?? 0);
    removedBytes.push(bytes);
    removedTokens.push(entry.tokens);
    totalRemovedBytes += bytes;
    totalRemovedTokens += entry.tokens;
    const bucket = byTool[entry.tool] ?? { events: 0, removedBytes: 0, removedTokens: 0 };
    bucket.events += 1;
    bucket.removedBytes += bytes;
    bucket.removedTokens += entry.tokens;
    byTool[entry.tool] = bucket;
  }
  const reReads = entries.filter((entry) => entry.kind === "dedupe").length;
  return {
    events: entries.length,
    trimEvents: trims.length,
    instrumentedTrims: instrumented.length,
    removedBytes: spreadOf(removedBytes),
    removedTokens: spreadOf(removedTokens),
    bytesPerToken: totalRemovedTokens > 0 ? totalRemovedBytes / totalRemovedTokens : null,
    reReads,
    byTool
  };
}
