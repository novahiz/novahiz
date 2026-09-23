import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog, loadInstalledSkills, scanSkills, writeCatalog, writeSkillIndex } from "../src/catalog.ts";
import { loadSpec } from "../src/spec.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

function tempSpec(): { dir: string; spec: ReturnType<typeof loadSpec> } {
  const base = loadSpec(root);
  const dir = mkdtempSync(join(tmpdir(), "novahiz-catalog-"));
  const skillDir = join(dir, "skills", "zeta");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: zeta\ndescription: demo skill\n---\n\nbody\n", "utf8");
  const spec = { ...base, root: dir, config: { ...base.config, skillRoots: ["skills"] } };
  return { dir, spec };
}

test("scanSkills reads frontmatter from a temp skill root", () => {
  const { dir, spec } = tempSpec();
  try {
    const skills = scanSkills(spec);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].id, "zeta");
    assert.equal(skills[0].description, "demo skill");
    assert.equal(skills[0].power, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeSkillIndex and loadInstalledSkills round-trip", () => {
  const { dir, spec } = tempSpec();
  try {
    const skills = scanSkills(spec);
    const indexFile = writeSkillIndex(spec, skills);
    assert.ok(indexFile.endsWith("installed-skills.json"));
    const index = loadInstalledSkills(spec);
    assert.equal(index.available, true);
    assert.deepEqual([...index.skills], ["zeta"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeCatalog and loadCatalog round-trip", () => {
  const { dir, spec } = tempSpec();
  try {
    const skills = scanSkills(spec);
    writeCatalog(spec, skills);
    const catalog = loadCatalog(spec);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].id, "zeta");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadInstalledSkills reports unavailable without an index", () => {
  const { dir, spec } = tempSpec();
  try {
    const index = loadInstalledSkills(spec);
    assert.equal(index.available, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
