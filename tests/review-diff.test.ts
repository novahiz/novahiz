// Review-diff hardening (fix post-HARNESS): a malformed `changes` payload
// used to reach SQLite as a binding parameter — "Provided value cannot be
// bound to SQLite parameter 1". Every shape error must now surface as a
// readable reviewTask/parseReviewDiff message, never as a driver error.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { openDb } from "../src/db.ts";
import { addTodos, createTask, getTodo, parseReviewDiff, reviewTask } from "../src/ledger.ts";

describe("parseReviewDiff", () => {
  test("accepts undefined, empty, JSON string and plain object", () => {
    assert.deepEqual(parseReviewDiff(undefined), {});
    assert.deepEqual(parseReviewDiff(""), {});
    assert.deepEqual(parseReviewDiff('{"additions":["a"]}'), { additions: ["a"] });
    assert.deepEqual(parseReviewDiff({ removals: ["t1"] }), { removals: ["t1"] });
  });

  test("rejects invalid JSON, non-object and non-array shapes with readable messages", () => {
    assert.throws(() => parseReviewDiff("{nope"), /changes must be JSON/);
    assert.throws(() => parseReviewDiff(42), /changes must be an object/);
    assert.throws(() => parseReviewDiff(["additions"]), /changes must be an object/);
    assert.throws(() => parseReviewDiff({ order: "t1,t2" }), /changes\.order must be an array/);
    assert.throws(() => parseReviewDiff({ additions: {} }), /changes\.additions must be an array/);
  });

  test("drops unknown keys instead of forwarding them into reviewTask", () => {
    assert.deepEqual(parseReviewDiff({ additions: [], sneaky: { blob: true } }), { additions: [] });
  });
});

describe("reviewTask malformed changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-review-"));
  const db = openDb(join(dir, "review-test.sqlite"));
  const task = createTask(db, { title: "review hardening" });

  after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("removal without an id fails cleanly, never as a SQLite binding error", () => {
    assert.throws(
      () => reviewTask(db, { taskId: task.id, removals: [{}] as never }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.match(message, /review removal must be a todo id/);
        assert.doesNotMatch(message, /SQLite/);
        return true;
      }
    );
  });

  test("amendment without an id fails cleanly", () => {
    assert.throws(
      () => reviewTask(db, { taskId: task.id, amendments: [{}] as never }),
      /review amendment must be an object with a non-empty id/
    );
  });

  test("order must be an array of todo id strings", () => {
    assert.throws(
      () => reviewTask(db, { taskId: task.id, order: "nope" as never }),
      /review order must be an array of todo id strings/
    );
  });

  test("nested field values are refused before they reach SQL", () => {
    assert.throws(
      () => reviewTask(db, { taskId: task.id, additions: [{ label: "x", kind: { nested: true } }] as never }),
      /review addition kind must be a string/
    );
    assert.throws(
      () => reviewTask(db, { taskId: task.id, amendments: [{ id: "t1", label: 42 }] as never }),
      /review amendment label must be a non-empty string/
    );
  });

  test("valid review still applies: add, amend and remove", () => {
    const [first] = addTodos(db, task.id, [{ label: "first" }]);
    const added = reviewTask(db, { taskId: task.id, additions: ["second"] });
    assert.equal(added.applied.additions, 1);
    const amended = reviewTask(db, { taskId: task.id, amendments: [{ id: first.id, label: "first (amended)" }] });
    assert.equal(amended.applied.amendments, 1);
    assert.equal(getTodo(db, first.id)?.label, "first (amended)");
    const removed = reviewTask(db, { taskId: task.id, removals: [first.id] });
    assert.equal(removed.applied.removals, 1);
    assert.equal(getTodo(db, first.id)?.status, "dropped");
  });
});
