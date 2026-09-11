import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TOKENS,
  dedupeStaleReads,
  encodeSavings,
  estimateTokens,
  mergeTokensConfig,
  parseSavings,
  pruneSavingsText,
  savingsPath,
  summarizeSavings,
  trimToolOutput,
  type MinimalMessage,
  type MinimalPart,
  type TokensConfig
} from "../adapters/opencode/tokens.ts";

const small = (overrides: Partial<TokensConfig> = {}): TokensConfig => ({
  ...DEFAULT_TOKENS,
  trimTools: [...DEFAULT_TOKENS.trimTools],
  readTools: [...DEFAULT_TOKENS.readTools],
  ...overrides
});

test("mergeTokensConfig returns the defaults for an empty input", () => {
  assert.deepEqual(mergeTokensConfig(undefined), DEFAULT_TOKENS);
  assert.deepEqual(mergeTokensConfig({}), DEFAULT_TOKENS);
});

test("mergeTokensConfig keeps defaults for invalid values and applies valid overrides", () => {
  const merged = mergeTokensConfig({
    enabled: "nope",
    maxOutputBytes: -5,
    keepHeadLines: 10,
    readTools: ["read", "view"],
    trimTools: ["read", 42]
  });
  assert.equal(merged.enabled, true);
  assert.equal(merged.maxOutputBytes, DEFAULT_TOKENS.maxOutputBytes);
  assert.equal(merged.keepHeadLines, 10);
  assert.deepEqual(merged.readTools, ["read", "view"]);
  assert.deepEqual(merged.trimTools, ["read"]);
});

test("estimateTokens approximates one token per four characters", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("trimToolOutput leaves a small output untouched", () => {
  assert.equal(trimToolOutput("read", "line one\nline two\n", small()), null);
});

test("trimToolOutput elides the middle while keeping the head, the tail, and errors", () => {
  const lines = Array.from({ length: 500 }, (_, index) => `line ${index}`);
  lines[250] = "TypeError: boom at line 250";
  const outcome = trimToolOutput("read", lines.join("\n"), small({ keepHeadLines: 5, keepTailLines: 5, keepErrorLines: 2 }));
  assert.ok(outcome);
  assert.match(outcome.text, /novahiz: \d+ lines elided/);
  assert.ok(outcome.text.startsWith("line 0"));
  assert.ok(outcome.text.endsWith("line 499"));
  assert.match(outcome.text, /TypeError: boom at line 250/);
  assert.equal(outcome.removedLines, 500 - 5 - 5);
  assert.ok(outcome.removedTokens > 0);
});

test("trimToolOutput never touches tools outside the trim allowlist", () => {
  const big = Array.from({ length: 400 }, () => "x").join("\n");
  assert.equal(trimToolOutput("edit", big, small()), null);
  assert.equal(trimToolOutput("write", big, small()), null);
});

test("trimToolOutput is inert when disabled or when trimming is turned off", () => {
  const big = Array.from({ length: 400 }, () => "x").join("\n");
  assert.equal(trimToolOutput("read", big, small({ enabled: false })), null);
  assert.equal(trimToolOutput("read", big, small({ trimOutputs: false })), null);
});

const readPart = (path: string, output: string): MinimalPart => ({
  type: "tool",
  tool: "read",
  state: { status: "completed", input: { filePath: path }, output, metadata: {} }
});

test("dedupeStaleReads stubs earlier reads and keeps the latest one intact", () => {
  const body = "x".repeat(800);
  const first = readPart("a.ts", body);
  const second = readPart("a.ts", body);
  const messages: MinimalMessage[] = [{ parts: [first, second] }];
  const outcome = dedupeStaleReads(messages, small());
  assert.equal(outcome.stubbed, 1);
  assert.ok(outcome.removedTokens > 0);
  assert.match(String(first.state?.output), /superseded by a later read/);
  assert.equal(second.state?.output, body);
});

test("dedupeStaleReads is idempotent and skips distinct files and non-read tools", () => {
  const older = readPart("a.ts", "o".repeat(800));
  const newer = readPart("a.ts", "n".repeat(800));
  const other = readPart("b.ts", "other file");
  const edit: MinimalPart = {
    type: "tool",
    tool: "edit",
    state: { status: "completed", input: { filePath: "a.ts" }, output: "done", metadata: {} }
  };
  const messages: MinimalMessage[] = [{ parts: [older, newer, other, edit] }];
  const first = dedupeStaleReads(messages, small());
  assert.equal(first.stubbed, 1);
  const second = dedupeStaleReads(messages, small());
  assert.equal(second.stubbed, 0);
  assert.equal(other.state?.output, "other file");
  assert.equal(edit.state?.output, "done");
});

test("dedupeStaleReads leaves tiny reads alone when the stub would cost more", () => {
  const first = readPart("a.ts", "tiny");
  const second = readPart("a.ts", "tiny");
  const outcome = dedupeStaleReads([{ parts: [first, second] }], small());
  assert.equal(outcome.stubbed, 0);
  assert.equal(first.state?.output, "tiny");
});

test("parseSavings round-trips encoded entries and drops malformed lines", () => {
  const text =
    encodeSavings({ at: "2026-01-01T00:00:00.000Z", session: "s1", tool: "read", kind: "trim", tokens: 120 }) +
    "not json\n\n" +
    encodeSavings({ at: "2026-01-01T00:00:01.000Z", session: "s1", tool: "read", kind: "dedupe", tokens: 40 });
  const entries = parseSavings(text);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].kind, "trim");
  assert.equal(entries[1].tokens, 40);
});

test("summarizeSavings totals tokens by kind, by tool, and counts sessions", () => {
  const entries = [
    { at: "t", session: "s1", tool: "read", kind: "trim" as const, tokens: 100 },
    { at: "t", session: "s1", tool: "read", kind: "dedupe" as const, tokens: 50 },
    { at: "t", session: "s2", tool: "bash", kind: "trim" as const, tokens: 25 }
  ];
  const summary = summarizeSavings(entries);
  assert.equal(summary.events, 3);
  assert.equal(summary.totalSaved, 175);
  assert.equal(summary.byKind.trim, 125);
  assert.equal(summary.byKind.dedupe, 50);
  assert.equal(summary.byTool.read, 150);
  assert.equal(summary.sessions, 2);
});

test("savingsPath points at build/token-savings.jsonl", () => {
  assert.match(savingsPath("C:/home"), /build[\\/]token-savings\.jsonl$/);
});

const readPartAt = (path: string, offset: number, output: string): MinimalPart => ({
  type: "tool",
  tool: "read",
  state: { status: "completed", input: { filePath: path, offset }, output, metadata: {} }
});

test("dedupeStaleReads keeps reads of distinct ranges of the same file", () => {
  const head = readPartAt("a.ts", 1, "head".repeat(200));
  const tail = readPartAt("a.ts", 401, "tail".repeat(200));
  const outcome = dedupeStaleReads([{ parts: [head, tail] }], small());
  assert.equal(outcome.stubbed, 0);
  assert.match(String(head.state?.output), /^head/);
  assert.match(String(tail.state?.output), /^tail/);
});

test("trimToolOutput trims a large bash output", () => {
  const lines = Array.from({ length: 600 }, (_, index) => `log ${index}`);
  const outcome = trimToolOutput("bash", lines.join("\n"), small({ keepHeadLines: 5, keepTailLines: 5 }));
  assert.ok(outcome);
  assert.match(outcome.text, /novahiz: \d+ lines elided/);
});

test("trimToolOutput elides a single very long line by characters", () => {
  const output = "x".repeat(50000);
  const outcome = trimToolOutput("read", output, small({ maxOutputBytes: 1000 }));
  assert.ok(outcome);
  assert.match(outcome.text, /characters elided/);
  assert.equal(outcome.removedLines, 0);
  assert.ok(outcome.text.length < output.length);
});

test("pruneSavingsText keeps only the last maxLines lines", () => {
  const text = Array.from({ length: 50 }, (_, index) => `line ${index}`).join("\n") + "\n";
  const pruned = pruneSavingsText(text, 10);
  assert.equal(pruned.split("\n").filter((line) => line.length > 0).length, 10);
  assert.ok(pruned.startsWith("line 40"));
  assert.ok(pruned.endsWith("\n"));
});

test("the example config keeps the default token settings", () => {
  const example = JSON.parse(
    readFileSync(new URL("../novahiz.config.example.json", import.meta.url), "utf8")
  ) as { tokens?: unknown };
  assert.deepEqual(example.tokens, DEFAULT_TOKENS);
});
