// Token economy — plugin dedie: decoupe pure des sorties d'outils, pied de
// page de recuperation, extraction du texte de contenu, formatage de
// l'estimation, et kill-switch NOVAHIZ_TOKEN_ECONOMY (opt-in strict).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";

import {
  BYTES_PER_TOKEN,
  buildFooter,
  contentText,
  estimateTokens,
  formatStats,
  planTruncation,
  type TruncationPlan
} from "../adapters/opencode/novahiz-token-economy.ts";

const MAX_LINES = 5;
const MAX_BYTES = 200;

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

const plan = (text: string, maxLines = MAX_LINES, maxBytes = MAX_BYTES): TruncationPlan =>
  planTruncation(text, maxLines, maxBytes);

describe("token-economy — planTruncation", () => {
  test("sous les deux seuils, rien n'est coupe", () => {
    const result = plan(lines(3));
    assert.equal(result.truncated, false);
    assert.equal(result.keep, lines(3));
    assert.equal(result.headLines, 3);
    assert.equal(result.bytesBefore, result.bytesAfter);
  });

  test("depassement de lignes: tete conservee, total exact", () => {
    const result = plan(lines(12));
    assert.equal(result.truncated, true);
    assert.equal(result.headLines, 5);
    assert.equal(result.totalLines, 12);
    assert.equal(result.keep, lines(5));
    assert.ok(result.bytesAfter < result.bytesBefore);
  });

  test("depassement d'octets: le budget d'octets prime sur celui des lignes", () => {
    const bigLine = "x".repeat(80);
    const result = plan(`${bigLine}\n${bigLine}\n${bigLine}`, 5, 100);
    assert.equal(result.truncated, true);
    assert.equal(result.headLines, 1);
    assert.ok(result.bytesAfter <= 100, `bytesAfter ${result.bytesAfter} > 100`);
  });

  test("une seule ligne geante est coupee au budget d'octets", () => {
    const result = plan("y".repeat(5000), 120, 1024);
    assert.equal(result.truncated, true);
    assert.ok(result.bytesAfter <= 1024);
    assert.ok(result.headLines >= 1);
  });

  test("les octets sont comptes en utf8, pas en caracteres", () => {
    const accented = "é".repeat(50);
    const result = plan(accented, 5, 60);
    assert.equal(result.truncated, true);
    assert.ok(result.bytesBefore >= 100);
  });
});

describe("token-economy — buildFooter", () => {
  const truncated = plan(lines(12));

  test("dit ou relire quand le dump existe", () => {
    const footer = buildFooter("shell", truncated, "C:\\nv\\tmp\\tool-output\\shell-abc.txt");
    assert.match(footer, /\[Novahiz token-economy\] truncated shell/);
    assert.match(footer, /kept 5 of 12 lines/);
    assert.match(footer, /Full output: .*shell-abc\.txt/);
    assert.match(footer, /grep that file instead of re-running/);
    assert.match(footer, /~\d+ tokens saved/);
  });

  test("repli honnete quand le dump a echoue", () => {
    const footer = buildFooter("shell", truncated, null);
    assert.match(footer, /Full output unavailable \(dump failed\)/);
    assert.match(footer, /re-run only if you need the rest/);
  });

  test("l'economie annonce est coherente avec les octets retires", () => {
    const footer = buildFooter("shell", truncated, null);
    const saved = estimateTokens(truncated.bytesBefore - truncated.bytesAfter);
    assert.match(footer, new RegExp(`~${saved} tokens saved`));
  });
});

describe("token-economy — contentText", () => {
  test("chaine directe", () => {
    assert.equal(contentText("hello"), "hello");
  });

  test("tableau de parts text concatene", () => {
    assert.equal(contentText([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
  });

  test("parts non-text et contenus vides -> null", () => {
    assert.equal(contentText([{ type: "file", uri: "file:///x", mime: "text/plain", name: "x" }]), null);
    assert.equal(contentText([]), null);
    assert.equal(contentText(""), null);
    assert.equal(contentText(undefined), null);
    assert.equal(contentText(42), null);
  });
});

describe("token-economy — estimation affichee", () => {
  test("3.2 octets par token, meme convention que novahiz tokens", () => {
    assert.equal(BYTES_PER_TOKEN, 3.2);
    assert.equal(estimateTokens(3200), 1000);
    assert.equal(estimateTokens(0), 0);
    assert.equal(estimateTokens(-5), 0);
  });

  test("formatStats OFF rappelle la variable d'env", () => {
    const text = formatStats({ outputs: 0, before: 0, after: 0 }, false);
    assert.match(text, /OFF \(set NOVAHIZ_TOKEN_ECONOMY=1 to enable\)/);
    assert.match(text, /outputs truncated: 0/);
  });

  test("formatStats ON affiche octets et tokens economises", () => {
    const text = formatStats({ outputs: 2, before: 32_000, after: 8_000 }, true);
    assert.match(text, /ON/);
    assert.match(text, /outputs truncated: 2/);
    assert.match(text, /estimated saved: .*~7500 tokens/);
  });
});

describe("token-economy — opt-in strict (NOVAHIZ_TOKEN_ECONOMY)", () => {
  const probe = (value: string | undefined): string => {
    const env = { ...process.env };
    if (value === undefined) delete env.NOVAHIZ_TOKEN_ECONOMY;
    else env.NOVAHIZ_TOKEN_ECONOMY = value;
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `const m = await import("./adapters/opencode/novahiz-token-economy.ts"); console.log(m.ENABLED);`
      ],
      { cwd: process.cwd(), env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  test("absente de l'environnement -> plugin coupe", () => {
    assert.equal(probe(undefined), "false");
  });

  test("valeurs explicites", () => {
    assert.equal(probe("1"), "true");
    assert.equal(probe("0"), "false");
  });
});

// Cadenassage complet du plugin: setup() branche sur un contexte factice, le
// hook execute.after declenche sur une vraie sortie de 400 lignes, puis la
// commande affiche l'estimation. Un enfant distinct permet de controler
// NOVAHIZ_TOKEN_ECONOMY avant l'import (lu une seule fois, au chargement).
describe("token-economy — cadenassage setup()", () => {
  const HARNESS = `
import plugin from "./adapters/opencode/novahiz-token-economy.ts";
const hooks = {};
const commands = [];
const synthetics = [];
const ctx = {
  tool: { hook: async (name, cb) => { hooks[name] = cb; return () => {}; } },
  command: { transform: async (cb) => { cb({ add: (definition) => commands.push(definition) }); return () => {}; } },
  session: { synthetic: async (input) => { synthetics.push(input); return { id: "synthetic-1" }; } }
};
await plugin.setup(ctx);
const out = { hooks: Object.keys(hooks), commands: commands.map((c) => c.name) };
if (hooks["execute.after"]) {
  const big = Array.from({ length: 400 }, (_, i) => "log line " + (i + 1)).join("\\n");
  const event = { status: "completed", tool: "shell", sessionID: "s1", id: "call1", result: { content: big } };
  await hooks["execute.after"](event);
  const shown = typeof event.result.content === "string" ? event.result.content : "";
  out.truncated = shown.length < big.length;
  out.footer = shown.includes("[Novahiz token-economy] truncated shell");
  out.doesNotRerun = shown.includes("grep that file instead of re-running");
  const readEvent = { status: "completed", tool: "read", sessionID: "s1", id: "call2", result: { content: big } };
  await hooks["execute.after"](readEvent);
  out.protectedRead = readEvent.result.content === big;
  if (commands[0]) {
    await commands[0].execute({ sessionID: "s1" });
    out.display = synthetics[0] ? synthetics[0].text : null;
  }
}
console.log(JSON.stringify(out));
`;

  const run = (enabled: boolean, dumpDir: string): Record<string, unknown> => {
    const env: Record<string, string | undefined> = {
      ...process.env,
      NOVAHIZ_TE_DUMP_DIR: dumpDir
    };
    if (enabled) env.NOVAHIZ_TOKEN_ECONOMY = "1";
    else delete env.NOVAHIZ_TOKEN_ECONOMY;
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", HARNESS],
      { cwd: process.cwd(), env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    // Le plugin logue sur le meme canal: notre JSON est la derniere ligne.
    const lines = result.stdout.trim().split(/\r?\n/);
    return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  };

  test("coupe par defaut: aucun hook de troncature, commande presente", () => {
    const out = run(false, join(tmpdir(), "nv-te-off"));
    assert.deepEqual(out.hooks, []);
    assert.deepEqual(out.commands, ["novahiz-tokens"]);
    assert.equal(out.display, undefined);
  });

  test("NOVAHIZ_TOKEN_ECONOMY=1: hook actif, sortie coupee, read protege, estimation affichee", () => {
    const dumpDir = mkdtempSync(join(tmpdir(), "nv-te-"));
    const out = run(true, dumpDir);
    assert.deepEqual(out.hooks, ["execute.after"]);
    assert.deepEqual(out.commands, ["novahiz-tokens"]);
    assert.equal(out.truncated, true);
    assert.equal(out.footer, true);
    assert.equal(out.doesNotRerun, true);
    assert.equal(out.protectedRead, true, "read must never be truncated");
    const display = String(out.display ?? "");
    assert.match(display, /outputs truncated: 1/);
    assert.match(display, /estimated saved: .*tokens/);
    const dumps = readdirSync(dumpDir);
    assert.equal(dumps.length, 1, `expected one dump file, got ${dumps.join(", ")}`);
    const dump = readFileSync(join(dumpDir, dumps[0]), "utf8");
    assert.ok(dump.split("\n").length === 400, "dump holds the full output");
    assert.ok(dump.includes("log line 400"));
  });
});
