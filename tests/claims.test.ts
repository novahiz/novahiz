import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { claimPaths, conflictingClaim, listClaims, releasePaths } from "../src/claims.ts";
import { openDb } from "../src/db.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function fresh(): { db: ReturnType<typeof openDb>; root: string } {
  const root = mkdtempSync(join(tmpdir(), "novahiz-claims-"));
  made.push(root);
  return { db: openDb(join(root, "ledger.sqlite")), root };
}

describe("claims: une session réserve ses chemins", () => {
  test("deux sessions ne peuvent pas tenir le même chemin", () => {
    const { db, root } = fresh();
    const file = join(root, "a.ts");

    const first = claimPaths(db, { session: "ses_a", paths: [file] });
    assert.deepEqual(first.conflicts, []);
    assert.equal(first.claimed.length, 1);

    const second = claimPaths(db, { session: "ses_b", paths: [file] });
    assert.equal(second.claimed.length, 0);
    assert.equal(second.conflicts.length, 1);
    assert.equal(second.conflicts[0].session, "ses_a");
    db.close();
  });

  test("la même session peut rafraîchir sa réservation", () => {
    const { db, root } = fresh();
    const file = join(root, "b.ts");
    claimPaths(db, { session: "ses_a", paths: [file], ttlMinutes: 5 });
    const again = claimPaths(db, { session: "ses_a", paths: [file], ttlMinutes: 60 });
    db.close();

    assert.equal(again.conflicts.length, 0);
    assert.equal(again.claimed.length, 1);
  });

  test("libérer rend le chemin disponible", () => {
    const { db, root } = fresh();
    const file = join(root, "c.ts");
    claimPaths(db, { session: "ses_a", paths: [file] });
    const released = releasePaths(db, { session: "ses_a", paths: [file] });
    const after = claimPaths(db, { session: "ses_b", paths: [file] });
    db.close();

    assert.equal(released.released.length, 1);
    assert.equal(after.conflicts.length, 0);
    assert.equal(after.claimed.length, 1);
  });

  test("une réservation expirée ne bloque plus", () => {
    const { db, root } = fresh();
    const file = join(root, "d.ts");
    db.prepare(
      "INSERT INTO file_claims (path_key, path, session_id, reason, claimed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      process.platform === "win32" ? file.toLowerCase() : file,
      file,
      "ses_old",
      null,
      new Date(Date.now() - 120_000).toISOString(),
      new Date(Date.now() - 60_000).toISOString(),
    );
    const outcome = claimPaths(db, { session: "ses_new", paths: [file] });
    db.close();

    assert.equal(outcome.conflicts.length, 0);
    assert.equal(outcome.claimed.length, 1);
  });

  test("conflictingClaim ignore la session propriétaire et signale l'autre", () => {
    const { db, root } = fresh();
    const file = join(root, "e.ts");
    claimPaths(db, { session: "ses_a", paths: [file], reason: "refonte" });

    assert.equal(conflictingClaim(db, { session: "ses_a", filePath: file }), null);
    const conflict = conflictingClaim(db, { session: "ses_b", filePath: file });
    db.close();

    assert.ok(conflict);
    assert.equal(conflict!.session_id, "ses_a");
    assert.equal(conflict!.reason, "refonte");
  });

  test("listClaims purge les réservations expirées", () => {
    const { db, root } = fresh();
    const file = join(root, "f.ts");
    db.prepare(
      "INSERT INTO file_claims (path_key, path, session_id, reason, claimed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      process.platform === "win32" ? file.toLowerCase() : file,
      file,
      "ses_old",
      null,
      new Date(Date.now() - 120_000).toISOString(),
      new Date(Date.now() - 60_000).toISOString(),
    );
    const rows = listClaims(db);
    db.close();
    assert.equal(rows.length, 0);
  });
});
