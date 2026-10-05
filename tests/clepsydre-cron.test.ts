// Parseur clepsydre : trois formes d'expression, semantique cron Vixie,
// calendrier local (fuseau IANA) et comportement heure d'ete. Toutes les
// dates attendues sont explicites en UTC pour que le test ne depende pas du
// fuseau de la machine.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  describeSchedule,
  nextRun,
  parseSchedule,
  ScheduleError
} from "../mcp/clepsydre/src/cron.ts";

const at = (iso: string): number => Date.parse(iso);
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

describe("parseSchedule", () => {
  test("expression cron 5 champs", () => {
    const schedule = parseSchedule("*/5 * * * *");
    assert.equal(schedule.kind, "cron");
    if (schedule.kind !== "cron") return;
    assert.deepEqual(schedule.fields.minutes, [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    assert.equal(schedule.fields.domRestricted, false);
    assert.equal(schedule.fields.dowRestricted, false);
  });

  test("plages, pas et listes", () => {
    const schedule = parseSchedule("5-10/2 * * * *");
    assert.equal(schedule.kind, "cron");
    if (schedule.kind !== "cron") return;
    assert.deepEqual(schedule.fields.minutes, [5, 7, 9]);
    const list = parseSchedule("0,30 9-17 * * *");
    if (list.kind !== "cron") return;
    assert.deepEqual(list.fields.minutes, [0, 30]);
    assert.equal(list.fields.hours.length, 9);
  });

  test("noms de mois et de jours", () => {
    const schedule = parseSchedule("0 12 * jan mon");
    if (schedule.kind !== "cron") return;
    assert.deepEqual(schedule.fields.months, [1]);
    assert.deepEqual(schedule.fields.daysOfWeek, [1]);
    // 7 = dimanche, ramene a 0
    const sunday = parseSchedule("0 0 * * 7");
    if (sunday.kind !== "cron") return;
    assert.deepEqual(sunday.fields.daysOfWeek, [0]);
  });

  test("macros reconnues", () => {
    for (const macro of ["@hourly", "@daily", "@weekly", "@monthly", "@yearly", "@annually", "@midnight"]) {
      assert.equal(parseSchedule(macro).kind, "cron", macro);
    }
    const hourly = parseSchedule("@hourly");
    if (hourly.kind !== "cron") return;
    assert.deepEqual(hourly.fields.minutes, [0]);
  });

  test("@reboot refuse avec une explication", () => {
    assert.throws(
      () => parseSchedule("@reboot"),
      (error: unknown) =>
        error instanceof ScheduleError && error.message.includes("@reboot") && error.message.includes("boot")
    );
  });

  test("erreur claire sur une expression mal formee", () => {
    assert.throws(() => parseSchedule("* /5 * * * *"), /5 attendus/);
    assert.throws(() => parseSchedule(""), /schedule vide/);
    assert.throws(() => parseSchedule("61 * * * *"), /minute : 61 hors bornes 0-59/);
    assert.throws(() => parseSchedule("* * * *"), /4 champs/);
    assert.throws(() => parseSchedule("0 0 10-2 * *"), /intervalle inverse/);
    assert.throws(() => parseSchedule("@never"), /macro inconnue/);
  });

  test("intervalles every", () => {
    assert.equal(parseSchedule("every 30s").kind, "interval");
    const interval = parseSchedule("every 10m");
    assert.equal(interval.kind, "interval");
    if (interval.kind !== "interval") return;
    assert.equal(interval.ms, 600_000);
    assert.throws(() => parseSchedule("every 5 parsecs"), /unite inconnue/);
    assert.throws(() => parseSchedule("every minutes"), /interval mal forme/);
  });

  test("date ISO one-shot", () => {
    const once = parseSchedule("2026-10-05T09:00:00Z");
    assert.equal(once.kind, "once");
    if (once.kind !== "once") return;
    assert.equal(once.at, at("2026-10-05T09:00:00Z"));
    assert.throws(() => parseSchedule("2026-13-45T99:00:00"), /date ISO illisible/);
  });
});

describe("nextRun", () => {
  test("cron : strictement apres la date de depart", () => {
    const schedule = parseSchedule("*/5 * * * *");
    assert.equal(iso(nextRun(schedule, at("2026-10-05T10:03:00Z"), "UTC")), "2026-10-05T10:05:00.000Z");
    assert.equal(iso(nextRun(schedule, at("2026-10-05T10:05:00Z"), "UTC")), "2026-10-05T10:10:00.000Z");
    assert.equal(iso(nextRun(schedule, at("2026-10-05T10:05:30Z"), "UTC")), "2026-10-05T10:10:00.000Z");
  });

  test("OR jour-mois / jour-semaine (cron Vixie)", () => {
    // 2026-10-05 est un lundi : le 1er du mois OU lundi, apres ce lundi.
    const schedule = parseSchedule("0 0 1 * 1");
    assert.equal(iso(nextRun(schedule, at("2026-10-05T12:00:00Z"), "UTC")), "2026-10-12T00:00:00.000Z");
    // Le lundi suivant l'emporte quand il est plus tot que le 1er du mois.
    assert.equal(iso(nextRun(schedule, at("2026-10-20T00:00:00Z"), "UTC")), "2026-10-26T00:00:00.000Z");
    // Puis le 1er novembre (un dimanche) gagne sur le lundi 2 novembre.
    assert.equal(iso(nextRun(schedule, at("2026-10-27T00:00:00Z"), "UTC")), "2026-11-01T00:00:00.000Z");
  });

  test("29 fevrier : saute jusqu'a l'annee bissextile", () => {
    const schedule = parseSchedule("0 0 29 2 *");
    assert.equal(iso(nextRun(schedule, at("2026-03-01T00:00:00Z"), "UTC")), "2028-02-29T00:00:00.000Z");
  });

  test("expr sans solution renvoie null", () => {
    // 30 fevrier n'existe jamais.
    assert.equal(nextRun(parseSchedule("0 0 30 2 *"), at("2026-03-01T00:00:00Z"), "UTC"), null);
  });

  test("macros : prochaine heure pleine", () => {
    assert.equal(iso(nextRun(parseSchedule("@hourly"), at("2026-10-05T10:00:00Z"), "UTC")), "2026-10-05T11:00:00.000Z");
  });

  test("intervalles : simple addition", () => {
    const schedule = parseSchedule("every 30s");
    assert.equal(nextRun(schedule, at("2026-10-05T10:00:00Z")), at("2026-10-05T10:00:30Z"));
  });

  test("one-shot : jamais rejoue", () => {
    const schedule = parseSchedule("2026-10-05T09:00:00Z");
    assert.equal(iso(nextRun(schedule, at("2026-10-05T08:00:00Z"))), "2026-10-05T09:00:00.000Z");
    assert.equal(nextRun(schedule, at("2026-10-05T09:00:00Z")), null);
  });

  test("fuseau horaire : midi local reste midi local", () => {
    const schedule = parseSchedule("0 12 * * *");
    // Hiver (CET, +1) : 12:00 Paris = 11:00Z
    assert.equal(iso(nextRun(schedule, at("2026-01-10T00:00:00Z"), "Europe/Paris")), "2026-01-10T11:00:00.000Z");
    // Ete (CEST, +2) : 12:00 Paris = 10:00Z
    assert.equal(iso(nextRun(schedule, at("2026-07-10T00:00:00Z"), "Europe/Paris")), "2026-07-10T10:00:00.000Z");
  });

  test("heure d'ete : le trou de 02:00 est saute, pas decale", () => {
    // Le 29 mars 2026, Paris passe de 02:00 CET a 03:00 CEST.
    const schedule = parseSchedule("0 2 * * *");
    assert.equal(iso(nextRun(schedule, at("2026-03-28T20:00:00Z"), "Europe/Paris")), "2026-03-30T00:00:00.000Z");
  });

  test("fuseau inconnu : erreur exploitable", () => {
    assert.throws(() => nextRun(parseSchedule("@hourly"), Date.now(), "Mars/Phobos"), /fuseau horaire inconnu/);
  });
});

describe("describeSchedule", () => {
  test("phrases lisibles en francais", () => {
    assert.equal(describeSchedule(parseSchedule("*/5 * * * *")), 'cron "*/5 * * * *"');
    assert.equal(describeSchedule(parseSchedule("every 30s")), "toutes les 30 secondes");
    assert.equal(describeSchedule(parseSchedule("every 2h")), "toutes les 2 heures");
    assert.equal(describeSchedule(parseSchedule("every 1m")), "toutes les 1 minute");
    assert.equal(describeSchedule(parseSchedule("every 1d")), "toutes les 1 jour");
    assert.match(describeSchedule(parseSchedule("2026-10-05T09:00:00Z")), /^une seule fois le 2026-10-05T09:00:00/);
  });
});
