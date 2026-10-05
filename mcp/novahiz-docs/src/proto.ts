// Couche protocole de novahiz-docs : un meme processus stdio sert les deux
// eres du MCP, sans etat de connexion.
//   - Ere legacy : poignee de main `initialize` (2024-11-05, 2025-06-18,
//     2025-11-25) — l'ere qu'opencode choisit par defaut (protocol "legacy").
//   - Ere moderne : revision 2026-07-28, version/portee/capacites porte par
//     `_meta` a chaque requete, decouverte `server/discover`.
// La couche est isolee du transport (index.mjs) : l'evolution de la spec ne
// touche jamais la boucle readline.

import { appendFileSync, readFileSync, renameSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { docsDb, findLibrary, listLibraries, queryDocs } from "./query.ts";

type Json = Record<string, unknown>;

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations: Json;
}

let serverVersion = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as Json;
  serverVersion = String(pkg.version ?? "0.0.0");
} catch {
  // package.json absent (installation deplacee): version neutre, sans impact.
}

export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2024-11-05"];
const LEGACY_PREFERRED = "2025-11-25";

const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

const SERVER_INFO = { name: "novahiz-docs", version: serverVersion };
const CAPABILITIES: Json = { tools: {} };
const INSTRUCTIONS =
  "novahiz-docs sert la documentation des bibliotheques depuis un index local (SQLite FTS5) : " +
  "resolution de nom, lecture de passages, liste du corpus — sans cle API et sans appel reseau a la lecture.";

// Ordre determinant (alphabetique) : le meme jeu de sorties a chaque appel,
// pour que le client puisse le mettre en cache sans surprise.
const TOOLS: readonly ToolDefinition[] = [
  {
    name: "find_library",
    title: "Library name resolver",
    description:
      "Resolve a library name, package name or alias to its catalogue entry: ecosystem, repository and " +
      "documentation source. The match is computed locally against the curated index and makes no network call.",
    inputSchema: {
      type: "object",
      properties: {
        library: { type: "string", description: 'Library name or alias, for example "react" or "nextjs".' }
      },
      required: ["library"]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "list_libraries",
    title: "Curated library list",
    description:
      "List the libraries held in the local documentation index, with their ecosystem and documentation source.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "read_docs",
    title: "Documentation passage reader",
    description:
      "Return the documentation passages matching a query for one library, quoted from the local index. Every " +
      "passage carries its source URL, heading path and licence so attribution stays attached to the text.",
    inputSchema: {
      type: "object",
      properties: {
        library: { type: "string", description: "Target library (catalogue identifier)." },
        query: { type: "string", description: "What to look up in the documentation, for example an API name." },
        limit: { type: "number", description: "Maximum number of passages to return (default 5, max 20)." }
      },
      required: ["library", "query"]
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }
];

function textResult(payload: object, isError = false): Json {
  return { resultType: "complete", content: [{ type: "text", text: JSON.stringify(payload) }], isError };
}

// --- journal d'usage --------------------------------------------------------
// Chaque read_docs laisse une trace {ts, library, query, count} dans
// data/usage.jsonl : la matiere premiere du nudge « consulte sans decision
// persistee » de `novahiz memory check-docs`. Rotation a 512 Ko (une seule
// generation .1), NOVAHIZ_DOCS_USAGE deplace le fichier (tests). Un echec de
// journal ne fait jamais echouer l'outil : la lecture prime, la telemetrie suit.
const USAGE_MAX_BYTES = 512 * 1024;

function usagePath(): string {
  return process.env.NOVAHIZ_DOCS_USAGE ?? fileURLToPath(new URL("../data/usage.jsonl", import.meta.url));
}

function logUsage(entry: { library: string; query: string; count: number }): void {
  try {
    const path = usagePath();
    try {
      if (statSync(path).size > USAGE_MAX_BYTES) renameSync(path, `${path}.1`);
    } catch {
      // Fichier absent ou illisible : pas de rotation, l'ecriture suit.
    }
    appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, "utf8");
  } catch {
    // Journal indisponible (disque, permission) : la lecture reussit quand meme.
  }
}

// Les trois outils passent par la couche lecture (query.ts) : résolution
// catalogue, recherche FTS5 locale, citation complète. La validation d'entrée
// reste ici, avant l'appel — une erreur d'argument est une erreur d'outil
// (isError), pas une erreur de protocole.
function callTool(name: string, args: Json): Json {
  if (name === "list_libraries") {
    const libraries = listLibraries(docsDb());
    return textResult({ count: libraries.length, libraries });
  }
  if (name === "find_library") {
    const library = typeof args.library === "string" ? args.library.trim() : "";
    if (library.length === 0) {
      return textResult({ error: "library : nom de bibliotheque attendu (chaine non vide)" }, true);
    }
    return textResult(findLibrary(docsDb(), library));
  }
  if (name === "read_docs") {
    const library = typeof args.library === "string" ? args.library.trim() : "";
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (library.length === 0 || query.length === 0) {
      return textResult({ error: "library et query : chaines non vides attendues" }, true);
    }
    const limit =
      typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0
        ? Math.min(Math.floor(args.limit), 20)
        : undefined;
    const outcome = queryDocs(docsDb(), { library, query, limit });
    logUsage({ library: outcome.resolvedTo ?? outcome.library, query, count: outcome.passages.length });
    return textResult(outcome);
  }
  return textResult({ error: `outil inconnu : ${name}` }, true);
}

function ok(id: string | number, result: Json): Json {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string, data?: Json): Json {
  return { jsonrpc: "2.0", id, error: data ? { code, message, data } : { code, message } };
}

// Ire legacy : le client propose une version, le serveur l'echo s'il sait la
// parler, sinon sa version preferee (le client decide ensuite de rester ou non).
function legacyInitialize(id: string | number, params: Json): Json {
  const proposed = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
  const protocolVersion = LEGACY_VERSIONS.includes(proposed) ? proposed : LEGACY_PREFERRED;
  return ok(id, { protocolVersion, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
}

function discoverResult(): Json {
  return {
    resultType: "complete",
    supportedVersions: [MODERN_VERSION],
    capabilities: CAPABILITIES,
    _meta: { [META_SERVER_INFO]: SERVER_INFO },
    instructions: INSTRUCTIONS
  };
}

// Point d'entree du transport : renvoie la reponse a ecrire sur stdout, ou
// null quand rien ne doit etre ecrit (notifications, reponses du client).
export function handle(raw: unknown): Json | null {
  if (typeof raw !== "object" || raw === null) return rpcError(null, -32600, "Invalid Request");
  const message = raw as Json;
  if (message.jsonrpc !== "2.0") return rpcError(null, -32600, "Invalid Request");
  // Reponse du client : le serveur n'emett aucune requete, rien a traiter.
  if (!("method" in message)) return null;
  const method = message.method;
  if (typeof method !== "string") return rpcError(null, -32600, "Invalid Request");

  const hasId = message.id !== undefined && message.id !== null;
  // Notifications : jamais de reponse, quelle que soit la methode.
  if (!hasId) return null;
  const id = message.id as string | number;
  const params = (typeof message.params === "object" && message.params !== null ? message.params : {}) as Json;

  if (method === "initialize") return legacyInitialize(id, params);

  // Ere moderne : la version voyage dans _meta ; sans elle, la requete reste
  // servable en legacy ; version inconnue -> -32022 avec la liste supportee.
  const meta =
    typeof params._meta === "object" && params._meta !== null ? (params._meta as Json) : undefined;
  const requested = meta?.[META_PROTOCOL_VERSION];
  if (requested !== undefined) {
    if (typeof requested !== "string") {
      return rpcError(id, -32602, "Invalid params: protocolVersion must be a string");
    }
    if (requested !== MODERN_VERSION) {
      return rpcError(id, -32022, "Unsupported protocol version", { supported: [MODERN_VERSION], requested });
    }
    if (meta === undefined || !(META_CLIENT_CAPABILITIES in meta)) {
      return rpcError(id, -32602, `Invalid params: missing ${META_CLIENT_CAPABILITIES}`);
    }
  }

  if (method === "server/discover") return ok(id, discoverResult());
  if (method === "ping") return ok(id, { resultType: "complete" });
  if (method === "tools/list") return ok(id, { resultType: "complete", tools: TOOLS });
  if (method === "tools/call") {
    const name = params.name;
    if (typeof name !== "string" || name.length === 0) {
      return rpcError(id, -32602, "Invalid params: tool name required");
    }
    if (!TOOLS.some((tool) => tool.name === name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
    const args =
      typeof params.arguments === "object" && params.arguments !== null ? (params.arguments as Json) : {};
    try {
      return ok(id, callTool(name, args));
    } catch (error) {
      // Echec d'execution : signale au modele via isError (il peut corriger),
      // jamais comme erreur de protocole (le modele ne saurait pas quoi changer).
      const detail = error instanceof Error ? error.message : String(error);
      return ok(id, textResult({ error: detail }, true));
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}
