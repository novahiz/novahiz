import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { scanPaths, scanText } from "../src/secrets.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("secrets: ce qu'une session ecrit ne doit pas contenir de mot de passe", () => {
  test("un appel de server action avec mot de passe est detecte et masque", () => {
    const findings = scanText('seConnecter("contact@example.com", "Takecare96")', "dev.log");
    assert.equal(findings.length, 0, "sans clé password=, ce n'est pas un motif détectable");
  });

  test("password= est detecte, la valeur est masquee", () => {
    const findings = scanText('POST /login password=Sup3rSecret!', "dev.log");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].kind, "password-assignment");
    assert.ok(findings[0].excerpt.includes("Sup"));
    assert.ok(!findings[0].excerpt.includes("Sup3rSecret"));
  });

  test("un jeton Bearer est detecte et masque", () => {
    const findings = scanText("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature123456", "net.log");
    assert.ok(findings.some((entry) => entry.kind === "jwt" || entry.kind === "bearer-token"));
    for (const finding of findings) {
      assert.ok(!finding.excerpt.includes("eyJhbGciOiJIUzI1NiJ9.payload.signature123456"));
    }
  });

  test("une chaine de connexion avec mot de passe est masquee", () => {
    const findings = scanText("DATABASE_URL=postgres://admin:hunter2@db.internal:5432/app", ".env.local");
    const connection = findings.find((entry) => entry.kind === "connection-string");
    assert.ok(connection);
    assert.ok(connection!.excerpt.includes("hun***"));
    assert.ok(!connection!.excerpt.includes("hunter2"));
  });

  test("un placeholder n'est pas un secret", () => {
    const findings = scanText("password=changeme\nmotDePasse: placeholder", "notes.md");
    assert.deepEqual(findings, []);
  });

  test("scanPaths parcourt les artefacts et ignore le binaire", () => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-secrets-"));
    made.push(root);
    mkdirSync(join(root, "tmp"), { recursive: true });
    writeFileSync(join(root, "tmp", "dev.log"), "x\npassword=SuperSecret42\n", "utf8");
    writeFileSync(join(root, "tmp", "image.png"), "password=NotScanned1", "utf8");

    const findings = scanPaths(root, ["tmp"]);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, "tmp/dev.log");
    assert.equal(findings[0].line, 2);
  });
});
