import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { enforceLedgerChecks, evaluateGate, fileClass, globToRegExp } from "../src/gate.ts";
import { openDb } from "../src/db.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const spec = loadSpec(root);
const PROSE = "// This comment explains the total calculation for the client's order";
const STYLE = "className={styles.card}";
// Real catalogue rules that demand the humanizer — replaces the old vacuous
// R1-docs/R1-code-prose assertions (audit l.156: they passed on a gate
// where NO rule matched at all).
const rulesCatalog = JSON.parse(readFileSync(join(root, "catalog", "rules.json"), "utf8")) as Array<{
  id: string;
  require: string[];
}>;
const HUMANIZER_RULES = new Set(
  rulesCatalog.filter((rule) => rule.require.includes("novahiz-humanizer")).map((rule) => rule.id)
);
const humanizerRuleMatched = (matched: string[]) => matched.some((id) => HUMANIZER_RULES.has(id));

test("maps extensions to file classes", () => {
  assert.equal(fileClass("src/hero.css"), "design");
  assert.equal(fileClass("src/app.ts"), "code");
  assert.equal(fileClass("README.md"), "text");
  assert.equal(fileClass("package.json"), "data");
  assert.equal(fileClass("Makefile"), "other");
});

test("classifies dotfiles instead of dropping them to other", () => {
  assert.equal(fileClass(".env"), "config");
  assert.equal(fileClass(".env.local"), "config");
  assert.equal(fileClass(".gitignore"), "config");
  assert.equal(fileClass(".eslintrc.json"), "config");
});

test("globs match nested paths", () => {
  assert.equal(globToRegExp("**/*.sql").test("supabase/migrations/001.sql"), true);
  assert.equal(globToRegExp("**/supabase/**").test("apps/web/supabase/config.toml"), true);
  assert.equal(globToRegExp("**/*.sql").test("src/index.ts"), false);
});

test("does not require humanizer for a markdown edit containing prose", () => {
  const result = evaluateGate({ tool: "edit", filePath: "README.md", spec, installedSkills: null, content: "## Installation\n\nThis section explains how to install the package." });
  assert.equal(result.missingSkills.includes("novahiz-humanizer"), false);
  assert.equal(humanizerRuleMatched(result.matchedRules), false);
});

test("does not require humanizer for a markdown edit without prose content", () => {
  const result = evaluateGate({ tool: "edit", filePath: "README.md", spec, installedSkills: null });
  assert.equal(humanizerRuleMatched(result.matchedRules), false);
});

test("does not require humanizer for pure logic code", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/app.ts", spec, installedSkills: null, content: "const x = 1;" });
  assert.equal(result.missingSkills.includes("novahiz-humanizer"), false);
  assert.equal(humanizerRuleMatched(result.matchedRules), false);
});

test("does not require humanizer for code containing prose outside design", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/app.ts", spec, installedSkills: null, content: PROSE });
  assert.equal(result.missingSkills.includes("novahiz-humanizer"), false);
  assert.equal(humanizerRuleMatched(result.matchedRules), false);
});

test("positive control: a design-ui prompt matches a real humanizer rule", () => {
  // Proves the HUMANIZER_RULES helper and the gate wiring actually fire —
  // the four negative tests above would be vacuous without this.
  const result = evaluateGate({ tool: "edit", filePath: "README.md", categories: ["design-ui"], spec, installedSkills: null });
  assert.equal(humanizerRuleMatched(result.matchedRules), true);
  assert.ok(result.missingSkills.includes("novahiz-humanizer"));
});

test("requires design craft skills for a style file", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/hero.css", spec, installedSkills: null });
  assert.ok(result.matchedRules.includes("R13-design-craft"));
  assert.ok(result.missingSkills.includes("novahiz-humanizer"));
  assert.ok(result.missingSkills.includes("ui-slop-remover"));
  assert.ok(result.missingSkills.includes("ui-craft-rules"));
});

test("does not require design craft for a component without a design prompt", () => {
  const withStyle = evaluateGate({ tool: "edit", filePath: "src/Button.tsx", spec, installedSkills: null, content: STYLE });
  assert.equal(withStyle.matchedRules.includes("R13-design-craft"), false);
  assert.equal(withStyle.missingSkills.includes("ui-slop-remover"), false);
  const logicOnly = evaluateGate({ tool: "edit", filePath: "src/Button.tsx", spec, installedSkills: null, content: "const n = 2;" });
  assert.equal(logicOnly.matchedRules.includes("R13-design-craft"), false);
  assert.equal(logicOnly.missingSkills.includes("ui-slop-remover"), false);
});

test("requires design craft skills for a design prompt on a UI target", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/Hero.tsx",
    spec,
    installedSkills: null,
    categories: ["design-ui"],
    content: "const n = 2;"
  });
  assert.ok(result.matchedRules.includes("R13-design-craft"));
  assert.ok(result.missingSkills.includes("novahiz-humanizer"));
  assert.ok(result.missingSkills.includes("ui-slop-remover"));
  assert.ok(result.missingSkills.includes("ui-craft-rules"));
});

test("ignores generated and lock files", () => {
  const result = evaluateGate({ tool: "edit", filePath: "package-lock.json", spec, installedSkills: null });
  assert.equal(result.allow, true);
  assert.equal(result.ignored, true);
  assert.deepEqual(result.matchedRules, []);
});

test("requires supabase skills for a migration path", () => {
  const result = evaluateGate({
    tool: "write",
    filePath: "supabase/migrations/20260101_init.sql",
    spec,
    installedSkills: null,
    loadedSkills: []
  });
  assert.ok(result.missingSkills.includes("novahiz-supabase"));
  assert.ok(result.missingSkills.includes("novahiz-postgres"));
  assert.ok(result.matchedRules.includes("R3-supabase"));
});

test("does not force supabase for a plain sql file", () => {
  const result = evaluateGate({ tool: "edit", filePath: "db/query.sql", spec, installedSkills: null });
  assert.equal(result.matchedRules.includes("R3-supabase"), false);
});

test("applies the primary roadmap skill steps", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/app.ts",
    spec,
    installedSkills: null,
    categories: ["code"],
    content: "const x = 1;",
    tier: "full"
  });
  assert.equal(result.roadmap, "feature");
  assert.ok(result.requiredSkills.includes("novahiz-plan"));
  assert.ok(result.requiredSkills.includes("novahiz-code-review"));
});

test("applies the flutter roadmap quality skills on a dart file", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "lib/main.dart",
    spec,
    installedSkills: null,
    categories: ["flutter"],
    content: "void main() {}",
    tier: "full"
  });
  assert.equal(result.roadmap, "flutter-feature");
  assert.ok(result.missingSkills.includes("flutter-apply-architecture-best-practices"));
  assert.ok(result.missingSkills.includes("dart-run-static-analysis"));
  assert.ok(result.missingSkills.includes("dart-add-unit-test"));
  assert.equal(result.allow, false);
});

test("flutter quality skills load when already present", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "lib/main.dart",
    spec,
    installedSkills: new Set([
      "flutter-apply-architecture-best-practices",
      "dart-run-static-analysis",
      "dart-add-unit-test",
      "novahiz-plan",
      "novahiz-clarify",
      "novahiz-task",
      "novahiz-analyse",
      "novahiz-implement",
      "novahiz-converge",
      "novahiz-code-review"
    ]),
    loadedSkills: [
      "flutter-apply-architecture-best-practices",
      "dart-run-static-analysis",
      "dart-add-unit-test",
      "novahiz-plan",
      "novahiz-clarify",
      "novahiz-task",
      "novahiz-analyse",
      "novahiz-implement",
      "novahiz-converge",
      "novahiz-code-review"
    ],
    categories: ["flutter"],
    content: "void main() {}",
    tier: "full"
  });
  assert.equal(result.missingSkills.length, 0);
  assert.equal(result.allow, true);
});

test("lite tier skips flutter architecture skills", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "lib/main.dart",
    spec,
    installedSkills: null,
    categories: ["flutter"],
    content: "void main() {}",
    tier: "lite"
  });
  assert.equal(result.missingSkills.includes("flutter-apply-architecture-best-practices"), false);
  assert.ok(result.missingSkills.includes("novahiz-implement"));
  assert.ok(result.missingSkills.includes("novahiz-converge"));
});

test("reports design craft skills that are not installed separately", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/hero.css",
    spec,
    installedSkills: new Set(["novahiz-humanizer"]),
    loadedSkills: []
  });
  assert.ok(result.requiredSkills.includes("novahiz-humanizer"));
  assert.ok(result.unmatchedRequired.includes("ui-slop-remover"));
  assert.ok(result.unmatchedRequired.includes("ui-craft-rules"));
  assert.equal(result.missingSkills.includes("ui-slop-remover"), false);
});

test("fails closed when the installed index is unavailable", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/hero.css",
    spec,
    installedSkills: new Set(),
    installedIndexAvailable: false,
    loadedSkills: []
  });
  assert.equal(result.allow, false);
  assert.equal(result.indexMissing, true);
  assert.ok(result.missingSkills.includes("novahiz-humanizer"));
  assert.ok(result.missingSkills.includes("ui-slop-remover"));
});

test("does not block a valid empty index", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "README.md",
    spec,
    installedSkills: new Set(),
    installedIndexAvailable: true,
    loadedSkills: []
  });
  assert.equal(result.allow, true);
  assert.equal(result.indexMissing, false);
});

test("blocks a placeholder marker in code content", () => {
  const marker = "not " + "implemented";
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/app.ts",
    spec,
    installedSkills: null,
    loadedSkills: ["novahiz-humanizer"],
    content: `throw new Error("${marker}");`
  });
  assert.equal(result.placeholder, true);
  assert.equal(result.allow, false);
  assert.ok(result.reasons.some((entry) => entry.includes("placeholder")));
});

test("does not flag clean code as a placeholder", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/app.ts",
    spec,
    installedSkills: null,
    loadedSkills: ["novahiz-humanizer"],
    content: "const x = 1;"
  });
  assert.equal(result.placeholder, false);
});

test("gates a bash command that writes prose to a file", () => {
  const result = evaluateGate({ tool: "bash", filePath: "output.md", spec, installedSkills: null, content: "# This is a detailed explanation of the installation steps for the project." });
  assert.equal(result.matchedRules.includes("R1-docs"), false);
  assert.equal(result.missingSkills.includes("novahiz-humanizer"), false);
});

test("gates a shell command targeting a supabase migration", () => {
  const result = evaluateGate({ tool: "shell", filePath: "supabase/migrations/001_init.sql", spec, installedSkills: null, content: "psql -f supabase/migrations/001_init.sql" });
  assert.equal(result.allow, false);
  assert.ok(result.missingSkills.includes("novahiz-supabase"));
});

test("allows a bash command targeting an ignored file", () => {
  const result = evaluateGate({ tool: "bash", filePath: "package-lock.json", spec, installedSkills: null, content: "npm install" });
  assert.equal(result.allow, true);
  assert.equal(result.ignored, true);
});

test("explains each missing skill in reasons on design", () => {
  const result = evaluateGate({ tool: "edit", filePath: "src/hero.css", spec, installedSkills: null, loadedSkills: [] });
  assert.ok(result.reasons.some((entry) => entry.includes("novahiz-humanizer")));
  assert.ok(result.reasons.some((entry) => entry.includes("ui-slop-remover")));
});

test("C1: the user prompt drives the complexity tier, not the edited content", () => {
  const prompt =
    "Implement a complete authentication system with database schema, security tests and session handling across multiple files";
  const withPrompt = evaluateGate({
    tool: "edit",
    filePath: "src/app.ts",
    spec,
    installedSkills: null,
    categories: ["code"],
    content: "const x = 1;",
    prompt
  });
  assert.equal(withPrompt.tier, "full");
  assert.ok(withPrompt.requiredSkills.includes("novahiz-plan"));
  const withoutPrompt = evaluateGate({
    tool: "edit",
    filePath: "src/app.ts",
    spec,
    installedSkills: null,
    categories: ["code"],
    content: "const x = 1;"
  });
  assert.equal(withoutPrompt.tier, "trivial");
  assert.equal(withoutPrompt.requiredSkills.includes("novahiz-plan"), false);
});

test("C3: the installed skills index is never ignored as build output", () => {
  const indexFile = evaluateGate({ tool: "edit", filePath: "build/installed-skills.json", spec, installedSkills: null });
  assert.equal(indexFile.ignored, false);
  const otherBuild = evaluateGate({ tool: "edit", filePath: "build/report.json", spec, installedSkills: null });
  assert.equal(otherBuild.ignored, true);
});

test("C3: an index gap is reported in reasons", () => {
  const result = evaluateGate({
    tool: "edit",
    filePath: "src/hero.css",
    spec,
    installedSkills: new Set(["novahiz-humanizer"]),
    loadedSkills: []
  });
  assert.ok(result.reasons.some((entry) => entry.includes("not in index")));
});

test("MINEUR#3: R9 skips small code edits and requires review at or above minChange", () => {
  const small = evaluateGate({ tool: "edit", filePath: "src/app.ts", spec, installedSkills: null, content: "const x = 1;" });
  assert.equal(small.matchedRules.includes("R9-code-review"), false);
  assert.equal(small.requiredSkills.includes("novahiz-code-review"), false);
  const big = evaluateGate({ tool: "edit", filePath: "src/app.ts", spec, installedSkills: null, content: "const x = 1;\n".repeat(60) });
  assert.ok(big.matchedRules.includes("R9-code-review"));
  assert.ok(big.requiredSkills.includes("novahiz-code-review"));
});

test("MINEUR#1: an invalid contentExcludes pattern applies the rule instead of skipping it", () => {
  const custom = {
    ...spec,
    rules: [{
      id: "TEST-excludes-invalid",
      require: ["novahiz-plan"],
      when: { fileClasses: ["text"], contentExcludes: "([unclosed" }
    }]
  } as unknown as typeof spec;
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
  try {
    const result = evaluateGate({ tool: "edit", filePath: "notes.md", spec: custom, installedSkills: null, content: "# Notes" });
    assert.ok(result.matchedRules.includes("TEST-excludes-invalid"));
    assert.ok(result.requiredSkills.includes("novahiz-plan"));
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((entry) => entry.includes("TEST-excludes-invalid")));
});

test("enforceLedgerChecks logs one row per session and skips empty sessions", () => {
  const tmp = mkdtempSync(join(tmpdir(), "novahiz-gate-enforce-"));
  const db = openDb(join(tmp, "enforce.sqlite"));
  try {
    const runChecks = (session: string) => {
      const result = evaluateGate({ tool: "edit", filePath: "src/app.ts", spec, installedSkills: null });
      return enforceLedgerChecks(db, {
        session,
        tool: "edit",
        paths: ["src/app.ts"],
        categories: [],
        results: [{ path: "src/app.ts", ...result }],
        spec,
        gateConfig: spec.config.gate
      });
    };
    const enforced = runChecks("s_enforce_test");
    assert.deepEqual(enforced.reasons, []);
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM enforcement_log WHERE session_id = ?")
      .get("s_enforce_test") as { n: number };
    assert.equal(rows.n, 1);
    runChecks("");
    const total = db.prepare("SELECT COUNT(*) AS n FROM enforcement_log").get() as { n: number };
    assert.equal(total.n, 1);
  } finally {
    db.close();
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  }
});

test("P2-A: rules stay coherent with the real categories and globs", () => {
  const rules = JSON.parse(readFileSync(join(root, "catalog", "rules.json"), "utf8")) as Array<{
    id: string;
    when: { promptCategories?: string[]; pathGlobs?: string[] };
  }>;
  const categories = JSON.parse(readFileSync(join(root, "catalog", "categories.json"), "utf8")) as Array<{ id: string }>;
  const ids = categories.map((category) => category.id);
  for (const rule of rules) {
    for (const category of rule.when?.promptCategories ?? []) {
      assert.ok(ids.includes(category), `${rule.id} references unknown category ${category}`);
    }
  }
  const r8Glob = rules.find((rule) => rule.id === "R8-docs")?.when.pathGlobs?.[0] ?? "";
  assert.ok(globToRegExp(r8Glob).test("novahiz-docs/guide.md"), "R8 must match workspace-relative paths");
  assert.ok(
    globToRegExp(r8Glob).test("C:/Users/dev/project/novahiz-docs/guide.md"),
    "R8 must match absolute paths"
  );
  const r4Globs = rules.find((rule) => rule.id === "R4-playwright")?.when.pathGlobs ?? [];
  assert.equal(r4Globs.includes("**/*.spec.ts"), false, "R4 must drop the generic spec.ts glob (audit l.134)");
  assert.equal(r4Globs.includes("**/*.spec.js"), false, "R4 must drop the generic spec.js glob (audit l.134)");
  const r9Globs = rules.find((rule) => rule.id === "R9-code-review")?.when.pathGlobs ?? [];
  assert.ok(r9Globs.includes("**/*.tsx"), "R9-code-review misses the tsx glob");
  assert.ok(r9Globs.includes("**/*.jsx"), "R9-code-review misses the jsx glob");
  assert.ok(r9Globs.includes("**/*.vue"), "R9-code-review misses the vue glob (audit l.137)");
  assert.ok(r9Globs.includes("**/*.svelte"), "R9-code-review misses the svelte glob (audit l.137)");
  assert.ok(r9Globs.includes("**/*.astro"), "R9-code-review misses the astro glob (audit l.137)");
  // R13/R14 stay prompt-scoped for components: design craft must not be
  // demanded on every .tsx edit without a design prompt (existing guard above).
  const r6 = rules.find((rule) => rule.id === "R6-Novahiz");
  assert.ok(r6?.when.promptCategories?.includes("test"), "R6 must cover the test category");
});

// MAJEUR l.135: with no target path only prompt-scoped rules apply — path
// rules cannot match, and their absence is not the M1 misconfiguration.
test("MAJEUR l.135: pathless evaluation applies prompt-scoped rules only", () => {
  const supa = evaluateGate({
    tool: "bash",
    filePath: "",
    pathless: true,
    categories: ["database-supabase"],
    spec,
    installedSkills: null
  });
  assert.ok(supa.matchedRules.includes("R3-supabase"));
  assert.ok(supa.requiredSkills.includes("novahiz-supabase"));
  assert.equal(supa.allow, false);
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.join(" "));
  };
  try {
    // R8-docs is path-only: without a path it must skip silently, not warn.
    const docs = evaluateGate({
      tool: "bash",
      filePath: "",
      pathless: true,
      categories: ["docs-writing"],
      spec,
      installedSkills: null
    });
    assert.equal(docs.requiredSkills.includes("novahiz-docs"), false);
  } finally {
    console.error = original;
  }
   assert.equal(errors.some((entry) => entry.includes("empty selectors")), false);
});

// contentMatches is a real selector in RuleWhen (spec.ts:38) consumed by
// evaluateGate (gate.ts:357). This test proves the feature has a consumer
// and is not a dead declaration (audit l.148).
test("contentMatches: rule applies only when the content matches (consumer proof)", () => {
  const customSpec = {
    ...spec,
    rules: [
      {
        id: "R-TEST-CM",
        description: "contentMatches consumer proof",
        when: { pathGlobs: ["**/*.md"], contentMatches: ["install"] },
        require: ["novahiz-humanizer"]
      }
    ]
  } as typeof spec;
  const hit = evaluateGate({ tool: "edit", filePath: "README.md", content: "Run npm install to get started", spec: customSpec, installedSkills: null });
  assert.ok(hit.matchedRules.includes("R-TEST-CM"));
  assert.ok(hit.missingSkills.includes("novahiz-humanizer"));
  const miss = evaluateGate({ tool: "edit", filePath: "README.md", content: "Pure prose with no keyword", spec: customSpec, installedSkills: null });
  assert.equal(miss.matchedRules.includes("R-TEST-CM"), false);
});
