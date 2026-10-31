import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { classify } from "../src/classify.ts";
import { loadSpec } from "../src/spec.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const spec = loadSpec(repoRoot);

function category(result: ReturnType<typeof classify>, id: string) {
  return result.categories.find((entry) => entry.id === id);
}

describe("classify: les chemins parlent quand le prompt se tait", () => {
  test("un prompt sans vocabulaire design + un fichier css donnent design-ui", () => {
    const result = classify(spec, "ajoute le bloc de chargement", {
      files: ["app/globals.css"],
    });
    const design = category(result, "design-ui");
    assert.ok(design, `design-ui attendu, obtenu: ${result.categories.map((c) => c.id).join(", ")}`);
    assert.ok(design!.pathSignals.some((signal) => signal.includes("style file")));
  });

  test("une migration sql classe en database-supabase", () => {
    const result = classify(spec, "nouvelle table", {
      files: ["supabase/migrations/20261029_add_table.sql"],
    });
    const db = category(result, "database-supabase");
    assert.ok(db);
    assert.ok(db!.pathSignals.some((signal) => signal.includes("database path")));
  });

  test("un fichier de test pèse sur la catégorie test", () => {
    const result = classify(spec, "couvre ce cas", {
      files: ["tests/foo.test.ts"],
    });
    const tests = category(result, "test");
    assert.ok(tests);
    assert.ok(tests!.pathSignals.some((signal) => signal.includes("test path")));
  });

  test("sans fichier, aucun signal de chemin n'est inventé", () => {
    const result = classify(spec, "ajoute un bouton de connexion");
    for (const entry of result.categories) {
      assert.deepEqual(entry.pathSignals, []);
    }
  });

  test("les signaux de chemin ne créent pas de catégorie hors catalogue", () => {
    const known = new Set(spec.categories.map((entry) => entry.id));
    const result = classify(spec, "travail divers", {
      files: ["Dockerfile", "README.md", "lib/data/x.json", "app/page.tsx"],
    });
    for (const entry of result.categories) {
      assert.ok(known.has(entry.id), `catégorie inconnue: ${entry.id}`);
    }
  });
});
