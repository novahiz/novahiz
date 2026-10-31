import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { readSlot, slotFormatIssues, writeEntry } from "../src/memory.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const VALID = `---
id: slot-001
title: Titre
description: Description
created: 2026-10-29T00:00:00.000Z
updated: 2026-10-29T00:00:00.000Z
chars: 10
lines: 10
limit_chars: 8000
limit_lines: 200
status: active
tags: a, b
---

## Résumé
Résumé.

## Détails
Détails.
`;

describe("format de slot: le contrat est vérifié, jamais réécrit", () => {
  test("un slot conforme ne signale rien", () => {
    assert.deepEqual(slotFormatIssues(VALID), []);
  });

  test("un frontmatter absent est signalé", () => {
    const issues = slotFormatIssues("## Résumé\nx\n\n## Détails\ny\n");
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes("frontmatter absent"));
  });

  test("une section manquante est signalée", () => {
    const withoutDetails = VALID.replace("## Détails\nDétails.\n", "");
    const issues = slotFormatIssues(withoutDetails);
    assert.ok(issues.some((issue) => issue.includes("## Détails")));
  });

  test("une clé obligatoire manquante est signalée", () => {
    const issues = slotFormatIssues(VALID.replace("status: active\n", ""));
    assert.ok(issues.some((issue) => issue.includes("status")));
  });

  test("verify et last_verdict sont contrôlés ensemble", () => {
    const withVerdict = VALID.replace("status: active\n", "status: active\nlast_verdict: ok\n");
    assert.ok(slotFormatIssues(withVerdict).some((issue) => issue.includes("sans verify")));

    const badVerdict = VALID.replace("status: active\n", "status: active\nverify: tests\nlast_verdict: done\n");
    assert.ok(slotFormatIssues(badVerdict).some((issue) => issue.includes("last_verdict invalide")));

    const badName = VALID.replace("status: active\n", "status: active\nverify: tests && rm -rf /\n");
    assert.ok(slotFormatIssues(badName).some((issue) => issue.includes("verify invalide")));
  });

  test("writeEntry ne signale rien sur un slot qu'il vient d'écrire", () => {
    const dir = mkdtempSync(join(tmpdir(), "novahiz-format-"));
    made.push(dir);
    mkdirSync(join(dir, "slots"), { recursive: true });
    const written = writeEntry({ root: dir, title: "Propre", content: "Contenu." });
    assert.equal(written.slotIssues, undefined);
  });

  test("un slot écrit à la main hors contrat est signalé à la lecture", () => {
    const dir = mkdtempSync(join(tmpdir(), "novahiz-format-"));
    made.push(dir);
    mkdirSync(join(dir, "slots"), { recursive: true });
    writeFileSync(
      join(dir, "slots", "slot-900-casse.md"),
      "---\nid: slot-900\ntitle: Cassé\n---\n\nJuste du texte.\n",
      "utf8",
    );
    const file = readSlot(dir, { id: "slot-900", file: join("slots", "slot-900-casse.md") });
    assert.ok(file.issues.length > 0);
    assert.ok(file.issues.some((issue) => issue.includes("created")));
    assert.ok(file.issues.some((issue) => issue.includes("## Résumé")));
  });
});
