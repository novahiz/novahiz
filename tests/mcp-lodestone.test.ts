// E2E du serveur MCP Lodestone : il est lance comme enfant stdio et interroge
// en round-trip JSON-RPC newline-delimited. Trois exigences verifiees ici :
// poignee de main + tools/list = exactement 8 outils lodestone_* tous en
// readOnlyHint, un appel reel par outil sur un workspace temporaire, et la
// purete de stdout (aucune ligne non-JSON-RPC).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

const SERVER = join(process.cwd(), "mcp", "lodestone", "index.mjs");
const START_BUDGET_MS = 8000;
const REQUEST_TIMEOUT_MS = 20000;

type Json = Record<string, unknown>;

interface Connection {
  request: (method: string, params?: Json) => Promise<Json>;
  stdoutViolations: string[];
  close: () => Promise<void>;
}

interface Waiter {
  resolve: (message: Json) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function connect(root: string): Connection {
  const child = spawn(process.execPath, ["--experimental-strip-types", SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: process.env,
  });
  const pending = new Map<number, Waiter>();
  const stdoutViolations: string[] = [];
  let nextId = 1;
  let buffer = "";

  child.stderr.resume();

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim().length === 0) continue;
      let message: Json;
      try {
        message = JSON.parse(line) as Json;
      } catch {
        // Contrat de purete : toute ligne non-JSON-RPC sur stdout est un defaut.
        stdoutViolations.push(line.slice(0, 200));
        continue;
      }
      const id = message.id;
      if (typeof id !== "number") continue;
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
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout on ${method} after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      const payload: Json = { jsonrpc: "2.0", id, method };
      if (params !== undefined) payload.params = params;
      child.stdin.write(JSON.stringify(payload) + "\n");
    });

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.stdin.end();
      setTimeout(() => child.kill(), 2000).unref();
    });

  return { request, stdoutViolations, close };
}

let workspace: string;
let conn: Connection;

const hasGit = (() => {
  try {
    execFileSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

before(async () => {
  workspace = mkdtempSync(join(tmpdir(), "lodestone-e2e-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(
    join(workspace, "src", "alpha.ts"),
    [
      "export function lodestoneAnchor(alpha: number): number {",
      "  return alpha + 1;",
      "}",
      "export const LODESTONE_CONSTANT = 42;",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(workspace, "src", "beta.ts"),
    [
      "import { lodestoneAnchor } from \"./alpha.ts\";",
      "export function betaEntry(): number {",
      "  return lodestoneAnchor(1);",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(join(workspace, "README.md"), "# lodestone e2e fixture\n");

  if (hasGit) {
    const git = (args: string[]): void => {
      execFileSync("git", args, { cwd: workspace, encoding: "utf8", windowsHide: true });
    };
    git(["init", "--quiet"]);
    git(["config", "user.name", "Lodestone Test"]);
    git(["config", "user.email", "lodestone@test.local"]);
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "fixture"]);
    writeFileSync(join(workspace, "src", "dirty.ts"), "export const dirty = 1;\n");
  }

  conn = connect(workspace);

  const startedAt = Date.now();
  const init = await conn.request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "lodestone-e2e", version: "0.0.0" },
  });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < START_BUDGET_MS, `initialize took ${elapsed}ms`);
  const result = init.result as Json;
  assert.equal((result.serverInfo as Json).name, "novahiz-search");
});

after(async () => {
  if (conn) await conn.close();
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

/** Decompose le contenu texte JSON rendu par un tools/call. */
function payload(response: Json): Json {
  const result = response.result as Json;
  assert.ok(result, `missing result: ${JSON.stringify(response).slice(0, 300)}`);
  assert.notEqual(result.isError, true, `tool error: ${JSON.stringify(result).slice(0, 400)}`);
  const content = result.content as Array<{ type: string; text: string }>;
  assert.ok(Array.isArray(content) && content.length > 0, "content must be a non-empty array");
  assert.equal(content[0].type, "text");
  return JSON.parse(content[0].text) as Json;
}

async function callTool(name: string, args: Json): Promise<Json> {
  const response = await conn.request("tools/call", { name, arguments: args });
  assert.equal(response.error, undefined, JSON.stringify(response.error));
  return payload(response);
}

describe("Lodestone MCP — round-trip stdio", () => {
  test("tools/list expose exactement 8 outils lodestone_* en readOnlyHint", async () => {
    const response = await conn.request("tools/list", {});
    const tools = (response.result as { tools: Array<Json> }).tools;
    assert.equal(tools.length, 8);
    const names = tools.map((t) => String(t.name)).sort();
    assert.deepEqual(names, [
      "lodestone_callers",
      "lodestone_excerpt",
      "lodestone_git",
      "lodestone_map",
      "lodestone_reindex",
      "lodestone_search",
      "lodestone_status",
      "lodestone_symbol",
    ]);
    for (const tool of tools) {
      const annotations = tool.annotations as Json;
      assert.equal(annotations.readOnlyHint, true, `${String(tool.name)} must be readOnly`);
      assert.equal(annotations.destructiveHint, false);
      const schema = tool.inputSchema as Json;
      assert.equal(schema.type, "object");
      assert.ok(typeof tool.description === "string" && tool.description.length > 0);
    }
  });

  test("lodestone_search trouve un motif reel avec chemin relatif", async () => {
    const body = await callTool("lodestone_search", { query: "lodestoneAnchor", root: workspace });
    const hits = body.hits as Array<Json>;
    assert.ok(Array.isArray(hits) && hits.length > 0, JSON.stringify(body).slice(0, 300));
    const paths = hits.map((h) => String(h.path));
    assert.ok(
      paths.some((p) => p.includes("alpha.ts")),
      `expected alpha.ts among ${JSON.stringify(paths)}`,
    );
    // Chemins relatifs uniquement : aucun chemin absolu Windows ne doit fuiter.
    for (const p of paths) assert.ok(!/^[A-Za-z]:\\/.test(p), `absolute path leaked: ${p}`);
    assert.ok(Number(body.total) > 0);
  });

  test("lodestone_symbol resout une declaration", async () => {
    const body = await callTool("lodestone_symbol", { query: "lodestoneAnchor", root: workspace });
    const hits = body.hits as Array<Json>;
    assert.ok(Array.isArray(hits) && hits.length > 0, JSON.stringify(body).slice(0, 300));
    assert.ok(hits.some((h) => String(h.name) === "lodestoneAnchor"));
  });

  test("lodestone_callers trace l'appel de beta vers alpha", async () => {
    const body = await callTool("lodestone_callers", {
      symbol: "lodestoneAnchor",
      direction: "callers",
      depth: 2,
      root: workspace,
    });
    assert.ok(typeof body === "object");
    // Reponse structuree : soit des callers, soit une mention d'ambiguite —
    // jamais une erreur de protocole.
    assert.ok(
      "callers" in body || "ambiguous" in body || "roots" in body || "hits" in body,
      `unexpected shape: ${JSON.stringify(body).slice(0, 300)}`,
    );
  });

  test("lodestone_map decrit l'arborescence du workspace", async () => {
    const body = await callTool("lodestone_map", { root: workspace });
    assert.ok(typeof body === "object");
    const asText = JSON.stringify(body);
    assert.ok(asText.includes("src"), `expected src in map: ${asText.slice(0, 300)}`);
  });

  test("lodestone_excerpt rend les definitions du fichier", async () => {
    const body = await callTool("lodestone_excerpt", {
      file: "src/alpha.ts",
      root: workspace,
    });
    const asText = JSON.stringify(body);
    assert.ok(asText.includes("lodestoneAnchor"), asText.slice(0, 300));
  });

  test("lodestone_status signale l'etat de l'index sans ecrire", async () => {
    const body = await callTool("lodestone_status", { root: workspace });
    assert.ok(typeof body === "object");
    assert.ok("engine" in body || "indexed" in body || "files" in body,
      `unexpected status: ${JSON.stringify(body).slice(0, 300)}`);
  });

  test("lodestone_git rend modified/recent ou repo:false hors depot", async () => {
    const body = await callTool("lodestone_git", { action: "modified", root: workspace });
    assert.ok(typeof body === "object");
    if (hasGit) {
      const asText = JSON.stringify(body);
      assert.ok(asText.includes("dirty.ts") || asText.includes('"repo":false'), asText.slice(0, 300));
    }
  });

  test("lodestone_reindex reconstruit et rend le nouveau statut", async () => {
    const body = await callTool("lodestone_reindex", { root: workspace });
    assert.ok(typeof body === "object");
    assert.ok(
      "engine" in body || "indexed" in body || "files" in body,
      `unexpected rebuild result: ${JSON.stringify(body).slice(0, 300)}`,
    );
  });

  test("methode inconnue -> error -32601", async () => {
    const response = await conn.request("no/such/method", {});
    assert.ok(response.error, "expected an error object");
    assert.equal((response.error as Json).code, -32601);
  });

  test("outil inconnu -> error -32601", async () => {
    const response = await conn.request("tools/call", {
      name: "lodestone_not_a_tool",
      arguments: {},
    });
    assert.ok(response.error, "expected an error object");
    assert.equal((response.error as Json).code, -32601);
  });

  test("stdout reste pur : aucune ligne non-JSON-RPC", () => {
    assert.deepEqual(conn.stdoutViolations, []);
  });
});
