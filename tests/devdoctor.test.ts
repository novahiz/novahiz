import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTcpServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { devDoctor } from "../src/devdoctor.ts";

/**
 * NX-40 : un serveur figé accepte les connexions TCP et ne répond jamais en
 * HTTP. Il doit être signalé, pas compté comme absent.
 */

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function projet(): string {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-dev-"));
  made.push(dir);
  return dir;
}

function ecoute(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

function ferme(server: Server, sockets: Socket[] = []): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return new Promise((resolve) => server.close(() => resolve()));
}

test("un serveur qui répond n'est pas signalé comme figé", async () => {
  const server = createHttpServer((_request, response) => {
    response.statusCode = 200;
    response.end("ok");
  });
  const port = await ecoute(server);

  const rapport = await devDoctor({ projectRoot: projet(), ports: [port], probeFonts: false, timeoutMs: 80 });

  assert.equal(rapport.ports[0].listening, true);
  assert.equal(rapport.ports[0].httpStatus, 200);
  assert.ok(!rapport.warnings.some((warning) => warning.includes("sans jamais répondre")));
  await ferme(server);
});

test("un serveur figé est signalé", async () => {
  const sockets: Socket[] = [];
  const server = createTcpServer((socket) => {
    // Accepte la connexion et ne répond jamais : c'est la panne observée.
    sockets.push(socket);
  });
  const port = await ecoute(server);

  const rapport = await devDoctor({ projectRoot: projet(), ports: [port], probeFonts: false, timeoutMs: 60 });

  assert.equal(rapport.ports[0].listening, true);
  assert.equal(rapport.ports[0].httpStatus, null);
  assert.ok(
    rapport.warnings.some((warning) => warning.includes("sans jamais répondre")),
    `avertissement manquant : ${JSON.stringify(rapport.warnings)}`,
  );
  await ferme(server, sockets);
});

test("un port fermé ne déclenche aucun avertissement de figement", async () => {
  const rapport = await devDoctor({ projectRoot: projet(), ports: [1], probeFonts: false, timeoutMs: 50 });
  assert.equal(rapport.ports[0].listening, false);
  assert.equal(rapport.ports[0].httpStatus, null);
  assert.ok(!rapport.warnings.some((warning) => warning.includes("sans jamais répondre")));
});
