// Couche protocole clepsydre : les deux eres du MCP (initialize legacy et
// _meta 2026-07-28), notifications sans reponse, erreurs de protocole vs
// echecs d'outil, puis un test de bout en bout sur le process stdio.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { handle } from "../mcp/clepsydre/src/protocol.ts";

// Chemin absolu vers le serveur, resolu depuis le repertoire de travail
// (process.cwd() = racine du depot quand npm test tourne).
const SERVER = join(process.cwd(), "mcp", "clepsydre", "index.mjs");

type Json = Record<string, unknown>;

function request(method: string, params: Json = {}, id: number | string = 1): Json | null {
  return handle({ jsonrpc: "2.0", id, method, params });
}

function resultOf(response: Json | null): Json {
  assert.ok(response !== null, "une reponse etait attendue");
  const result = response?.result as Json | undefined;
  assert.ok(result && typeof result === "object", "result absent");
  return result;
}

function errorOf(response: Json | null): Json {
  assert.ok(response !== null, "une reponse etait attendue");
  const error = response?.error as Json | undefined;
  assert.ok(error && typeof error === "object", `error absent : ${JSON.stringify(response)}`);
  return error;
}

describe("poignée de main legacy", () => {
  test("version proposee connue : echo", () => {
    const result = resultOf(request("initialize", { protocolVersion: "2024-11-05" }));
    assert.equal(result.protocolVersion, "2024-11-05");
    assert.deepEqual(result.capabilities, { tools: {} });
    assert.equal((result.serverInfo as Json).name, "novahiz-scheduler");
    assert.equal(typeof (result.serverInfo as Json).version, "string");
    assert.match(String(result.instructions), /planifie/);
  });

  test("version inconnue : la version preferee est proposee", () => {
    const result = resultOf(request("initialize", { protocolVersion: "1999-01-01" }));
    assert.equal(result.protocolVersion, "2025-11-25");
  });

  test("parametres absents : meme reponse", () => {
    assert.equal(resultOf(request("initialize")).protocolVersion, "2025-11-25");
  });
});

describe("ère moderne (2026-07-28)", () => {
  const meta = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {}
  };

  test("tools/list avec meta complete", () => {
    const result = resultOf(request("tools/list", { _meta: meta }));
    const tools = result.tools as Json[];
    assert.ok(Array.isArray(tools) && tools.length >= 10);
    for (const entry of tools) {
      assert.match(String(entry.name), /^clepsydre_/);
      assert.equal((entry.inputSchema as Json).additionalProperties, false);
    }
  });

  test("version refusee : -32022 avec la liste supportee", () => {
    const error = errorOf(
      request("tools/list", {
        _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "2025-06-18" }
      })
    );
    assert.equal(error.code, -32022);
    assert.deepEqual((error.data as Json).supported, ["2026-07-28"]);
  });

  test("capacites client manquantes : -32602", () => {
    const error = errorOf(
      request("tools/list", { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } })
    );
    assert.equal(error.code, -32602);
  });

  test("server/discover", () => {
    const result = resultOf(request("server/discover"));
    assert.deepEqual(result.supportedVersions, ["2026-07-28"]);
  });

  test("ping", () => {
    assert.deepEqual(resultOf(request("ping")), { resultType: "complete" });
  });
});

describe("discipline JSON-RPC", () => {
  test("notification : aucune reponse", () => {
    assert.equal(handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
    assert.equal(handle({ jsonrpc: "2.0", method: "ping" }), null);
  });

  test("reponse du client : ignoree", () => {
    assert.equal(handle({ jsonrpc: "2.0", id: 99, result: {} }), null);
  });

  test("message mal forme : -32600", () => {
    assert.equal(errorOf(handle({ jsonrpc: "1.0", id: 1, method: "ping" })).code, -32600);
    assert.equal(errorOf(handle(null)).code, -32600);
  });

  test("methode inconnue : -32601", () => {
    assert.equal(errorOf(request("resources/list")).code, -32601);
  });

  test("outil inconnu : -32602", () => {
    assert.equal(errorOf(request("tools/call", { name: "nope" })).code, -32602);
  });

  test("echec d'outil : isError, pas d'erreur de protocole", () => {
    const response = request("tools/call", { name: "clepsydre_get_task", arguments: { id: "t-inconnu" } });
    const result = resultOf(response);
    assert.equal(result.isError, true);
    const content = (result.content as Json[])[0] as Json;
    assert.match(String(content.text), /tâche introuvable/);
  });
});

describe("process stdio (bout en bout)", () => {
  const dirs: string[] = [];
  after(() => {
    for (const dir of dirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Déjà nettoyé.
      }
    }
  });

  function startServer(): { dir: string; child: ReturnType<typeof spawn>; send: (message: Json) => void; next: () => Promise<Json> } {
    const dir = mkdtempSync(join(tmpdir(), "clepsydre-proto-"));
    dirs.push(dir);
    const child = spawn(process.execPath, [SERVER, "--no-sched"], {
      env: { ...process.env, CLEPSYDRE_HOME: dir }
    });
    const lines: string[] = [];
    let buffer = "";
    const waiters: Array<(line: string) => void> = [];
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim().length > 0) {
          const waiter = waiters.shift();
          if (waiter) waiter(line);
          else lines.push(line);
        }
        index = buffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => {
      // Les logs serveur vont sur stderr : rien a en faire ici.
    });
    return {
      dir,
      child,
      send: (message: Json) => child.stdin?.write(`${JSON.stringify(message)}\n`),
      next: () =>
        new Promise((resolve, reject) => {
          const pending = lines.shift();
          if (pending) {
            resolve(JSON.parse(pending) as Json);
            return;
          }
          const timer = setTimeout(() => reject(new Error("pas de reponse en 5 s")), 5_000);
          waiters.push((line) => {
            clearTimeout(timer);
            resolve(JSON.parse(line) as Json);
          });
        })
    };
  }

  test("initialize puis tools/list sur le process reel", async () => {
    const server = startServer();
    try {
      server.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
      const init = await server.next();
      // Version connue proposee : le serveur l'echo (comportement legacy).
      assert.equal((init.result as Json).protocolVersion, "2024-11-05");

      server.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const list = await server.next();
      const tools = (list.result as Json).tools as Json[];
      assert.ok(tools.length >= 10);

      server.child.stdin?.end();
      const code = await new Promise<number>((resolve) => server.child.on("exit", resolve));
      assert.equal(code, 0);
    } finally {
      server.child.kill();
    }
  });

  test("mode --call : un appel, une reponse, code de sortie 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clepsydre-call-"));
    dirs.push(dir);
    const child = spawn(process.execPath, [SERVER, "--call", "clepsydre_server_info"], {
      env: { ...process.env, CLEPSYDRE_HOME: dir }
    });
    child.stdin?.write(JSON.stringify({}));
    child.stdin?.end();
    const { stdout, code } = await new Promise<{ stdout: string; code: number }>((resolve) => {
      let out = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        out += chunk;
      });
      // Un seul abonnement, sur "close" (stdio referme) : "exit" peut etre
      // emis avant la fin du flux, et un deuxieme await ne recevrait jamais
      // un evenement deja emis — le test resterait bloque jusqu'au timeout.
      child.on("close", (exitCode) => resolve({ stdout: out, code: exitCode ?? -1 }));
    });
    assert.equal(code, 0);
    const response = JSON.parse(stdout.trim()) as Json;
    const result = response.result as Json;
    const payload = JSON.parse(String((result.content as Json[])[0]?.text ?? "{}")) as Json;
    assert.equal(payload.name, "novahiz-scheduler");
  });
});
