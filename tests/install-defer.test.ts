// Phase opencode differee du postinstall (install/lib.mjs) : decision de
// report, localisation de l'ancetre npm, attente des pid. Bug reproduit le
// 2026-10-10 (enquete npm) : les ecritures config opencode pendant le reify
// npm faient redemarrer opencode et tuer npm en pleine transaction. Aucun
// fichier reel n'est ecrit, aucun spawn reseau — tout est injecte.
//
// Deuxieme bug, meme date : le Finalize spawnait `npm update` en heritant
// npm_config_global=true du `npm install -g` exterieur — un second reify du
// MÊME prefix global pendant la transaction, EBUSY sur le retire de
// node_modules\novahiz, rollback arborist (rm(new)+rename(ancien)) qui
// remet l'ancien paquet avec ses mtimes sous un exit 0 npm. Assertions
// source sur install.mjs en fin de fichier.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import {
  deferOpencodePhase,
  findNpmAncestorPid,
  parsePid,
  pidAlive,
  waitForDeferredPhase,
  waitForPids,
} from "../install/lib.mjs";

describe("deferOpencodePhase", () => {
  test("postinstall npm -> phase opencode deferree", () => {
    assert.equal(deferOpencodePhase({}, { npm_lifecycle_event: "postinstall" }), true);
    assert.equal(deferOpencodePhase({}, { npm_lifecycle_event: "prepublish" }), true);
  });

  test("hors npm -> comportement historique synchrone", () => {
    assert.equal(deferOpencodePhase({}, {}), false);
    assert.equal(deferOpencodePhase({}, { npm_lifecycle_event: "" }), false);
  });

  test("le passage detache lui-meme ne se re-defere pas (boucle infinie)", () => {
    assert.equal(
      deferOpencodePhase({ "deferred-opencode": true }, { npm_lifecycle_event: "postinstall" }),
      false,
    );
    assert.equal(
      deferOpencodePhase({}, { npm_lifecycle_event: "postinstall", NOVAHIZ_DEFERRED: "1" }),
      false,
    );
  });

  test("--sync : repli d'urgence vers l'ancien comportement", () => {
    assert.equal(deferOpencodePhase({ sync: true }, { npm_lifecycle_event: "postinstall" }), false);
  });
});

describe("parsePid / pidAlive", () => {
  test("parsePid n'accepte que des entiers strictement positifs", () => {
    assert.equal(parsePid("1234"), 1234);
    assert.equal(parsePid(""), null);
    assert.equal(parsePid(undefined), null);
    assert.equal(parsePid("abc"), null);
    assert.equal(parsePid("-5"), null);
    assert.equal(parsePid("0"), null);
  });

  test("pidAlive : vivant pour ce processus, mort pour un enfant sorti", () => {
    assert.equal(pidAlive(process.pid), true);
    assert.equal(pidAlive(0), false);
    assert.equal(pidAlive(-1), false);
    const child = spawnSync(process.execPath, ["-e", ""]);
    assert.ok(typeof child.pid === "number");
    assert.equal(pidAlive(child.pid), false);
  });
});

describe("findNpmAncestorPid", () => {
  test("retourne null ou un pid qui n'est pas nous-memes", () => {
    const pid = findNpmAncestorPid();
    assert.ok(pid === null || (Number.isInteger(pid) && pid > 0 && pid !== process.pid));
  });

  test("pid de depart inexistant -> null (pas de crash)", () => {
    assert.equal(findNpmAncestorPid(4294967294 & 0x7fffffff), null);
  });
});

describe("waitForPids", () => {
  test("attend jusqu'a la mort du pid (isAlive injecte)", async () => {
    let calls = 0;
    await waitForPids([1234], {
      isAlive: () => {
        calls += 1;
        return calls <= 3;
      },
      pollMs: 1,
      timeoutMs: 60_000,
      log: () => {},
      sleep: async () => {},
    });
    assert.ok(calls >= 4, "au moins un tour mort-vivant de trop");
  });

  test("pid deja mort -> aucune attente", async () => {
    let calls = 0;
    await waitForPids([1234], {
      isAlive: () => {
        calls += 1;
        return false;
      },
      pollMs: 1,
      log: () => {},
      sleep: async () => {},
    });
    assert.equal(calls, 1);
  });

  test("plafond inclusif : sort meme si le pid vit encore", async () => {
    await waitForPids([1234], {
      isAlive: () => true,
      pollMs: 1,
      timeoutMs: 30,
      log: () => {},
      sleep: async () => {},
    });
  });
});

describe("waitForDeferredPhase", () => {
  test("attend le createur puis npm (ordre garanti)", async () => {
    const order: string[] = [];
    const dead = new Set<number>();
    await waitForDeferredPhase(
      { NOVAHIZ_WAIT_PARENT_PID: "111", NOVAHIZ_WAIT_PID: "222" },
      {
        isAlive: (pid: number) => {
          if (pid === 111 && !dead.has(111)) {
            dead.add(111);
            order.push("parent");
            return false;
          }
          if (pid === 222) {
            order.push("npm");
            return false;
          }
          return false;
        },
        pollMs: 1,
        log: () => {},
        sleep: async () => {},
      },
    );
    assert.deepEqual(order, ["parent", "npm"]);
  });

  test("npm non identifie -> grace fixe (injectee), jamais un blocage infini", async () => {
    const slept: number[] = [];
    await waitForDeferredPhase({}, {
      sleep: async (ms: number) => { slept.push(ms); },
      graceMs: 5,
      log: () => {},
    });
    assert.deepEqual(slept, [5]);
  });
});

// Regression du rollback "l'installation en place ne remplace pas" : le
// Finalize ne doit JAMAIS reifier le prefix global depuis un postinstall.
describe("Finalize : deps home isolees du prefix global", () => {
  const installSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "install", "install.mjs"),
    "utf8",
  );

  test("homeEnv force npm_config_global=false (l'env lifecycle porte global=true)", () => {
    assert.match(
      installSource,
      /const homeEnv = \{ \.\.\.process\.env, NOVAHIZ_HOME: home, npm_config_global: "false" \}/,
      "sans l'override, npm_config_global=true herite du npm install -g transforme ce npm update en second reify global concurrent",
    );
    // Les deux appels du Finalize doivent passer par homeEnv (outdated ET update).
    assert.ok(!installSource.includes('["update"]'), "plus de npm update sans homeEnv");
    assert.ok(
      !/\["outdated", "--json"\], \{\s*cwd: home,\s*env: \{ \.\.\.process\.env, NOVAHIZ_HOME: home \}/.test(installSource),
      "npm outdated du Finalize doit aussi passer par homeEnv",
    );
  });

  test("npm update en --ignore-scripts (home/package.json porte le postinstall)", () => {
    assert.match(installSource, /\["update", "--ignore-scripts"\]/);
  });

  test("l'enfant differe a cwd=home : jamais le dossier du paquet (EBUSY)", () => {
    assert.match(
      installSource,
      /cwd: home,\r?\n\s*detached: true/,
      "un cwd situe dans node_modules\\novahiz rend tout retire npm de ce dossier EBUSY sur Windows",
    );
  });
});
