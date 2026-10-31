import assert from "node:assert/strict";
import test from "node:test";

import { capture } from "../src/gate-capture.ts";

/**
 * Régression du 2026-10-31 : le démon laissait `process.exitCode = 2` après
 * une requête qui lève, et toutes les réponses suivantes étaient annoncées
 * comme des refus — sans skill manquante et sans raison. Le gate refusait
 * alors toute écriture, y compris hors dépôt.
 */

test("capture rapporte le code de sortie posé par la commande", () => {
  const result = capture(() => {
    process.exitCode = 2;
  });

  assert.equal(result.status, 2);
  // Restauré : rien ne fuit vers l'appel suivant.
  assert.notEqual(process.exitCode, 2);
});

test("capture restaure le code de sortie même quand la commande lève", () => {
  const avant = process.exitCode;

  assert.throws(
    () =>
      capture(() => {
        process.exitCode = 2;
        throw new Error("boum");
      }),
    /boum/,
  );

  assert.equal(process.exitCode, avant);
});

test("une requête qui lève ne contamine pas la suivante", () => {
  try {
    capture(() => {
      process.exitCode = 2;
      throw new Error("boum");
    });
  } catch {
    /* attendu */
  }

  const suivante = capture(() => {
    // verdict autorisé, aucune raison
  });

  assert.equal(suivante.status, 0);
});

test("capture isole stdout et stderr", () => {
  const result = capture(() => {
    process.stdout.write("verdict");
    process.stderr.write("diagnostic");
  });

  assert.equal(result.stdout, "verdict");
  assert.equal(result.stderr, "diagnostic");
  assert.equal(result.status, 0);
});
