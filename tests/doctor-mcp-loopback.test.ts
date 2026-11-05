import test from "node:test";
import assert from "node:assert/strict";
import { mcpEntryProblems } from "../src/commands/doctor.ts";

// Contract of the "MCP config" row for remote servers.

//
// Measured 2026-11-05 on the 0.12.x/0.13 install: doctor failed with
// "playwright: remote url is not https" while the configured server was
// `http://127.0.0.1:8931/mcp`. That address cannot be reached from off-host:
// the shared Playwright process listens on 127.0.0.1 with
// `--host 127.0.0.1`. The check rejected every non-https URL without
// distinguishing a remote exposure from a loopback socket, so a deliberate
// local topology read as a misconfiguration on every run.
//
// The rule kept here: plain http stays a problem only when the host is not the
// local machine. Everything routed through the loopback is accepted and the
// note still names the host, so the reader keeps seeing what is dialled.

const noCatalog = new Map<string, string>();
const noEnv: Record<string, string | undefined> = {};

function check(entry: Record<string, unknown>) {
  return mcpEntryProblems("playwright", entry, noCatalog, noEnv);
}

test("une URL http sur la loopback n'est pas une exposition", () => {
  const { problems, notes } = check({ type: "remote", url: "http://127.0.0.1:8931/mcp" });
  assert.deepEqual(problems, []);
  assert.deepEqual(notes, ["playwright: remote (127.0.0.1:8931)"]);
});

test("localhost et ::1 sont la loopback aussi", () => {
  assert.deepEqual(check({ type: "remote", url: "http://localhost:3000/mcp" }).problems, []);
  assert.deepEqual(check({ type: "remote", url: "http://[::1]:8080/mcp" }).problems, []);
});

test("un hôte distant en http reste refusé", () => {
  const { problems } = check({ type: "remote", url: "http://10.0.0.5:8931/mcp" });
  assert.deepEqual(problems, ["playwright: remote url is not https"]);
});

test("un hôte distant en https est accepté", () => {
  const { problems, notes } = check({ type: "remote", url: "https://stitch.googleapis.com/mcp" });
  assert.deepEqual(problems, []);
  assert.deepEqual(notes, ["playwright: remote (stitch.googleapis.com)"]);
});

test("ni commande ni URL reste une entrée morte", () => {
  const { problems } = check({ type: "remote" });
  assert.deepEqual(problems, ["playwright: no command"]);
});
