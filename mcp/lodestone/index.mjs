#!/usr/bin/env node
// Lodestone — serveur MCP stdio de recherche et d'analyse de code.
// Remplace narsil pour tout ce que le système Novahiz en fait : recherche
// plein texte avec index FTS5 (repli LIKE), symboles (reutilise src/graph/),
// graphe d'appels, statut d'index, git, et carte de repo.
//
// Zéro plagiat : tout le code est from scratch dans cette session, en clean-
// room face au README/npm/licence MIT/Apache-2.0 de narsil-mcp (lu, jamais
// copié). Aucune dépendance npm : node:sqlite, node:fs, node:child_process.
// Transport : stdio, newline-delimited JSON-RPC, même protocole que
// novahiz-tools et novahiz-docs (initialize / tools/list / tools/call / ping).

import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

const SERVER_VERSION = "0.1.0";
const SERVER_INFO = { name: "novahiz-search", version: SERVER_VERSION };

import { handle } from "./src/handle.ts";

const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const reader = createInterface({ input: process.stdin });
  const safeWrite = function(text) {
    try {
      process.stdout.write(text);
    } catch (error) {
      var code = (error).code;
      if (code === "EPIPE") process.exit(0);
      throw error;
    }
  };
  reader.on("line", function(line) {
    var trimmed = line.trim();
    if (trimmed.length === 0) return;
    var message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      safeWrite(
        JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"
      );
      return;
    }
    var response = handle(message);
    if (response) safeWrite(JSON.stringify(response) + "\n");
  });
  reader.on("close", function() { process.exit(0); });
}

export { handle };
