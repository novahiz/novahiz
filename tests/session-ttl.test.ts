import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { openDb } from "../src/db.ts";
import { pruneSessions } from "../src/ledger.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function freshDb(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-ttl-"));
  made.push(dir);
  return openDb(join(dir, "ledger.sqlite"));
}

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

/**
 * Le TTL de session doit mesurer l'inactivité, pas le temps écoulé depuis la
 * dernière classification. Sinon une session qui charge des skills après sa
 * classification (cas réel : 4 h de travail) perd ses skills et l'agent boucle
 * sur GATE RELOAD.
 */
describe("session TTL: inactivité, pas ancienneté de classification", () => {
  test("une session classée il y a 5 h mais active il y a 1 min survit", () => {
    const db = freshDb();
    const fiveHours = 5 * 60 * 60 * 1000;
    db.prepare("INSERT INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)").run(
      "ses_active",
      iso(fiveHours),
    );
    db.prepare("INSERT INTO skill_invocations (session_id, skill, invoked_at) VALUES (?, ?, ?)").run(
      "ses_active",
      "novahiz-implement",
      iso(60 * 1000),
    );

    const removed = pruneSessions(db);
    const skills = db
      .prepare("SELECT skill FROM skill_invocations WHERE session_id = ?")
      .all("ses_active") as { skill: string }[];
    const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get("ses_active");
    db.close();

    assert.equal(removed, 0);
    assert.deepEqual(
      skills.map((row) => row.skill),
      ["novahiz-implement"],
    );
    assert.ok(session, "la session active ne doit pas être supprimée");
  });

  test("une session inactive partout depuis 5 h est purgée avec ses skills", () => {
    const db = freshDb();
    const fiveHours = 5 * 60 * 60 * 1000;
    db.prepare("INSERT INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)").run(
      "ses_idle",
      iso(fiveHours),
    );
    db.prepare("INSERT INTO skill_invocations (session_id, skill, invoked_at) VALUES (?, ?, ?)").run(
      "ses_idle",
      "novahiz-plan",
      iso(fiveHours),
    );

    const removed = pruneSessions(db);
    const skills = db.prepare("SELECT COUNT(*) AS n FROM skill_invocations WHERE session_id = ?").get("ses_idle") as {
      n: number;
    };
    const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get("ses_idle");
    db.close();

    assert.equal(removed, 2);
    assert.equal(Number(skills.n), 0);
    assert.equal(session, undefined);
  });

  test("une session classée récemment mais sans skill reste vivante", () => {
    const db = freshDb();
    db.prepare("INSERT INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)").run(
      "ses_fresh",
      iso(1000),
    );

    const removed = pruneSessions(db);
    const session = db.prepare("SELECT id FROM sessions WHERE id = ?").get("ses_fresh");
    db.close();

    assert.equal(removed, 0);
    assert.ok(session);
  });
});
