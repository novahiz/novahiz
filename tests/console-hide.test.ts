// FIX fenetres console Windows: les spawns du plugin s'executent dans le
// service OpenCode, qui n'a pas de console — sans windowsHide, Windows en
// cree une visible pour chaque enfant (classify, gate, lecture/écriture
// one-shot) puis la referme, d'ou le clignotement observe a chaque action.
// Test statique: chaque site de spawn des fichiers executes en session porte
// l'option cachee. install/hooks.mjs (2e site) n'existe plus depuis le
// 2026-10-03.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

const SESSION_FILES = [join(process.cwd(), "adapters", "opencode", "novahiz.ts")];

// Compte les appels reels: la parenthese suit le nom, donc l'import
// "import { spawn, spawnSync }" (sans parenthese) ne compte pas.
const countSpawns = (source: string): number =>
  (source.match(/\b(?:spawnSync|spawn)\(/g) ?? []).length;
const countHidden = (source: string): number =>
  (source.match(/windowsHide:\s*true/g) ?? []).length;

describe("FIX fenetres console - windowsHide sur les spawns de session", () => {
  for (const file of SESSION_FILES) {
    test(`${file} - chaque spawn porte windowsHide: true`, () => {
      const source = readFileSync(file, "utf8");
      const spawns = countSpawns(source);
      const hidden = countHidden(source);
      assert.ok(spawns > 0, `aucun spawn detecte dans ${file}: le regex ne suit plus le code`);
      assert.equal(
        hidden,
        spawns,
        `${file}: ${spawns} site(s) de spawn mais ${hidden} windowsHide: true`
      );
    });
  }
});
