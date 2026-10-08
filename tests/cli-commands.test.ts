// Tests des commandes terminal Novahiz : `upgrade` (canal npm vs git),
// `stitch` (ecriture de la cle Google Stitch MCP dans la config OpenCode) et
// `gate on|off` (persistance du kill-switch).
//
// Tout est pur ou en temporaire : aucune config OpenCode reelle n'est lue ni
// ecrite, aucun reseau n'est sollicite (le flux npm n'est teste qu'au niveau
// de ses helpers deterministes).

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { checkText, compareVersions, detectTarget, npmInstalled } from "../src/commands/upgrade.ts";
import { applyStitchKey, findMatchingBrace, isValidJsonc, stripJsonComments } from "../src/commands/stitch.ts";
import { upsertGateProfile, GATE_PROFILE_BEGIN, GATE_PROFILE_END } from "../src/commands/gate.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("upgrade: compareVersions", () => {
  test("ordonne les segments numeriques", () => {
    assert.equal(compareVersions("0.6.0", "0.7.0"), -1);
    assert.equal(compareVersions("0.7.0", "0.6.0"), 1);
    assert.equal(compareVersions("0.6.0", "0.6.0"), 0);
  });

  test("compare par valeur numerique, pas lexicographiquement", () => {
    assert.equal(compareVersions("1.2.9", "1.2.10"), -1);
    assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  });

  test("segments manquants = 0, v de tete ignoree", () => {
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
    assert.equal(compareVersions("v1.2.3", "1.2.3"), 0);
  });
});

describe("upgrade: detection du canal", () => {
  test("package sous node_modules -> npm", () => {
    assert.equal(npmInstalled("/a/b/node_modules/novahiz"), true);
    assert.equal(npmInstalled("C:\\x\\AppData\\Roaming\\npm\\node_modules\\novahiz"), true);
    assert.equal(npmInstalled("/home/u/.config/novahiz"), false);
  });

  test("npm prioritaire, puis git, sinon none", () => {
    assert.equal(detectTarget("/x/node_modules/novahiz", true), "npm");
    assert.equal(detectTarget("/home/u/.config/novahiz", true), "git");
    assert.equal(detectTarget("/home/u/.config/novahiz", false), "none");
  });

  test("checkText annonce la maj disponible ou a jour", () => {
    assert.match(checkText("0.6.0", "0.7.0", "npm"), /0\.6\.0 installed, 0\.7\.0 available/);
    assert.match(checkText("0.7.0", "0.7.0", "npm"), /up to date/);
    assert.match(checkText("0.6.0", "0.7.0", "git"), /source checkout/);
  });
});

describe("stitch: applyStitchKey (chemin JSON simple)", () => {
  test("remplace le legacy Authorization par X-Goog-Api-Key et canonise", () => {
    const raw = JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        mcp: {
          stitch: {
            type: "sse",
            url: "https://stitch.withgoogle.com/mcp/sse",
            headers: { Authorization: "Bearer AQ.ANCIENNE" },
            enabled: true
          }
        }
      },
      null,
      2
    );
    const next = applyStitchKey(raw, "AQ.NOUVELLE");
    const cfg = JSON.parse(next) as {
      mcp: { stitch: { type: string; url: string; oauth: boolean; enabled: boolean; headers: Record<string, string> } };
    };
    assert.equal(cfg.mcp.stitch.type, "remote");
    assert.equal(cfg.mcp.stitch.url, "https://stitch.googleapis.com/mcp");
    assert.equal(cfg.mcp.stitch.oauth, false);
    assert.equal(cfg.mcp.stitch.enabled, true);
    assert.equal(cfg.mcp.stitch.headers["X-Goog-Api-Key"], "AQ.NOUVELLE");
    assert.equal("Authorization" in cfg.mcp.stitch.headers, false);
  });

  test("cree mcp.stitch quand mcp n'existe pas", () => {
    const next = applyStitchKey('{\n  "model": "x"\n}\n', "AQ.K");
    const cfg = JSON.parse(next) as { mcp: { stitch: { headers: Record<string, string> } } };
    assert.equal(cfg.mcp.stitch.headers["X-Goog-Api-Key"], "AQ.K");
  });

  test("met a jour une cle deja presente", () => {
    const raw = applyStitchKey("{}", "AQ.ANCIENNE");
    const next = applyStitchKey(raw, "AQ.NOUVELLE");
    const cfg = JSON.parse(next) as { mcp: { stitch: { headers: Record<string, string> } } };
    assert.equal(cfg.mcp.stitch.headers["X-Goog-Api-Key"], "AQ.NOUVELLE");
  });
});

describe("stitch: applyStitchKey (chemin JSONC, commentaires)", () => {
  test("preserve les commentaires, corrige header/type/url, reste valide", () => {
    const raw = [
      "{",
      '  // commentaire a preserver',
      '  "mcp": {',
      '    "stitch": {',
      '      "type": "sse",',
      '      "url": "https://stitch.withgoogle.com/mcp/sse",',
      '      "headers": {',
      '        "Authorization": "Bearer AQ.ANCIENNE"',
      "      },",
      '      "enabled": true',
      "    }",
      "  }",
      "}"
    ].join("\n");
    const next = applyStitchKey(raw, "AQ.NOUVELLE");
    assert.ok(next.includes("// commentaire a preserver"), "le commentaire doit survivre");
    assert.ok(next.includes('"type": "remote"'), "type canonise");
    assert.ok(next.includes('"https://stitch.googleapis.com/mcp"'), "url canonique");
    assert.ok(next.includes('"X-Goog-Api-Key": "AQ.NOUVELLE"'), "header officiel");
    assert.equal(next.includes("AQ.ANCIENNE"), false, "ancienne cle partie");
    assert.equal(isValidJsonc(next), true, "resultat JSONC valide");
  });

  test("stitch: le https d'une URL n'est pas mange par le strippeur", () => {
    const text = '{\n  // c\n  "url": "https://stitch.googleapis.com/mcp"\n}';
    const stripped = stripJsonComments(text);
    assert.ok(stripped.includes("https://stitch.googleapis.com/mcp"));
    assert.equal(stripped.includes("// c"), false);
    assert.doesNotThrow(() => JSON.parse(stripped));
  });
});

describe("stitch: findMatchingBrace", () => {
  test("ignore les accolades dans les chaines et les commentaires", () => {
    const text = '{ "a": "{x}", /* } */ "b": 1 }';
    assert.equal(findMatchingBrace(text, 0), text.length - 1);
  });

  test("reperage le bloc stitch", () => {
    const raw = '{ "mcp": { "stitch": { "a": 1 } } }';
    const start = raw.indexOf("{", raw.indexOf('"stitch"'));
    const closeAfterValue = raw.indexOf("}", raw.indexOf("1"));
    assert.equal(findMatchingBrace(raw, start), closeAfterValue);
  });
});

describe("gate on|off: upsertGateProfile", () => {
  test("ajoute le bloc marque, idempotent, puis retire", () => {
    const base = "export PATH=$PATH:/x\n";
    const off1 = upsertGateProfile(base, true);
    assert.ok(off1.includes(GATE_PROFILE_BEGIN));
    assert.ok(off1.includes("export NOVAHIZ_GATE=off"));
    assert.ok(off1.includes("export PATH=$PATH:/x"), "le profil existant est conserve");
    const off2 = upsertGateProfile(off1, true);
    assert.equal(off2, off1, "deuxieme application sans doublon");
    const on = upsertGateProfile(off1, false);
    assert.equal(on.includes(GATE_PROFILE_BEGIN), false);
    assert.equal(on.includes("NOVAHIZ_GATE"), false);
    assert.ok(on.includes("export PATH=$PATH:/x"));
  });

  test("off sur profil vide", () => {
    const off = upsertGateProfile("", true);
    assert.ok(off.includes("export NOVAHIZ_GATE=off"));
    assert.equal(upsertGateProfile(off, false).trim(), "");
  });
});

describe("stitch: ecriture fichier (contrat CLI en temporaire)", () => {
  test("applyStitchKey sur fichier reel recopie ne produit pas de perte", () => {
    const dir = mkdtempSync(join(tmpdir(), "novahiz-cli-commands-"));
    made.push(dir);
    const file = join(dir, "opencode.jsonc");
    writeFileSync(file, '{\n  "mcp": {}\n}\n', "utf8");
    const next = applyStitchKey(readFileSync(file, "utf8"), "AQ.X");
    writeFileSync(file, next, "utf8");
    const cfg = JSON.parse(stripJsonComments(readFileSync(file, "utf8"))) as { mcp: { stitch?: unknown } };
    assert.ok(cfg.mcp.stitch);
  });
});
