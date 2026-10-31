import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { enforcedOfCategory } from "../src/classify.ts";
import { buildSkillpack } from "../src/skillpack.ts";
import { loadSpec } from "../src/spec.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = loadSpec(repoRoot);

describe("skillpack: une carte compacte avant de charger", () => {
  test("le pack d'une categorie decrit des skills reelles", () => {
    const pack = buildSkillpack(spec, { category: "design-ui", maxChars: 6000 });
    assert.equal(pack.category, "design-ui");
    assert.ok(pack.skills.length > 0);
    for (const skill of pack.skills) {
      assert.equal(skill.found, true, `${skill.id} introuvable sur disque`);
      assert.ok(skill.description.length > 0, `${skill.id} sans description`);
    }
  });

  test("le budget est respecte et les omissions sont declarees", () => {
    const pack = buildSkillpack(spec, { category: "design-ui", maxChars: 1200 });
    assert.ok(pack.totalChars <= 1200);
    assert.ok(pack.skipped.length > 0);
    assert.ok(pack.notes.some((note) => note.includes("omise")));
  });

  test("les skills exigees passent avant les optionnelles", () => {
    const pack = buildSkillpack(spec, { category: "design-ui", maxChars: 1200 });
    const category = spec.categories.find((entry) => entry.id === "design-ui")!;
    const enforced = new Set(enforcedOfCategory(category));
    const described = pack.skills.map((skill) => skill.id);
    const enforcedDescribed = described.filter((id) => enforced.has(id));
    // Tout ce qui est décrit avant la première optionnelle doit être exigé.
    const firstOptional = described.findIndex((id) => !enforced.has(id));
    if (firstOptional !== -1) {
      assert.ok(
        described.slice(firstOptional).every((id) => !enforced.has(id)),
        `ordre incorrect: ${described.join(", ")}`,
      );
    }
    assert.ok(enforcedDescribed.length > 0);
  });

  test("une categorie inconnue est signalee, pas inventee", () => {
    const pack = buildSkillpack(spec, { category: "pas-une-categorie" });
    assert.equal(pack.category, null);
    assert.deepEqual(pack.skills, []);
    assert.ok(pack.notes.some((note) => note.includes("catégorie inconnue")));
  });

  test("une skill absente du disque est signalee found=false", () => {
    const pack = buildSkillpack(spec, { skills: ["skill-inexistante-xyz"] });
    assert.equal(pack.skills.length, 1);
    assert.equal(pack.skills[0].found, false);
    assert.ok(pack.skills[0].description.includes("introuvable"));
  });
});
