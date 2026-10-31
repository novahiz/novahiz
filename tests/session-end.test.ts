import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import {
  SESSION_END_MAX_LINES,
  SESSION_END_THROTTLE_MS,
  lastSessionEnd,
  recordSessionEnd,
  sessionEndPath,
} from "../src/session-end.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "novahiz-session-end-"));
  made.push(root);
  return root;
}

const input = { session: "ses_a", bound: true, docsModified: 2, slots: 3, target: "Projects/booking/docs/booking" };
const t0 = new Date("2026-10-29T10:00:00Z");
const at = (minutes: number): Date => new Date(t0.getTime() + minutes * 60_000);

describe("session-end: une trace utile, pas une ecriture dans le vault", () => {
  test("le premier enregistrement cree le dossier et ecrit une ligne", () => {
    const root = makeProject();
    const result = recordSessionEnd(root, input, t0);
    assert.equal(result.recorded, true);
    assert.equal(result.record?.at, t0.toISOString());
    const lines = readFileSync(sessionEndPath(root), "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
  });

  test("un second idle dans la fenetre ne duplique rien", () => {
    const root = makeProject();
    recordSessionEnd(root, input, t0);
    const second = recordSessionEnd(root, input, at(1));
    assert.equal(second.recorded, false);
    assert.match(second.reason, /throttled/);
    assert.equal(readFileSync(sessionEndPath(root), "utf8").trim().split("\n").length, 1);
  });

  test("apres la fenetre, une nouvelle trace est ecrite", () => {
    const root = makeProject();
    recordSessionEnd(root, input, t0);
    const later = recordSessionEnd(root, input, at(SESSION_END_THROTTLE_MS / 60_000 + 1));
    assert.equal(later.recorded, true);
    assert.equal(readFileSync(sessionEndPath(root), "utf8").trim().split("\n").length, 2);
    assert.equal(lastSessionEnd(root, "ses_a")?.at, later.record?.at);
  });

  test("le throttle est par session, pas global", () => {
    const root = makeProject();
    recordSessionEnd(root, input, t0);
    const other = recordSessionEnd(root, { ...input, session: "ses_b" }, at(1));
    assert.equal(other.recorded, true);
    assert.equal(lastSessionEnd(root, "ses_b")?.session, "ses_b");
    assert.equal(lastSessionEnd(root, "ses_a")?.session, "ses_a");
  });

  test("une ligne illisible est ignoree, la precedente valide reste lue", () => {
    const root = makeProject();
    recordSessionEnd(root, input, t0);
    writeFileSync(sessionEndPath(root), readFileSync(sessionEndPath(root), "utf8") + "{ pas du json\n", "utf8");
    assert.equal(lastSessionEnd(root, "ses_a")?.at, t0.toISOString());
  });

  test("sans fichier, rien n'est invente", () => {
    const root = makeProject();
    assert.equal(lastSessionEnd(root, "ses_a"), null);
  });

  test("le fichier est borne : au-dela de 500 lignes il garde les 400 plus recentes", () => {
    const root = makeProject();
    const lines = Array.from({ length: SESSION_END_MAX_LINES }, (_, index) =>
      JSON.stringify({ session: `ses_${index}`, bound: false, docsModified: 0, slots: 0, target: null, at: "2026-10-29T10:00:00.000Z" })
    );
    mkdirSync(join(root, ".novahiz"), { recursive: true });
    writeFileSync(sessionEndPath(root), lines.join("\n") + "\n", "utf8");

    const result = recordSessionEnd(root, { ...input, session: "ses_final" }, t0);
    assert.equal(result.recorded, true);

    const kept = readFileSync(sessionEndPath(root), "utf8").trim().split("\n");
    assert.equal(kept.length, 400);
    assert.ok(kept[kept.length - 1].includes("ses_final"), "la ligne qui vient d'etre ecrite survit a la rotation");
    assert.ok(!kept[0].includes("ses_0"), "les plus anciennes sont retirees");
  });
});
