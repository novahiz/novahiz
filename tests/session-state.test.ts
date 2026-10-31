import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { spawnSync } from "node:child_process";

import { CONTINUATION_TTL_MS, isContinuation, readSessionClassification, writeSessionClassification } from "../src/session.ts";
import { openDb } from "../src/db.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("session: classification persistante", () => {
  test("write/read round-trip conserve categories, tier et prompt", () => {
    const dir = mkdtempSync(join(tmpdir(), "novahiz-session-"));
    made.push(dir);
    const db = openDb(join(dir, "ledger.sqlite"));
    writeSessionClassification(db, {
      session: "ses_test",
      categories: ["debug", "code"],
      requiredSkills: ["novahiz-implement", "novahiz-converge"],
      tier: "lite",
      prompt: "corrige le bug de connexion"
    });
    const state = readSessionClassification(db, "ses_test");
    db.close();
    assert.ok(state);
    assert.deepEqual(state!.categories, ["debug", "code"]);
    assert.deepEqual(state!.requiredSkills, ["novahiz-implement", "novahiz-converge"]);
    assert.equal(state!.tier, "lite");
    assert.equal(state!.prompt, "corrige le bug de connexion");
  });

  test("une session inconnue rend null au lieu d'un etat vide", () => {
    const dir = mkdtempSync(join(tmpdir(), "novahiz-session-"));
    made.push(dir);
    const db = openDb(join(dir, "ledger.sqlite"));
    assert.equal(readSessionClassification(db, "ses_absent"), null);
    db.close();
  });

  test("seule une tache non triviale et recente est une continuation", () => {
    const base = {
      session: "ses_test",
      categories: ["audit"],
      requiredSkills: [],
      tier: "full" as const,
      prompt: "audit de securite",
      updatedAt: new Date().toISOString()
    };
    assert.equal(isContinuation(base), true);
    assert.equal(isContinuation({ ...base, tier: "trivial" }), false);
    assert.equal(isContinuation({ ...base, prompt: "  " }), false);
    assert.equal(isContinuation({ ...base, updatedAt: new Date(Date.now() - CONTINUATION_TTL_MS - 1000).toISOString() }), false);
  });
});

describe("session: CLI classify --session", () => {
  let home = "";
  before(() => {
    home = mkdtempSync(join(tmpdir(), "novahiz-cli-session-"));
    made.push(home);
  });

  const classify = (prompt: string, session: string) =>
    spawnSync(process.execPath, ["--experimental-strip-types", join(repoRoot, "src", "cli.ts"), "classify", "--stdin", "--session", session], {
      cwd: repoRoot,
      input: prompt,
      encoding: "utf8",
      env: { ...process.env, NOVAHIZ_HOME: home }
    });

  test("\"continue\" herite de la classification non triviale precedente", () => {
    const session = "ses_continue";
    const first = classify("fix the login bug", session);
    assert.equal(first.status, 0, first.stderr);
    const firstJson = JSON.parse(first.stdout) as { categories: { id: string }[]; tier: string };
    assert.equal(firstJson.tier, "lite");
    assert.ok(firstJson.categories.some((entry) => entry.id === "debug"));

    const second = classify("continue", session);
    assert.equal(second.status, 0, second.stderr);
    const secondJson = JSON.parse(second.stdout) as { categories: { id: string }[]; tier: string; continuedFrom?: string };
    assert.equal(secondJson.tier, "lite");
    assert.ok(secondJson.categories.some((entry) => entry.id === "debug"));
    assert.equal(secondJson.continuedFrom, "fix the login bug");
  });

  test("un nouveau prompt non trivial remplace l'etat de session", () => {
    const session = "ses_replace";
    classify("fix the login bug", session);
    const second = classify("audit de securite du serveur", session);
    assert.equal(second.status, 0, second.stderr);
    const secondJson = JSON.parse(second.stdout) as { categories: { id: string }[] };
    assert.ok(secondJson.categories.some((entry) => entry.id === "audit"));
  });

  const gate = (session: string, command: string, extra: string[] = []) =>
    spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(repoRoot, "src", "cli.ts"),
        "gate",
        "--tool",
        "shell",
        "--args-stdin",
        "--session",
        session,
        ...extra
      ],
      {
        cwd: repoRoot,
        input: JSON.stringify({ command }),
        encoding: "utf8",
        env: { ...process.env, NOVAHIZ_HOME: home }
      }
    );

  test("le gate enregistre la session du projet, la ou il tourne toujours", () => {
    // Measured on 2026-10-29: project_sessions was empty for a project with
    // live sessions, because only the MCP gate recorded it and the plugin path
    // never goes through that server. resume and otherSessions read "none".
    const session = "ses_recorded_project";
    // A read-only shell command short-circuits before the ledger block, so the
    // probe uses a command that goes through the full path: blocked or allowed
    // does not matter, the session must be attached either way.
    const result = gate(session, "npm run build", ["--categories", "code", "--prompt", "implement a login button"]);
    assert.ok(result.status === 0 || result.status === 2, result.stderr);

    const db = openDb(join(home, "novahiz.sqlite"));
    try {
      const rows = db
        .prepare("SELECT project_root, session_id FROM project_sessions WHERE session_id = ?")
        .all(session) as { project_root: string; session_id: string }[];
      assert.equal(rows.length, 1, "la session doit etre rattachee a son projet");
      assert.ok(rows[0].project_root.length > 0);
    } finally {
      db.close();
    }
  });

  test("une commande shell en lecture seule passe meme gate arme", () => {    const result = gate("ses_continue", "git status", ["--categories", "", "--prompt", "implement a login button"]);
    assert.equal(result.status, 0, result.stderr);
    const json = JSON.parse(result.stdout) as { allow: boolean; readonly?: boolean };
    assert.equal(json.allow, true);
    assert.equal(json.readonly, true);
  });

  test("une commande shell qui ecrit reste gatee par l'etat de session", () => {
    const result = gate("ses_continue", "git checkout main", ["--categories", ""]);
    assert.equal(result.status, 2, result.stdout);
    const json = JSON.parse(result.stdout) as { allow: boolean; requiredSkills: string[] };
    assert.equal(json.allow, false);
    assert.ok(json.requiredSkills.includes("novahiz-implement"));
    assert.ok(json.requiredSkills.includes("novahiz-converge"));
  });

  test("sans etat ni prompt, une categorie explicite n'est pas neutralisee", () => {
    const result = gate("ses_empty", "git checkout main", ["--categories", "flutter", "--prompt", "implement a login button"]);
    assert.equal(result.status, 2, result.stdout);
    const json = JSON.parse(result.stdout) as { allow: boolean; requiredSkills: string[] };
    assert.equal(json.allow, false);
    assert.ok(json.requiredSkills.includes("novahiz-plan"));
    assert.ok(json.requiredSkills.includes("novahiz-implement"));
  });

  const gateEdit = (session: string, filePath: string, extra: string[]) =>
    spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(repoRoot, "src", "cli.ts"),
        "gate",
        "--tool",
        "edit",
        "--file",
        filePath,
        "--args-stdin",
        "--session",
        session,
        ...extra
      ],
      {
        cwd: repoRoot,
        input: JSON.stringify({ path: filePath, content: "x".repeat(600) }),
        encoding: "utf8",
        env: { ...process.env, NOVAHIZ_HOME: home }
      }
    );

  test("bout en bout Flutter: \"continue\" garde la roadmap et bloque, puis se debloque", () => {
    const session = "ses_flutter_e2e";
    const filePath = "lib/ui/features/welcome/views/welcome_view.dart";
    const first = classify("implement a Flutter login widget on the welcome screen", session);
    assert.equal(first.status, 0, first.stderr);
    const firstJson = JSON.parse(first.stdout) as { categories: { id: string }[]; tier: string };
    assert.equal(firstJson.tier, "full");
    assert.ok(firstJson.categories.some((entry) => entry.id === "flutter"));

    const cont = classify("continue", session);
    assert.equal(cont.status, 0, cont.stderr);
    const contJson = JSON.parse(cont.stdout) as { continuedFrom?: string };
    assert.ok(contJson.continuedFrom);

    const blocked = gateEdit(session, filePath, ["--categories", "flutter", "--prompt", contJson.continuedFrom!]);
    assert.equal(blocked.status, 2, blocked.stdout);
    const blockedJson = JSON.parse(blocked.stdout) as { allow: boolean; requiredSkills: string[] };
    assert.equal(blockedJson.allow, false);
    assert.ok(blockedJson.requiredSkills.includes("novahiz-plan"));
    assert.ok(blockedJson.requiredSkills.includes("novahiz-implement"));
    assert.ok(blockedJson.requiredSkills.includes("novahiz-converge"));
    assert.ok(blockedJson.requiredSkills.includes("flutter-apply-architecture-best-practices"));

    const allowed = gateEdit(session, filePath, [
      "--categories",
      "flutter",
      "--prompt",
      contJson.continuedFrom!,
      "--loaded",
      blockedJson.requiredSkills.join(",")
    ]);
    assert.equal(allowed.status, 0, allowed.stdout);
    const allowedJson = JSON.parse(allowed.stdout) as { allow: boolean; missingSkills: string[] };
    assert.equal(allowedJson.allow, true);
    assert.deepEqual(allowedJson.missingSkills, []);
  });
});
