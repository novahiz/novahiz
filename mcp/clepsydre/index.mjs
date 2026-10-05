#!/usr/bin/env node
// clepsydre — serveur MCP stdio : transport uniquement. La couche protocole
// vit dans src/proto.ts, les outils dans src/tools.ts, l'ordonnanceur dans
// src/scheduler.ts. Ce fichier lit stdin, ecrit stdout, et fait tourner
// l'ordonnanceur tant que le process est en vie.
//
//   node index.mjs              serveur stdio (opencode, doctor, tests)
//   node index.mjs --call outil arguments.json   un appel, une reponse, exit
//   node index.mjs --no-sched   serveur sans ordonnanceur (tests deterministes)

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { handle } from "./src/protocol.ts";
import { getScheduler } from "./src/tools.ts";

const args = process.argv.slice(2);
const noSched = args.includes("--no-sched");

if (args.includes("--call")) {
  // Mode one-shot : les arguments JSON arrivent sur stdin (jamais sur argv :
  // limite 32 k sous Windows), la reponse JSON-RPC part sur stdout, puis
  // sortie. 0 = resultat valide, 1 = erreur de protocole ou isError.
  const name = String(args[args.indexOf("--call") + 1] ?? "");
  let callArgs = {};
  let parseError = null;
  try {
    const raw = process.stdin.isTTY ? "" : readFileSync(0, "utf8").trim();
    if (raw.length > 0) callArgs = JSON.parse(raw);
  } catch (error) {
    parseError = String(error?.message ?? error);
  }
  const response = parseError
    ? { jsonrpc: "2.0", id: 1, error: { code: -32700, message: `Parse error: ${parseError}` } }
    : handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: callArgs } });
  process.stdout.write(`${JSON.stringify(response)}\n`);
  const ok = Boolean(response?.result) && response.result.isError !== true;
  process.exit(ok ? 0 : 1);
}

const scheduler = getScheduler();
if (!noSched) scheduler.start();

const reader = createInterface({ input: process.stdin });
// Si le parent (opencode) meurt ou ferme le tube, stdout.write lève : on sort
// proprement au lieu de planter sur une exception non captee.
const safeWrite = (text) => {
  try {
    process.stdout.write(text);
  } catch (err) {
    if (err?.code === "EPIPE") process.exit(0);
    throw err;
  }
};
reader.on("line", (line) => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    safeWrite(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
    return;
  }
  const response = handle(message);
  if (response) safeWrite(`${JSON.stringify(response)}\n`);
});
reader.on("close", () => {
  scheduler.stop();
  process.exit(0);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    scheduler.stop();
    process.exit(0);
  });
}
