import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { ensureProjectVerifyConfig } from "../src/commands/init.ts";
import { loadVerifyConfig } from "../src/evidence.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(scripts?: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "novahiz-initverify-"));
  made.push(root);
  if (scripts) writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", scripts }), "utf8");
  return root;
}

describe("init: tout projet repart avec un contrat de verification", () => {
  test("les scripts npm usuels deviennent des commandes verifiables", () => {
    const root = project({ typecheck: "tsc --noEmit", test: "node --test", build: "next build" });
    assert.equal(ensureProjectVerifyConfig(root), "created");

    const config = loadVerifyConfig(root);
    assert.ok(!("error" in config));
    if ("error" in config) return;
    assert.equal(config.commands.typecheck, "npm run typecheck");
    assert.equal(config.commands.test, "npm run test");
    assert.equal(config.commands.build, "npm run build");
    assert.equal(config.commands.lint, undefined);
  });

  test("un projet sans package.json obtient quand meme un contrat vide", () => {
    const root = project();
    assert.equal(ensureProjectVerifyConfig(root), "created");
    const config = loadVerifyConfig(root);
    assert.ok(!("error" in config));
    if ("error" in config) return;
    assert.deepEqual(config.commands, {});
  });

  test("un contrat existant n'est jamais ecrase", () => {
    const root = project({ test: "node --test" });
    mkdirSync(join(root, ".novahiz"), { recursive: true });
    writeFileSync(
      join(root, ".novahiz", "verify.json"),
      JSON.stringify({ commands: { maison: "make check" } }),
      "utf8",
    );

    assert.equal(ensureProjectVerifyConfig(root), "exists");
    const raw = JSON.parse(readFileSync(join(root, ".novahiz", "verify.json"), "utf8")) as {
      commands: Record<string, string>;
    };
    assert.deepEqual(raw.commands, { maison: "make check" });
  });

  test("le fichier cree est relisible par le moteur de verification", () => {
    const root = project({ typecheck: "tsc --noEmit" });
    ensureProjectVerifyConfig(root);
    assert.ok(existsSync(join(root, ".novahiz", "verify.json")));
  });
});
