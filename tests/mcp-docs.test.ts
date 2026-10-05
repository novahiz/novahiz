// E2E du serveur novahiz-docs : il est lance comme enfant stdio et interroge
// sur les deux eres du MCP — poignee de main legacy (initialize) et metadonnees
// par requete modernes (server/discover, 2026-07-28). Deux exigences verifiees
// ici : aucune sortie non-JSON-RPC sur stdout, et tools/list en moins de 5 s
// (timeout opencode au demarrage).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { handle } from "../mcp/novahiz-docs/src/proto.ts";
import { splitMarkdown } from "../mcp/novahiz-docs/src/chunk.ts";
import { indexPage, openStore } from "../mcp/novahiz-docs/src/store.ts";

type Json = Record<string, unknown>;

// Isole le journal d'usage novahiz-docs : les lectures tracees ecrivent dans
// un repertoire temporaire, jamais dans mcp/novahiz-docs/data/. L'enfant
// spawné herite de process.env (spread de connect()), les appels in-process
// lisent la variable au moment de l'ecriture.
const USAGE_DIR = mkdtempSync(join(tmpdir(), "novahiz-docs-usage-"));
const USAGE_FILE = join(USAGE_DIR, "usage.jsonl");
process.env.NOVAHIZ_DOCS_USAGE = USAGE_FILE;
process.on("exit", () => {
  try {
    rmSync(USAGE_DIR, { recursive: true, force: true });
  } catch {
    // Deja nettoye ou volume verrouille : le temporaire du systeme s'en charge.
  }
});

const SERVER = join(process.cwd(), "mcp", "novahiz-docs", "index.mjs");
const START_BUDGET_MS = 5000;
const REQUEST_TIMEOUT_MS = 4000;

interface Connection {
  startedAt: number;
  stdoutViolations: string[];
  request: (method: string, params?: Json) => Promise<Json>;
  notify: (method: string, params?: Json) => void;
  /** Ferme l'enfant et n'est resolue qu'apres son exit reel (fichiers rendus). */
  close: () => Promise<void>;
}

interface Waiter {
  resolve: (message: Json) => void;
  timer: NodeJS.Timeout;
}

function connect(dbPath?: string): Connection {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    // Le serveur lit NOVAHIZ_DOCS_DB : le test lui donne son propre index
    // (seedé avant le spawn) — jamais dependant des donnees de la machine.
    env: dbPath === undefined ? process.env : { ...process.env, NOVAHIZ_DOCS_DB: dbPath }
  });
  const startedAt = Date.now();
  const pending = new Map<number, Waiter>();
  const stdoutViolations: string[] = [];
  let nextId = 1;
  let buffer = "";

  // stderr draine sans interpretation : le serveur doit pouvoir y ecrire sans
  // etre penalise — seule la purete de stdout est un contrat.
  child.stderr.resume();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length === 0) continue;
      let message: Json;
      try {
        message = JSON.parse(line) as Json;
      } catch {
        stdoutViolations.push(line.slice(0, 160));
        continue;
      }
      const id = typeof message.id === "number" ? message.id : -1;
      const waiter = pending.get(id);
      if (waiter) {
        pending.delete(id);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });

  const request = (method: string, params?: Json): Promise<Json> =>
    new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`delai depasse pour ${method}`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  const notify = (method: string, params?: Json): void => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  const close = (): Promise<void> => {
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    pending.clear();
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill();
      // Garde-fou : un enfant qui refuse de partir ne bloque pas le test.
      const guard = setTimeout(resolve, 2000);
      guard.unref();
    });
  };

  return { startedAt, stdoutViolations, request, notify, close };
}

const LEGACY_CLIENT = { name: "novahiz-e2e", version: "0.0.0" };

const MODERN_META: Json = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": LEGACY_CLIENT,
  "io.modelcontextprotocol/clientCapabilities": {}
};

async function legacyHandshake(conn: Connection, protocolVersion: string): Promise<Json> {
  const init = await conn.request("initialize", { protocolVersion, capabilities: {}, clientInfo: LEGACY_CLIENT });
  conn.notify("notifications/initialized");
  return init;
}

function toolPayload(result: Json): Json {
  assert.equal(result.isError, false, "l'outil ne doit pas signaler d'erreur");
  const content = result.content as Array<{ type: string; text: string }>;
  assert.equal(content[0].type, "text");
  return JSON.parse(content[0].text) as Json;
}

describe("novahiz-docs — ere legacy (initialize)", () => {
  test("poignee de main puis tools/list en moins de 5 s, annotations honnetes", async () => {
    const conn = connect();
    try {
      const init = await legacyHandshake(conn, "2025-06-18");
      const initResult = init.result as Json;
      assert.equal(initResult.protocolVersion, "2025-06-18", "le serveur echo la version proposee");
      assert.equal((initResult.serverInfo as Json).name, "novahiz-docs");
      assert.ok(initResult.capabilities, "capacites annoncees a l'initialisation");

      const list = await conn.request("tools/list", {});
      const elapsed = Date.now() - conn.startedAt;
      assert.ok(elapsed < START_BUDGET_MS, `tools/list en ${elapsed} ms (budget ${START_BUDGET_MS} ms)`);

      const tools = (list.result as Json).tools as Array<Json>;
      assert.deepEqual(
        tools.map((tool) => tool.name),
        ["find_library", "list_libraries", "read_docs"],
        "jeu d'outils complet, ordre determinant"
      );
      for (const tool of tools) {
        const annotations = tool.annotations as Json;
        assert.equal(annotations.readOnlyHint, true, `${tool.name}: lecture seule`);
        assert.equal(annotations.openWorldHint, false, `${tool.name}: univers fermé (index local)`);
      }
      assert.deepEqual(conn.stdoutViolations, [], "stdout ne porte que du JSON-RPC");
    } finally {
      await conn.close();
    }
  });

  test("version legacy inconnue : repli sur la version preferee du serveur", async () => {
    const conn = connect();
    try {
      const init = await legacyHandshake(conn, "1900-01-01");
      assert.equal((init.result as Json).protocolVersion, "2025-11-25");
    } finally {
      await conn.close();
    }
  });

  test("tools/call : les trois outils servent le vrai index, citation complete", async () => {
    const workdir = mkdtempSync(join(tmpdir(), "novahiz-docs-e2e-"));
    const dbPath = join(workdir, "index.sqlite");
    const store = openStore(dbPath);
    indexPage(
      store,
      { library: "react", version: "19.1.0", sourceUrl: "https://example.test/react-state", license: "CC-BY-4.0" },
      splitMarkdown(readFileSync(join(process.cwd(), "mcp", "novahiz-docs", "tests", "fixtures", "react-state.md"), "utf8"))
    );
    store.close();

    const conn = connect(dbPath);
    try {
      await legacyHandshake(conn, "2024-11-05");

      const call = await conn.request("tools/call", {
        name: "read_docs",
        arguments: { library: "react", query: "useState" }
      });
      const payload = toolPayload(call.result as Json);
      assert.equal(payload.ok, true);
      assert.equal(payload.library, "react");
      assert.equal(payload.query, "useState");
      const passages = payload.passages as Array<Json>;
      assert.ok(passages.length >= 1, "l'index seedé répond par la fenêtre MCP");
      const top = passages[0];
      assert.equal(top.sourceUrl, "https://example.test/react-state");
      assert.equal(top.license, "CC-BY-4.0");
      assert.match(String(top.fetchedAt), /^\d{4}-\d{2}-\d{2}T/);
      assert.ok(Array.isArray(top.headingPath), "citation attachée au passage");
      assert.ok(typeof top.text === "string" && top.text.length > 0);
      assert.ok((payload.elapsedMs as number) < 100, `réponse en ${String(payload.elapsedMs)} ms (budget 100)`);

      const find = await conn.request("tools/call", { name: "find_library", arguments: { library: "next" } });
      const findPayload = toolPayload(find.result as Json);
      const matches = findPayload.matches as Array<Json>;
      assert.equal(matches[0].id, "nextjs", "find_library resout l'alias par le fil MCP");
      assert.equal(matches[0].indexed, false, "l'etat d'index est reporte");

      const list = await conn.request("tools/call", { name: "list_libraries", arguments: {} });
      const listPayload = toolPayload(list.result as Json);
      assert.ok((listPayload.count as number) >= 45, "tout le bouquet est listé");
      const listed = listPayload.libraries as Array<Json>;
      const listedReact = listed.find((entry) => entry.id === "react");
      assert.equal(listedReact?.indexed, true, "l'entrée react est marquée indexée");

      const invalid = await conn.request("tools/call", { name: "read_docs", arguments: { library: "react" } });
      const invalidResult = invalid.result as Json;
      assert.equal(invalidResult.isError, true, "argument manquant = erreur d'outil, pas erreur de protocole");

      const unknown = await conn.request("tools/call", { name: "web_search", arguments: {} });
      assert.equal((unknown.error as Json).code, -32602, "outil inconnu = erreur de protocole");

      assert.deepEqual(conn.stdoutViolations, [], "stdout ne porte que du JSON-RPC");
    } finally {
      await conn.close();
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});

describe("novahiz-docs — ere moderne (server/discover)", () => {
  test("server/discover annonce la version, les capacites et l'identite", async () => {
    const conn = connect();
    try {
      const discover = await conn.request("server/discover", { _meta: MODERN_META });
      const result = discover.result as Json;
      assert.equal(result.resultType, "complete");
      assert.deepEqual(result.supportedVersions, ["2026-07-28"]);
      assert.ok((result.capabilities as Json).tools, "capacite tools annoncee");
      const meta = result._meta as Json;
      assert.equal((meta["io.modelcontextprotocol/serverInfo"] as Json).name, "novahiz-docs");

      // La meme session sert tools/list cote moderne, sans initialize.
      const list = await conn.request("tools/list", { _meta: MODERN_META });
      const tools = (list.result as Json).tools as Array<Json>;
      assert.equal(tools.length, 3);
      assert.deepEqual(conn.stdoutViolations, [], "stdout ne porte que du JSON-RPC");
    } finally {
      await conn.close();
    }
  });

  test("version non prise en charge -> -32022 avec la liste supportee", async () => {
    const conn = connect();
    try {
      const response = await conn.request("ping", {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "1900-01-01",
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      });
      const error = response.error as Json;
      assert.equal(error.code, -32022);
      assert.deepEqual((error.data as Json).supported, ["2026-07-28"]);
      assert.equal((error.data as Json).requested, "1900-01-01");
    } finally {
      await conn.close();
    }
  });

  test("_meta moderne sans clientCapabilities -> -32602", async () => {
    const conn = connect();
    try {
      const response = await conn.request("tools/list", {
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" }
      });
      assert.equal((response.error as Json).code, -32602);
    } finally {
      await conn.close();
    }
  });

  test("methode inconnue -> -32601", async () => {
    const conn = connect();
    try {
      const response = await conn.request("resources/list", { _meta: MODERN_META });
      assert.equal((response.error as Json).code, -32601);
    } finally {
      await conn.close();
    }
  });
});

describe("novahiz-docs — couche protocole (unitaire)", () => {
  test("notifications et reponses client : aucune reponse produite", () => {
    assert.equal(handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
    assert.equal(handle({ jsonrpc: "2.0", id: 7, result: {} }), null);
  });

  test("trame invalide : -32600", () => {
    assert.equal((handle(null)?.error as Json).code, -32600);
    assert.equal((handle({ jsonrpc: "1.0", id: 1, method: "ping" })?.error as Json).code, -32600);
  });

  test("initialize : version echosee, version inconnue recalee sur la preferee", () => {
    const echo = handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    assert.equal((echo?.result as Json).protocolVersion, "2024-11-05");
    const fallback = handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2027-01-01" } });
    assert.equal((fallback?.result as Json).protocolVersion, "2025-11-25");
  });

  test("notification avant methode inconnue : on repond -32601, jamais en silence", () => {
    const response = handle({ jsonrpc: "2.0", id: 3, method: "prompts/list" });
    assert.equal((response?.error as Json).code, -32601);
  });
});

describe("novahiz-docs — journal d'usage read_docs", () => {
  function seedReactDb(): { dbPath: string; workdir: string } {
    const workdir = mkdtempSync(join(tmpdir(), "novahiz-docs-usage-e2e-"));
    const dbPath = join(workdir, "index.sqlite");
    const store = openStore(dbPath);
    indexPage(
      store,
      { library: "react", version: "19.1.0", sourceUrl: "https://example.test/react-state", license: "CC-BY-4.0" },
      splitMarkdown(readFileSync(join(process.cwd(), "mcp", "novahiz-docs", "tests", "fixtures", "react-state.md"), "utf8"))
    );
    store.close();
    return { dbPath, workdir };
  }

  const readLines = (): Json[] =>
    existsSync(USAGE_FILE)
      ? readFileSync(USAGE_FILE, "utf8")
          .split("\n")
          .filter((line) => line.trim().length > 0)
          .map((line) => JSON.parse(line) as Json)
      : [];

  test("read_docs journalise {ts, library, query, count} — les autres non", async () => {
    const { dbPath, workdir } = seedReactDb();
    const before = readLines().length;
    const conn = connect(dbPath);
    try {
      await legacyHandshake(conn, "2025-11-25");
      const call = await conn.request("tools/call", {
        name: "read_docs",
        arguments: { library: "react", query: "useState" }
      });
      assert.equal(toolPayload(call.result as Json).ok, true);

      // Arguments invalides : erreur d'outil, pas de lecture => pas de journal.
      const invalid = await conn.request("tools/call", { name: "read_docs", arguments: { library: "react" } });
      assert.equal((invalid.result as Json).isError, true);
      // find_library ne consulte pas de passage : pas de journal.
      await conn.request("tools/call", { name: "find_library", arguments: { library: "react" } });
    } finally {
      await conn.close();
      rmSync(workdir, { recursive: true, force: true });
    }

    const lines = readLines();
    assert.equal(lines.length, before + 1, "une seule ligne ajoutee : la lecture validee");
    const last = lines[lines.length - 1];
    assert.equal(last.library, "react");
    assert.equal(last.query, "useState");
    assert.ok(typeof last.count === "number" && last.count >= 1, "nombre de passages rendus");
    assert.match(String(last.ts), /^\d{4}-\d{2}-\d{2}T/, "horodatage ISO");
  });

  test("rotation au-dela de 512 Ko : generation .1 puis reprise propre", async () => {
    writeFileSync(USAGE_FILE, `${"x".repeat(512 * 1024 + 1)}\n`, "utf8");
    const { dbPath, workdir } = seedReactDb();
    const conn = connect(dbPath);
    try {
      await legacyHandshake(conn, "2025-11-25");
      await conn.request("tools/call", { name: "read_docs", arguments: { library: "react", query: "useState" } });
    } finally {
      await conn.close();
      rmSync(workdir, { recursive: true, force: true });
    }

    assert.ok(existsSync(`${USAGE_FILE}.1`), "l'ancien journal est conserve en generation .1");
    const lines = readLines();
    assert.equal(lines.length, 1, "le nouveau journal ne contient que l'ecriture de ce test");
    assert.equal(lines[0].library, "react");
    // Nettoyage : rend le fichier partage aux tests suivants.
    rmSync(USAGE_FILE, { force: true });
    rmSync(`${USAGE_FILE}.1`, { force: true });
  });
});
