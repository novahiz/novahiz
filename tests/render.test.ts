import { test } from "node:test";
import assert from "node:assert/strict";
import { bytes, heading, isTty, kv, rule, status, style, table, width } from "../src/render.ts";

function withEnv(name: string, value: string, run: () => void): void {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test("bytes formats each unit and clamps below zero", () => {
  assert.equal(bytes(0), "0 B");
  assert.equal(bytes(512), "512 B");
  assert.equal(bytes(1024), "1.0 KB");
  assert.equal(bytes(1536), "1.5 KB");
  assert.equal(bytes(1048576), "1.0 MB");
  assert.equal(bytes(-4096), "0 B");
});

test("width counts visible characters, not escape codes", () => {
  withEnv("FORCE_COLOR", "1", () => {
    const painted = style("bold", "ab");
    assert.ok(painted.length > 2, "the styled text should carry escape codes");
    assert.equal(width(painted), 2);
  });
});

test("style drops the escape codes when colour is off", () => {
  withEnv("NO_COLOR", "1", () => {
    assert.equal(style("red", "boom"), "boom");
    assert.equal(heading("Title"), "Title");
    assert.equal(status(true), "ok");
    assert.equal(status(false), "echec");
  });
});

test("style paints when colour is forced", () => {
  withEnv("FORCE_COLOR", "1", () => {
    assert.equal(style("green", "ok"), "\u001b[32mok\u001b[0m");
    assert.equal(status(true), "\u001b[32mok\u001b[0m");
    assert.equal(status(false), "\u001b[31mechec\u001b[0m");
  });
});

test("table indents every line, trims its ends, and aligns right", () => {
  const block = table(["name", "state"], [["alpha", "ok"], ["b", "echec"]]);
  const lines = block.split("\n");
  assert.equal(lines.length, 4);
  assert.ok(lines.every((line) => line.startsWith("  ")));
  assert.ok(lines.every((line) => line === line.trimEnd()));
  assert.ok(lines[1].includes("----"));

  const right = table(["n"], [["1"]], { align: ["right"], indent: 0 });
  assert.equal(right.split("\n")[2], "1");
});

test("kv pads every label to the widest one", () => {
  const block = kv([["a", "1"], ["longer", "2"]]);
  const [first, second] = block.split("\n");
  assert.equal(width(first), width(second), "both lines should have the same width");
  assert.equal(first.indexOf("1"), second.indexOf("2"), "the values should start at the same column");
});

test("rule repeats a dash to the requested length", () => {
  assert.equal(rule(4), "----");
});

test("isTty reports a boolean", () => {
  assert.equal(typeof isTty(), "boolean");
});
