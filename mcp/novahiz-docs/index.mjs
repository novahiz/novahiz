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

// --- Modes CLI (aucun transport stdio) --------------------------------------
// node index.mjs --ingest react,typescript  |  --ingest --all  |  --ingest --dry <spec>
// node index.mjs --status                   etat de l'index par bibliotheque
// L'ingest est le seul morceau qui ouvre le reseau (store.ts n'ouvre aucun
// reseau) : ce mode sert l'installateur (seed du bouquet core) et la commande
// `novahiz docs ingest <id>`. Sans lui, src/ingest.ts n'avait AUCUN point
// d'entree et chaque installation partait avec read_docs vide (audit
// 2026-10-08).
async function runCli(args) {
  const { loadCatalog, getEntry } = await import("./src/catalog.ts");
  const { docsDb } = await import("./src/query.ts");
  const { countChunks } = await import("./src/store.ts");
  // --dry peut arriver avant ou apres la liste : on l'extrait avant de
  // decomposer (sinon il devient la spec et tout id parait inconnu).
  const dry = args.includes("--dry");
  const [mode, spec] = args.filter((arg) => arg !== "--dry");
  if (mode === "--status") {
    const db = docsDb();
    const libraries = loadCatalog().map((entry) => ({ id: entry.id, chunks: countChunks(db, entry.id) }));
    const indexed = libraries.filter((line) => line.chunks > 0);
    process.stdout.write(`${JSON.stringify({ indexed: indexed.length, total: libraries.length, libraries })}\n`);
    return 0;
  }
  if (mode !== "--ingest" || !spec) {
    process.stderr.write("usage: node index.mjs --ingest <id,id,...>|--all [--dry] | --status\n");
    return 2;
  }
  const ids =
    spec === "--all"
      ? loadCatalog().map((entry) => entry.id)
      : spec.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
  const unknown = ids.filter((id) => !getEntry(id));
  if (unknown.length > 0) {
    process.stderr.write(`novahiz-docs: unknown librar(ies): ${unknown.join(", ")}\n`);
    return 1;
  }
  if (dry) {
    process.stdout.write(`${JSON.stringify({ dryRun: true, targets: ids })}\n`);
    return 0;
  }
  const { createIngester } = await import("./src/ingest.ts");
  const db = docsDb();
  const ingester = createIngester();
  const results = [];
  for (const id of ids) {
    const result = await ingester.ingest(getEntry(id), db);
    results.push({ library: result.library, indexed: result.indexed, source: result.source, chunks: result.chunks });
  }
  process.stdout.write(`${JSON.stringify({ results, indexed: results.filter((line) => line.indexed).length })}\n`);
  return results.some((line) => line.indexed) ? 0 : 1;
}

if (isMain) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    // Mode CLI : la sortie porte un resultat JSON par ligne, pas du JSON-RPC.
    runCli(args)
      .then((code) => process.exit(code))
      .catch((error) => {
        process.stderr.write(`novahiz-docs: ${String(error?.stack ?? error).slice(0, 800)}\n`);
        process.exit(1);
      });
  } else {
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
}

export { handle };
