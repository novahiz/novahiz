import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { openDb } from "../src/db.ts";
import { UNMEASURABLE_EXIT_CODE, runVerification } from "../src/evidence.ts";
import { claimVerdict } from "../src/commands/docs.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function project(): { root: string; db: ReturnType<typeof openDb> } {
  const root = mkdtempSync(join(tmpdir(), "novahiz-unmeasurable-"));
  made.push(root);
  mkdirSync(join(root, ".novahiz"), { recursive: true });
  writeFileSync(
    join(root, ".novahiz", "verify.json"),
    JSON.stringify({
      commands: {
        pass: "node -p 42",
        fail: 'node -e "process.exit(7)"',
        unmeasurable: `node -e "process.exit(${UNMEASURABLE_EXIT_CODE})"`,
        silent: "node -p 1",
      },
    }),
    "utf8"
  );
  return { root, db: openDb(join(root, "ledger.sqlite")) };
}

describe("verify: une mesure impossible n'est pas un mensonge", () => {
  test("exit 0 est une preuve", () => {
    const { root, db } = project();
    try {
      const outcome = runVerification(db, { projectRoot: root, name: "pass" });
      assert.equal(outcome.ok, true);
      assert.equal(outcome.inconclusive, false);
      assert.equal(outcome.exitCode, 0);
    } finally {
      db.close();
    }
  });

  test("exit non nul est une contradiction", () => {
    const { root, db } = project();
    try {
      const outcome = runVerification(db, { projectRoot: root, name: "fail" });
      assert.equal(outcome.ok, false);
      assert.equal(outcome.inconclusive, false);
      assert.equal(outcome.exitCode, 7);
    } finally {
      db.close();
    }
  });

  test("exit 3 est inconclusif : pas ok, pas faux", () => {
    const { root, db } = project();
    try {
      const outcome = runVerification(db, { projectRoot: root, name: "unmeasurable" });
      assert.equal(outcome.ok, false, "une mesure impossible ne prouve rien");
      assert.equal(outcome.inconclusive, true);
      assert.match(String(outcome.error), /measurement impossible/);
      assert.equal(claimVerdict(outcome), "unknown");
    } finally {
      db.close();
    }
  });

  test("un expect non satisfait reste un echec, pas une incertitude", () => {
    const { root, db } = project();
    try {
      const outcome = runVerification(db, { projectRoot: root, name: "silent", expect: "42" });
      assert.equal(outcome.inconclusive, false);
      assert.equal(claimVerdict(outcome), "failed");
    } finally {
      db.close();
    }
  });

  test("une commande inconnue est une incertitude, pas un echec", () => {
    const { root, db } = project();
    try {
      const outcome = runVerification(db, { projectRoot: root, name: "absente" });
      assert.equal(claimVerdict(outcome), "unknown");
    } finally {
      db.close();
    }
  });

  test("sans fichier de verification, l'incertitude est explicite", () => {
    const root = mkdtempSync(join(tmpdir(), "novahiz-unmeasurable-"));
    made.push(root);
    const db = openDb(join(root, "ledger.sqlite"));
    try {
      const outcome = runVerification(db, { projectRoot: root, name: "pass" });
      assert.equal(claimVerdict(outcome), "unknown");
      assert.match(String(outcome.error), /no verify config/);
    } finally {
      db.close();
    }
  });

  test("l'enregistrement de preuve conserve le code et le caractere inconclusif", () => {
    const { root, db } = project();
    try {
      const outcome = runVerification(db, { projectRoot: root, name: "unmeasurable" });
      const row = db.prepare("SELECT exit_code, ok FROM evidence WHERE id = ?").get(outcome.evidenceId) as {
        exit_code: number;
        ok: number;
      };
      assert.equal(row.exit_code, UNMEASURABLE_EXIT_CODE);
      assert.equal(row.ok, 0);
    } finally {
      db.close();
    }
  });
});
