#!/usr/bin/env node
// novahiz-docs : serveur MCP stdio local (documentation de bibliotheques).
// Contrainte stdio : stdout ne porte QUE des messages JSON-RPC delimites par
// une fin de ligne — tout journal partirait par stderr (aucun console.log ici).
// Le protocole (double ere) vit dans src/proto.ts ; ce fichier ne fait que
// transporter : boucle readline, reponse, sortie propre.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { handle } from "./src/proto.ts";

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const reader = createInterface({ input: process.stdin });
  // Parent opencode mort ou pipe ferme : exit gracieux plutot qu'exception.
  const safeWrite = (text) => {
    try {
      process.stdout.write(text);
    } catch (error) {
      if (error?.code === "EPIPE") process.exit(0);
      throw error;
    }
  };
  reader.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      safeWrite(
        `${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`
      );
      return;
    }
    const response = handle(message);
    // null = notification ou reponse client : rien a ecrire (jamais de
    // reponse spontanee, le stdio n'autorise qu'un message par ligne ecrite).
    if (response) safeWrite(`${JSON.stringify(response)}\n`);
  });
  // Fermeture de stdin = signal de fin canonique du transport.
  reader.on("close", () => process.exit(0));
}

export { handle };
