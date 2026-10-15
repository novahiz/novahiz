import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { referencedSkillsCheck } from "../src/commands/doctor.ts";

// Contract of the "Referenced skills" row: the advice it gives must be advice
// a command can honour.
//
// Measured 2026-10-15 on the 0.9.5 install: doctor reported
// "7 pack skills not installed (run /novahiz-skills-update, or novahiz deps --install)"
// while `deps --install` returned `install: []` and exited 0. The 7 were
// `eas-app-stores, eas-hosting, eas-observe, eas-simulator, eas-update,
// eas-update-insights, eas-workflows`, referenced as `defaultSkills` by the
// `test` and `devops` categories. No provider ships them: providers.json holds
// exactly four skill packs (flutter-skills, dart-skills, expo-skills,
// impeccable), and the expo command names 20 `expo-*` skills, no `eas-*`.
// The reader was therefore sent after a command that installs nothing.
//
// The row now only offers the update command when a pack can deliver what is
// missing, and names the rest as un-installable instead.

type Spec = Parameters<typeof referencedSkillsCheck>[0];

/** Minimal spec: `categories` and `rules` feed the referenced set, `providers`
 *  feed the delivery check, `config.providers.disabled` gates it. */
function makeSpec(input: {
  defaultSkills?: string[];
  rules?: string[][];
  providers?: { id: string; install: string[] }[];
  disabled?: string[];
}): Spec {
  return {
    root: "C:/nonexistent",
    config: { providers: { disabled: input.disabled ?? [] } },
    providers: input.providers ?? [],
    categories: [{ id: "devops", defaultSkills: input.defaultSkills ?? [] }],
    rules: (input.rules ?? []).map((require, index) => ({ id: `r${index}`, require }))
  } as unknown as Spec;
}

/** A package root with no `skills/` directory: nothing is "shipped", so every
 *  absent skill falls into the pack branch. */
function barePackageRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "nvz-refskills-"));
  mkdirSync(join(dir, "skills"), { recursive: true });
  return dir;
}

const withIndex = (installed: string[]): Set<string> | null => new Set(installed);

test("referenced: rien d'absent -> only the present count", () => {
  const dir = barePackageRoot();
  try {
    const spec = makeSpec({ defaultSkills: ["a", "b"], providers: [] });
    const row = referencedSkillsCheck(spec, withIndex(["a", "b"]), dir);
    assert.equal(row.ok, true);
    assert.equal(row.blocking, false);
    assert.equal(row.detail, "2 present");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("referenced: skill expédie absent -> blocking, sans conseil de pack", () => {
  const dir = barePackageRoot();
  mkdirSync(join(dir, "skills", "shipped-skill"), { recursive: true });
  try {
    const spec = makeSpec({ defaultSkills: ["shipped-skill"], providers: [] });
    const row = referencedSkillsCheck(spec, withIndex([]), dir);
    assert.equal(row.ok, false);
    assert.equal(row.blocking, true);
    assert.equal(row.detail, "missing from index: shipped-skill");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("referenced: nom explicite apres --skill -> le conseil de mise a jour tient", () => {
  const dir = barePackageRoot();
  try {
    const spec = makeSpec({
      defaultSkills: ["expo-overview"],
      providers: [
        {
          id: "expo-skills",
          install: ["npx", "skills", "add", "expo/skills", "--skill", "expo-overview", "expo-router", "-g"]
        }
      ]
    });
    const row = referencedSkillsCheck(spec, withIndex([]), dir);
    assert.equal(row.ok, true);
    assert.equal(row.blocking, false);
    assert.match(row.detail, /1 pack skills not installed/);
    assert.match(row.detail, /novahiz-skills-update/);
    assert.doesNotMatch(row.detail, /referenced by no pack/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("referenced: --skill * couvre le prefixe du repo, pas les eas-*", () => {
  const dir = barePackageRoot();
  try {
    const spec = makeSpec({
      defaultSkills: ["flutter-add-widget-test", "eas-hosting"],
      providers: [
        {
          id: "flutter-skills",
          install: ["npx", "skills", "add", "flutter/skills", "--skill", "*", "-g", "-a", "opencode"]
        }
      ]
    });
    const row = referencedSkillsCheck(spec, withIndex([]), dir);
    assert.equal(row.ok, true);
    assert.equal(row.blocking, false);
    // Deux absents, mais un seul est livrable par un pack.
    assert.match(row.detail, /2 pack skills not installed/);
    assert.match(row.detail, /eas-hosting referenced by no pack \(deps cannot install them\)/);
    // Le flutter-* est livrable: il ne figure pas dans la liste des irrecevables.
    assert.doesNotMatch(row.detail, /flutter-add-widget-test referenced by no pack/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("referenced: repo sans slash -> pas de prefixe devine", () => {
  const dir = barePackageRoot();
  try {
    const spec = makeSpec({
      defaultSkills: ["anything-at-all"],
      providers: [{ id: "p", install: ["npx", "skills", "add", "no-repo", "--skill", "*", "-g"] }]
    });
    const row = referencedSkillsCheck(spec, withIndex([]), dir);
    assert.match(row.detail, /anything-at-all referenced by no pack/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("referenced: --skill * tronque dart-lang/skills a dart-, eas-* reste irrecevable", () => {
  const dir = barePackageRoot();
  try {
    const spec = makeSpec({
      defaultSkills: ["dart-add-unit-test", "eas-simulator"],
      providers: [
        {
          id: "dart-skills",
          install: ["npx", "skills", "add", "dart-lang/skills", "--skill", "*", "-g"]
        }
      ]
    });
    const row = referencedSkillsCheck(spec, withIndex([]), dir);
    assert.equal(row.blocking, false);
    assert.match(row.detail, /2 pack skills not installed/);
    // Le repo "dart-lang" devient le prefixe "dart-": le skill dart-* est livrable.
    assert.doesNotMatch(row.detail, /dart-add-unit-test referenced by no pack/);
    assert.match(row.detail, /eas-simulator referenced by no pack/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("referenced: provider desactive -> ses skills comptent comme irrecevables", () => {
  const dir = barePackageRoot();
  try {
    const spec = makeSpec({
      defaultSkills: ["flutter-add-widget-test"],
      providers: [
        {
          id: "flutter-skills",
          install: ["npx", "skills", "add", "flutter/skills", "--skill", "*", "-g"]
        }
      ],
      disabled: ["flutter-skills"]
    });
    const row = referencedSkillsCheck(spec, withIndex([]), dir);
    assert.match(row.detail, /flutter-add-widget-test referenced by no pack/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("referenced: argv sans --skill -> ignore, aucun prefixe", () => {
  const dir = barePackageRoot();
  try {
    const spec = makeSpec({
      defaultSkills: ["mystery"],
      providers: [{ id: "p", install: ["npx", "skills", "add", "flutter/skills", "-g"] }]
    });
    const row = referencedSkillsCheck(spec, withIndex([]), dir);
    assert.match(row.detail, /mystery referenced by no pack/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
