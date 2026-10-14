import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { impeccableChecks } from "../src/commands/doctor.ts";

// Scope contract of impeccableChecks, and the exact defect it fixes.
//
// `novahiz doctor` runs at the novahiz home (src/commands/doctor.ts:506,
// `root = NovahizHome()`), and it resolved PRODUCT.md/DESIGN.md against
// `process.cwd()` (doctor.ts:710). Running doctor from home therefore produced
// two rows that were always red and that no command could ever close: the
// novahiz home is not a product anyone designs, so no `/impeccable init` belongs
// there. Observed on the 2026-10-14 run: "Impeccable product context" and
// "Impeccable design record" both failed at home root.
//
// Rows now appear only in a project directory. Both other behaviours are
// pinned by the tests below: never blocking, and nothing emitted when the
// impeccable skill is not installed.

const temp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));
const home = temp("nvz-home-");

const cleanup = (dir: string): void => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a locked temp dir must not fail the suite */
  }
};

test("cwd egal au home novahiz: aucune ligne de contexte produit", () => {
  assert.deepEqual(impeccableChecks(home, true, { home }), []);
  // The comparison resolves both sides, so a trailing separator, a `.` segment
  // or a drive-letter case difference cannot resurrect the home rows.
  assert.deepEqual(impeccableChecks(join(home, "."), true, { home }), []);
});

test("projet sans contexte: deux lignes, jamais bloquantes", () => {
  const project = temp("nvz-proj-");
  try {
    const rows = impeccableChecks(project, true, { home });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "impeccable-context");
    assert.equal(rows[1].id, "impeccable-design");
    for (const row of rows) {
      assert.equal(row.ok, false);
      assert.equal(row.blocking, false);
    }
    assert.match(rows[0].detail, /no PRODUCT\.md/);
    assert.match(rows[1].detail, /no DESIGN\.md/);
  } finally {
    cleanup(project);
  }
});

test("projet avec contexte: PRODUCT.md a la racine et DESIGN.md dans docs/", () => {
  const project = temp("nvz-proj-");
  try {
    // Source of truth for resolution is src/impeccable.ts:9,
    // CONTEXT_DIRS = ["", ".agents/context", "docs"]. Both branches are used.
    writeFileSync(join(project, "PRODUCT.md"), "# Product\n");
    mkdirSync(join(project, "docs"), { recursive: true });
    writeFileSync(join(project, "docs", "DESIGN.md"), "# Design\n");

    const rows = impeccableChecks(project, true, { home });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].ok, true);
    assert.equal(rows[1].ok, true);
    assert.match(rows[0].detail, /^PRODUCT\.md present$/);
    assert.match(rows[1].detail, /^docs\/DESIGN\.md present$/);
  } finally {
    cleanup(project);
  }
});

test("skill impeccable non installee: aucune ligne, meme sans home", () => {
  const project = temp("nvz-proj-");
  try {
    assert.deepEqual(impeccableChecks(project, false, { home }), []);
    assert.deepEqual(impeccableChecks(project, false), []);
    // A caller that omits `home` keeps the pre-scope behaviour, so the
    // signature change stays backward compatible for direct callers.
    assert.equal(impeccableChecks(home, true).length, 2);
  } finally {
    cleanup(project);
  }
});
