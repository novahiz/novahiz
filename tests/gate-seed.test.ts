import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { isDocumentationPath, seedForClassification } from "../src/commands/gate.ts";

/**
 * The seed decides which skills a change demands. Measured 2026-10-29: editing
 * novahiz/CHANGELOG.md required 11 design skills because the changelog's own
 * prose was classified as the task.
 */
describe("gate: ce qui sert d'amorce a la classification", () => {
  const prose = "design impeccable wireframe humanizer polish ui slop typography";

  test("un prompt explicite gagne toujours", () => {
    assert.equal(seedForClassification({ prompt: "corrige le tunnel", content: prose, paths: [] }), "corrige le tunnel");
  });

  test("une documentation ne classe jamais sur son propre contenu", () => {
    for (const path of ["CHANGELOG.md", "README.md", "docs/guide.md", "novahiz-docs/ARCHITECTURE.md"]) {
      assert.equal(seedForClassification({ prompt: "", content: prose, paths: [path] }), "", path);
    }
  });

  test("un chemin absolu Windows reste reconnu", () => {
    assert.equal(isDocumentationPath("C:\\Users\\x\\projet\\CHANGELOG.md"), true);
    assert.equal(isDocumentationPath("C:/Users/x/projet/docs/guide.md"), true);
  });

  test("un wireframe n'est pas une documentation : son contenu peut parler", () => {
    assert.equal(isDocumentationPath("wireframes/espace-client/screen.md"), false);
    assert.equal(
      seedForClassification({ prompt: "", content: prose, paths: ["wireframes/espace-client/screen.md"] }),
      prose
    );
  });

  test("du code garde son contenu comme amorce", () => {
    assert.equal(seedForClassification({ prompt: "", content: "export const x = 1;", paths: ["src/gate.ts"] }), "export const x = 1;");
  });

  test("sans contenu ni prompt, le chemin sert d'amorce", () => {
    assert.equal(seedForClassification({ prompt: "", content: "", paths: ["src/components/BookingCard.tsx"] }), "src/components/BookingCard.tsx");
  });

  test("un lot mixte doc + code ne profite pas de l'exception", () => {
    // Only when *every* path is documentation is the prose ignored: a mixed
    // change is not a documentation change.
    assert.equal(
      seedForClassification({ prompt: "", content: prose, paths: ["CHANGELOG.md", "src/gate.ts"] }),
      prose
    );
  });
});
