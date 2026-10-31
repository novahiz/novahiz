import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "mcp", "novahiz-tools", "index.mjs"), "utf8");

/**
 * Static surface check for the safety-net tools.
 *
 * The live behaviour is covered by the unit tests and by one JSON-RPC smoke run;
 * this only catches the drift that shipped twice already — a schema entry with
 * no handler, or a handler nobody can call.
 */
describe("MCP: la surface de la securite est declaree et servie", () => {
  for (const name of ["novahiz_backup", "novahiz_improve", "novahiz_repair"]) {
    test(`${name} est declare dans TOOLS`, () => {
      assert.ok(source.includes(`name: "${name}"`), `${name} absent du schema MCP`);
    });

    test(`${name} a un branchement`, () => {
      assert.ok(source.includes(`if (name === "${name}")`), `${name} declare mais non servi`);
    });
  }

  test("restore et apply exigent un confirm egal a l'identifiant", () => {
    assert.ok(/restore requires confirm equal to the backup id/.test(source));
    assert.ok(/apply requires confirm equal to the proposal id/.test(source));
  });

  test("les outils sont importes du coeur, pas reimplementes", () => {
    assert.ok(source.includes('from "../../src/backup.ts"'));
    assert.ok(source.includes('from "../../src/improve.ts"'));
    assert.ok(source.includes('from "../../src/repair.ts"'));
  });

  test("reopen existe aussi cote MCP, pas seulement en CLI", () => {
    assert.ok(source.includes('enum: ["scan", "list", "show", "dismiss", "apply", "reopen"]'), "l'action doit etre declaree");
    assert.ok(source.includes('if (action === "reopen")'), "et servie");
  });

  test("le serveur MCP gate partage la regle de seed du CLI", () => {    // Two copies of the seed rule drifted once already: the CLI stopped
    // classifying documentation from its prose, the MCP server kept doing it
    // (measured 2026-10-29 on novahiz/CHANGELOG.md).
    const gateServer = readFileSync(join(here, "..", "mcp", "novahiz-gate", "index.mjs"), "utf8");
    assert.ok(gateServer.includes('from "../../src/seed.ts"'), "le serveur MCP doit importer src/seed.ts");
    assert.ok(gateServer.includes("seedForClassification("), "le serveur MCP doit utiliser la regle partagee");
    assert.ok(
      !/const seed =\s*\n?\s*\(typeof args\?\.prompt/.test(gateServer),
      "l'ancienne amorce locale ne doit pas revenir"
    );
  });

  test("le hook de fin de session ecoute un evenement que ce harness emet", () => {
    // Measured 2026-10-29: the plugin listened for `session.idle`, which this
    // harness never emits (logs/plugin-events.log lists 41 real types and that
    // name is not among them). The trace never fired because the trigger was a
    // name that does not exist.
    const plugin = readFileSync(join(here, "..", "adapters", "opencode", "novahiz-plugin.ts"), "utf8");
    assert.ok(
      plugin.includes('event.type === "session.execution.succeeded"'),
      "le declencheur doit etre un evenement reellement emis"
    );
    assert.ok(plugin.includes("second-memory"), "et il doit lancer la trace");
  });
});
