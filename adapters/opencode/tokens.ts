import { join } from "node:path";

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
  trimTools: ["read", "bash", "shell", "grep", "glob", "webfetch", "list"],
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

export type TrimOutcome = { text: string; removedLines: number; removedTokens: number };

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
    return { text, removedLines: 0, removedTokens };
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
  return { text, removedLines: middle.length, removedTokens };
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

export type DedupeOutcome = { stubbed: number; removedTokens: number };

export function dedupeStaleReads(messages: MinimalMessage[], config: TokensConfig): DedupeOutcome {
  if (!config.enabled || !config.dedupeReads) return { stubbed: 0, removedTokens: 0 };

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
      state.output = stub;
      state.metadata = { ...(state.metadata ?? {}), novahizDeduped: true };
      stubbed += 1;
    }
  }
  return { stubbed, removedTokens };
}

export type SavingsKind = "trim" | "dedupe" | "cap";

export type SavingsEntry = {
  at: string;
  session: string;
  tool: string;
  kind: SavingsKind;
  tokens: number;
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
          tokens: parsed.tokens
        });
      }
    } catch {
      continue;
    }
  }
  return entries;
}

export type SavingsSummary = {
  events: number;
  totalSaved: number;
  byKind: Record<SavingsKind, number>;
  byTool: Record<string, number>;
  sessions: number;
};

export function summarizeSavings(entries: SavingsEntry[]): SavingsSummary {
  const byKind: Record<SavingsKind, number> = { trim: 0, dedupe: 0, cap: 0 };
  const byTool: Record<string, number> = {};
  const sessions = new Set<string>();
  let totalSaved = 0;
  for (const entry of entries) {
    byKind[entry.kind] += entry.tokens;
    byTool[entry.tool] = (byTool[entry.tool] ?? 0) + entry.tokens;
    if (entry.session.length > 0) sessions.add(entry.session);
    totalSaved += entry.tokens;
  }
  return {
    events: entries.length,
    totalSaved,
    byKind,
    byTool,
    sessions: sessions.size
  };
}
