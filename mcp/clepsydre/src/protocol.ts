// clepsydre — couche protocole MCP, ecrite pour ce depot (0 dependance).
// Un meme process stdio sert les deux eres du MCP, sans etat de connexion :
//   - ere legacy : poignee de main `initialize` (2024-11-05, 2025-06-18,
//     2025-11-25) — l'ere qu'opencode choisit par defaut.
//   - ere moderne : revision 2026-07-28, version et capacites portees par
//     `_meta` a chaque requete, decouverte `server/discover`.
// La couche est isolee du transport (index.mjs) : l'evolution de la spec ne
// touche jamais la boucle readline.

import { readFileSync } from "node:fs";
import { callTool, TOOLS } from "./tools.ts";

type Json = Record<string, unknown>;

let serverVersion = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as Json;
  serverVersion = String(pkg.version ?? "0.0.0");
} catch {
  // package.json absent (installation deplacee) : version neutre, sans impact.
}

export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2024-11-05"];
const LEGACY_PREFERRED = "2025-11-25";

const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

const SERVER_INFO = { name: "novahiz-scheduler", version: serverVersion };
const CAPABILITIES: Json = { tools: {} };
const INSTRUCTIONS =
  "clepsydre planifie des taches (shell, webhook HTTP, rappel de prompt) et les declenche " +
  "selon une expression cron, un intervalle ou une date unique. Les taches et leur historique " +
  "sont persistes localement, sans appel reseau.";

function textResult(payload: object, isError = false): Json {
  return { resultType: "complete", content: [{ type: "text", text: JSON.stringify(payload) }], isError };
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

  // Ire moderne : la version voyage dans _meta ; sans elle, la requete reste
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
