import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeHarnessChecks, grantsQuestionIn, impeccableChecks, parseJsonc, mcpEntryProblems, referencedSkillsCheck } from "../src/commands/doctor.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

test("grantsQuestionIn reads the agent permission block", () => {
  assert.equal(grantsQuestionIn("permission:\n  question: allow\n"), true);
  assert.equal(grantsQuestionIn("permission:\n  question: deny\n"), false);
  assert.equal(grantsQuestionIn("mode: primary\ntemperature: 0.2\n"), false);
});

test("grantsQuestionIn is not fooled by a comment about the setting", () => {
  const agent = "# opencode denies question by default\npermission:\n  question: deny\n";
  assert.equal(grantsQuestionIn(agent), false);
});

test("SKILL_CLI map is documented as intentionally empty", () => {
  // Doctor's external-CLI check is a no-op while web-extract replaced defuddle.
  const doctor = readFileSync(join(import.meta.dirname, "..", "src", "commands", "doctor.ts"), "utf8");
  assert.ok(doctor.includes("const SKILL_CLI: Record<string, string> = {}"));
  assert.ok(doctor.includes("none required (web-extract replaced defuddle)"));
});

// 0.3.6: opencode.jsonc is JSONC — comments and trailing commas must parse,
// and URLs ("https://...//...") must never be treated as comments.
test("parseJsonc strips comments and trailing commas, not URLs", () => {
  const parsed = parseJsonc(`{
    // line comment
    "url": "https://example.com//path", /* block comment */
    "list": ["a", "b",],
  }`) as Record<string, unknown>;
  assert.equal(parsed.url, "https://example.com//path");
  assert.deepEqual(parsed.list, ["a", "b"]);
});

test("mcpEntryProblems flags hard failures and reports soft drift as notes", () => {
  const catalog = new Map([["playwright", "@playwright/mcp@0.0.82"], ["narsil", "narsil-mcp@1.7.0"]]);

  // Hard failures: no command, unknown executable, unresolved ${VAR}, pin conflict.
  assert.ok(mcpEntryProblems("a", {}, catalog, {}).problems.includes("a: no command"));
  assert.ok(
    mcpEntryProblems("b", { command: ["definitely-not-a-real-binary-xyz"] }, catalog, {}).problems.some((p) =>
      p.includes("executable not found")
    )
  );
  assert.ok(
    mcpEntryProblems(
      "c",
      { command: ["node", "--token=${MISSING_VAR_XYZ}"], environment: {} },
      catalog,
      {}
    ).problems.some((p) => p.includes("env MISSING_VAR_XYZ not set"))
  );
  assert.ok(
    mcpEntryProblems(
      "playwright",
      { command: ["npx", "-y", "@playwright/mcp@9.9.9"] },
      catalog,
      {}
    ).problems.some((p) => p.includes("catalog pins @playwright/mcp@0.0.82"))
  );

  // Soft drift: a bare shim that matches the catalog base is a note, not a
  // failure. Plant the shim on a temp PATH so the assertion does not depend on
  // the machine: narsil-mcp exists on dev boxes with the MCP server installed
  // and is absent on CI runners — the original test failed on its first CI run
  // for exactly that reason (c7d78a3 never ran there).
  const binDir = mkdtempSync(join(tmpdir(), "novahiz-doctor-bin-"));
  const previousPath = process.env.PATH;
  try {
    writeFileSync(join(binDir, "narsil-mcp"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(binDir, "narsil-mcp.cmd"), "@exit 0\r\n", "utf8");
    process.env.PATH = [binDir, previousPath].filter(Boolean).join(delimiter);
    const shim = mcpEntryProblems("narsil", { command: ["narsil-mcp", "--git"] }, catalog, {});
    assert.deepEqual(shim.problems, []);
    assert.ok(shim.notes.some((n) => n.includes("unpinned (catalog: narsil-mcp@1.7.0)")));
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(binDir, { recursive: true, force: true });
  }

  // A healthy pinned entry with the secret set produces nothing.
  const healthy = mcpEntryProblems(
    "playwright",
    { command: ["npx", "-y", "@playwright/mcp@0.0.82"], environment: { TOKEN: "${SET_VAR}" } },
    catalog,
    { SET_VAR: "value" }
  );
  assert.deepEqual(healthy, { problems: [], notes: [] });

  // Disabled servers are skipped entirely.
  assert.deepEqual(mcpEntryProblems("off", { command: [], enabled: false }, catalog, {}), { problems: [], notes: [] });
});

test("claudeHarnessChecks reports nothing without a Claude config dir", () => {
  const missing = join(tmpdir(), `novahiz-claude-absent-${Date.now().toString(36)}`);
  assert.deepEqual(claudeHarnessChecks(missing, missing), []);
});

test("claudeHarnessChecks reports hooks, agent, skills and commands when configured", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-claude-"));
  const root = join(base, "repo");
  const claudeDir = join(base, "claude");
  try {
    mkdirSync(join(root, "adapters", "claude", "agent"), { recursive: true });
    writeFileSync(join(root, "adapters", "claude", "agent", "novahiz.md"), "agent body\n", "utf8");

    // Not configured yet: dir missing => no rows at all.
    assert.deepEqual(claudeHarnessChecks(root, claudeDir), []);

    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(join(claudeDir, "agents"), { recursive: true });
    mkdirSync(join(claudeDir, "skills", "humanizer"), { recursive: true });
    mkdirSync(join(claudeDir, "commands"), { recursive: true });
    writeFileSync(join(claudeDir, "agents", "novahiz.md"), "agent body\n", "utf8");
    writeFileSync(join(claudeDir, "skills", "humanizer", "SKILL.md"), "---\nname: humanizer\n---\n", "utf8");
    writeFileSync(join(claudeDir, "commands", "novahiz-plan.md"), "/novahiz-plan\n", "utf8");
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "Edit|Write", hooks: [{ type: "command", command: 'node "C:/x/novahiz/src/cli.ts" hook --harness claude' }] }
          ]
        }
      }),
      "utf8"
    );

    const checks = claudeHarnessChecks(root, claudeDir);
    assert.deepEqual(
      checks.map((check) => check.id),
      ["claude-hooks", "claude-agent", "claude-skills", "claude-commands"]
    );
    for (const check of checks) {
      assert.equal(check.ok, true, `${check.id}: ${check.detail}`);
      assert.equal(check.blocking, false);
    }

    // A settings.json without our handler flips only the hooks row.
    writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ hooks: { PreToolUse: [] } }), "utf8");
    const rerun = claudeHarnessChecks(root, claudeDir);
    assert.equal(rerun.find((check) => check.id === "claude-hooks")?.ok, false);
    assert.equal(rerun.find((check) => check.id === "claude-skills")?.ok, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Regression: a custom NOVAHIZ_HOME (n4\home, /opt/gov) contains no "novahiz"
// segment. The doctor used to test the path for that substring and reported a
// correctly wired install as missing — while install/hooks.mjs
// isNovahizHandler accepted it via "cli.ts".
test("claudeHarnessChecks accepts a handler whose path has no novahiz segment", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-claude-path-"));
  const root = join(base, "root");
  const claudeDir = join(base, "claude");
  try {
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit|Write",
              hooks: [{ type: "command", command: 'node "C:/tmp/n4/home/src/cli.ts" --home "C:/tmp/n4/home" hook --harness claude --event PreToolUse' }]
            }
          ]
        }
      }),
      "utf8"
    );
    const hooks = claudeHarnessChecks(root, claudeDir).find((check) => check.id === "claude-hooks");
    assert.equal(hooks?.ok, true, hooks?.detail);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("referencedSkillsCheck blocks on shipped skills only, packs stay informational", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-referenced-"));
  try {
    mkdirSync(join(base, "skills", "shipped-skill"), { recursive: true });
    writeFileSync(join(base, "skills", "shipped-skill", "SKILL.md"), "---\nname: shipped-skill\n---\n", "utf8");
    const spec = {
      root: base,
      categories: [{ id: "demo", defaultSkills: ["shipped-skill", "pack-skill"] }],
      rules: []
    } as never as Parameters<typeof referencedSkillsCheck>[0];

    // Healthy fresh install: shipped skill indexed, pack skill absent -> quiet.
    const fresh = referencedSkillsCheck(spec, new Set(["shipped-skill"]), base);
    assert.equal(fresh.ok, true, fresh.detail);
    assert.equal(fresh.blocking, false);
    assert.match(fresh.detail, /pack skills not installed/);

    // Broken install: the shipped skill is not indexed -> blocking.
    const broken = referencedSkillsCheck(spec, new Set(["pack-skill"]), base);
    assert.equal(broken.ok, false);
    assert.equal(broken.blocking, true);
    assert.match(broken.detail, /missing from index: shipped-skill/);

    // Unreadable index: the index row already fails; this one stays quiet.
    const noIndex = referencedSkillsCheck(spec, null, base);
    assert.equal(noIndex.ok, true, noIndex.detail);
    assert.equal(noIndex.blocking, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Opt-in visibility: no impeccable skill installed -> no rows at all, the same
// way claude-* rows disappear without a Claude config directory.
test("impeccableChecks returns nothing when the skill is not installed", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-impeccable-off-"));
  try {
    assert.deepEqual(impeccableChecks(base, false), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("impeccableChecks reports context files and never blocks", () => {
  const base = mkdtempSync(join(tmpdir(), "novahiz-impeccable-"));
  try {
    // Nothing present: both rows actionable but non-blocking.
    const missing = impeccableChecks(base, true);
    assert.equal(missing.length, 2);
    for (const check of missing) {
      assert.equal(check.ok, false, check.id);
      assert.equal(check.blocking, false, check.id);
    }
    assert.match(missing.find((check) => check.id === "impeccable-context")?.detail ?? "", /impeccable init/);
    assert.match(missing.find((check) => check.id === "impeccable-design")?.detail ?? "", /impeccable document/);

    // PRODUCT.md at root, DESIGN.md in docs/ (impeccable resolution order).
    writeFileSync(join(base, "PRODUCT.md"), "# Product\n", "utf8");
    mkdirSync(join(base, "docs"), { recursive: true });
    writeFileSync(join(base, "docs", "DESIGN.md"), "# Design\n", "utf8");
    const found = impeccableChecks(base, true);
    const context = found.find((check) => check.id === "impeccable-context");
    const design = found.find((check) => check.id === "impeccable-design");
    assert.equal(context?.ok, true, context?.detail);
    assert.match(context?.detail ?? "", /PRODUCT\.md present/);
    assert.equal(design?.ok, true, design?.detail);
    assert.match(design?.detail ?? "", /docs\/DESIGN\.md present/);
    assert.equal(found.every((check) => !check.blocking), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
