import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { SAFE_TABLES } from "../src/db.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(repoRoot, "src", "db.ts"), "utf8");

/** Every table the schema creates, in order of appearance. */
function createdTables(): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * ensureColumn refuses any table missing from SAFE_TABLES, and migrate() runs
 * on every openDb. A table created in the schema but forgotten in the allowlist
 * therefore breaks EVERY project at once: the 2026-10-29 outage started with
 * exactly that — `evidence` and `file_claims` were added without the allowlist,
 * so classify, the gate, the ledger and memory all threw.
 */
describe("db schema: toute table est dans SAFE_TABLES", () => {
  test("le schéma crée au moins les tables connues", () => {
    const tables = createdTables();
    assert.ok(tables.includes("tasks"));
    assert.ok(tables.includes("evidence"));
    assert.ok(tables.includes("file_claims"));
    assert.ok(tables.includes("plan_history"));
  });

  test("aucune table du schéma n'est absente de l'allowlist", () => {
    const missing = createdTables().filter((table) => !SAFE_TABLES.has(table));
    assert.deepEqual(missing, [], `tables absentes de SAFE_TABLES: ${missing.join(", ")}`);
  });

  test("aucune entrée de l'allowlist ne désigne une table inexistante", () => {
    const tables = new Set(createdTables());
    const ghosts = [...SAFE_TABLES].filter((table) => !tables.has(table));
    assert.deepEqual(ghosts, [], `entrées mortes dans SAFE_TABLES: ${ghosts.join(", ")}`);
  });
});
