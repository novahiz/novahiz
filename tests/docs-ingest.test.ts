// Modes CLI du serveur novahiz-docs (--status / --ingest) : parseur, codes
// de sortie et garde-fous reseau. Aucun test n'ouvre le reseau (--dry partout)
// et l'index reel n'est jamais touche (NOVAHIZ_DOCS_DB -> fichier temp).
// Dernier test : le mode MCP stdio reste intact apres la bride CLI.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, test } from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = join(repoRoot, "mcp", "novahiz-docs", "index.mjs");
const temp = mkdtempSync(join(tmpdir(), "novahiz-docs-cli-"));
const dbPath = join(temp, "index.sqlite");

function run(args: string[]) {
  return spawnSync(process.execPath, [INDEX, ...args], {
    encoding: "utf8",
    env: { ...process.env, NOVAHIZ_DOCS_DB: dbPath },
    timeout: 60000
  });
}

describe("novahiz-docs CLI", () => {
  test("--status : etat JSON coherent pour chaque bibliotheque", () => {
    const res = run(["--status"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout) as {
      indexed: number;
      total: number;
      libraries: Array<{ id: string; chunks: number }>;
    };
    assert.ok(out.total >= 10, "au moins le bouquet de depart");
    assert.equal(out.libraries.length, out.total, "une ligne par bibliotheque");
    assert.equal(out.indexed, out.libraries.filter((line) => line.chunks > 0).length, "compteur indexe coherent");
    assert.ok(out.libraries.some((line) => line.id === "react"));
  });

  test("--ingest --dry : liste les cibles sans reseau", () => {
    const res = run(["--ingest", "--dry", "react,typescript"]);
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout) as { dryRun: boolean; targets: string[] };
    assert.equal(out.dryRun, true);
    assert.deepEqual(out.targets, ["react", "typescript"]);
  });

  test("--dry apres la liste se comporte pareil (parseur d'ordre libre)", () => {
    const res = run(["--ingest", "react", "--dry"]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual((JSON.parse(res.stdout) as { targets: string[] }).targets, ["react"]);
  });

  test("id inconnu -> exit 1 avant tout reseau", () => {
    const res = run(["--ingest", "react,notalib", "--dry"]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /notalib/);
  });

  test("--ingest sans spec -> usage, exit 2", () => {
    const res = run(["--ingest"]);
    assert.equal(res.status, 2);
    assert.match(res.stderr, /usage/);
  });

  test("--all --dry : tout le bouquet", () => {
    const res = run(["--ingest", "--all", "--dry"]);
    assert.equal(res.status, 0, res.stderr);
    assert.ok((JSON.parse(res.stdout) as { targets: string[] }).targets.length >= 50);
  });

  test("mode MCP stdio intact : handle() repond a initialize", () => {
    const code = `
      import { handle } from ${JSON.stringify(pathToFileURL(INDEX).href)};
      const r = handle({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2026-07-28", capabilities: {}, clientInfo: { name: "t", version: "1" } }
      });
      process.stdout.write(JSON.stringify({ server: r?.result?.serverInfo?.name ?? null, error: r?.error?.message ?? null }));
    `;
    const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      env: { ...process.env, NOVAHIZ_DOCS_DB: dbPath },
      timeout: 60000
    });
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout) as { server: string | null; error: string | null };
    assert.equal(out.error, null, out.error ?? "");
    assert.match(String(out.server), /novahiz-docs/);
  });
});
