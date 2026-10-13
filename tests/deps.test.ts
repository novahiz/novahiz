// Tests de la detection des dependances (2026-10-12): toolchain, entrypoints
// MCP locaux, sante npm du home, plan de bootstrap core et idempotence des
// installs de providers. Tout est pur ou en temporaire: aucun reseau, aucune
// config reelle lue ni ecrite.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";

import { commandExists, coreBootstrap, entrypointStatus, npmHealth, toolchainStatus } from "../src/deps.ts";
import { pendingInstallCommands } from "../src/providers.ts";
import type { Spec } from "../src/spec.ts";

const made: string[] = [];
after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "novahiz-deps-"));
  made.push(dir);
  return dir;
}

describe("deps: commandExists / toolchain", () => {
  test("node existe toujours ici", () => {
    assert.equal(commandExists("node"), true);
  });

  test("une commande absente n'existe pas", () => {
    assert.equal(commandExists("novahiz-binary-that-does-not-exist-42"), false);
  });

  test("toolchainStatus couvre les cinq entrees attendues", () => {
    const status = toolchainStatus();
    assert.deepEqual(status.map((entry) => entry.id), ["node", "npm", "npx", "uv", "python"]);
    assert.equal(status[0].ok, true);
    assert.ok(status[0].detail.length > 0, "node porte sa version");
  });

  test("python ok implique une version creusee (jamais l'alias WindowsApps)", () => {
    const python = toolchainStatus().find((entry) => entry.id === "python");
    assert.ok(python);
    if (python.ok) assert.match(python.detail, /^\d+\./);
  });
});

function fakeSpec(command: string[]): Spec {
  return {
    providers: [
      { id: "local", label: "Local", kind: "mcp", command },
      { id: "remote", label: "Remote", kind: "mcp", transport: "remote" },
      { id: "cmds", label: "Cmds", kind: "commands", requires: ["adb"] }
    ],
    config: { providers: { disabled: [] } }
  } as unknown as Spec;
}

describe("deps: entrypointStatus", () => {
  test("un entrypoint node absent est detecte", () => {
    const dir = tempDir();
    const entries = entrypointStatus(fakeSpec(["node", join(dir, "missing", "index.mjs")]));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ok, false);
  });

  test("un entrypoint present est ok; remote et commands ignores", () => {
    const dir = tempDir();
    const file = join(dir, "index.mjs");
    writeFileSync(file, "");
    const entries = entrypointStatus(fakeSpec(["node", file]));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ok, true);
  });

  test("un provider disabled est ignore", () => {
    const spec = {
      providers: [{ id: "local", label: "L", kind: "mcp", command: ["node", "/x/y.mjs"] }],
      config: { providers: { disabled: ["local"] } }
    } as unknown as Spec;
    assert.equal(entrypointStatus(spec).length, 0);
  });
});

describe("deps: npmHealth", () => {
  test("pas de package.json = rien a installer (ok)", () => {
    const dir = tempDir();
    assert.deepEqual(npmHealth(dir), { ok: true, missing: [], note: "no package.json (rien a installer)" });
  });

  test("dependance declaree absente de node_modules = non-ok", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { "present-pkg": "1.0.0", "gone-pkg": "1.0.0" } })
    );
    writeFileSync(join(dir, "package-lock.json"), "{}");
    mkdirSync(join(dir, "node_modules", "present-pkg"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "present-pkg", "package.json"), "{}");
    const health = npmHealth(dir);
    assert.equal(health.ok, false);
    assert.deepEqual(health.missing, ["gone-pkg"]);
  });

  test("lockfile absent = non-ok meme si node_modules est complet", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ devDependencies: { "a-b": "1.0.0" } }));
    mkdirSync(join(dir, "node_modules", "a-b"), { recursive: true });
    writeFileSync(join(dir, "node_modules", "a-b", "package.json"), "{}");
    const health = npmHealth(dir);
    assert.equal(health.ok, false);
    assert.equal(health.note, "package-lock.json absent");
  });
});

describe("deps: coreBootstrap", () => {
  test("chaque plateforme expose uv et python avec un argv spawnable", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
      const entries = coreBootstrap(platform);
      assert.deepEqual(entries.map((entry) => entry.id).sort(), ["python", "uv"]);
      for (const entry of entries) {
        assert.ok(entry.argv.length > 1, `${platform}/${entry.id} argv`);
        assert.notEqual(entry.argv[0], "");
      }
    }
  });
});

function installSpec(installedWhen?: string[]): Spec {
  return {
    providers: [
      { id: "pack", label: "Pack", kind: "skill", install: ["npx", "-y", "skills", "add", "pack"], installedWhen },
      { id: "always", label: "Always", kind: "skill", install: ["npx", "-y", "skills", "add", "x"] }
    ],
    config: { providers: { disabled: [] } }
  } as unknown as Spec;
}

describe("providers: pendingInstallCommands (idempotence)", () => {
  test("sans installedWhen: le provider part toujours", () => {
    const pending = pendingInstallCommands(installSpec(), new Set());
    assert.deepEqual(pending.map((entry) => entry.id), ["pack", "always"]);
  });

  test("installedWhen entierement satisfait: le pack saute", () => {
    const pending = pendingInstallCommands(installSpec(["marker"]), new Set(["marker"]));
    assert.deepEqual(pending.map((entry) => entry.id), ["always"]);
  });

  test("installedWhen partiellement satisfait: le pack part", () => {
    const pending = pendingInstallCommands(installSpec(["a", "b"]), new Set(["a"]));
    assert.deepEqual(pending.map((entry) => entry.id), ["pack", "always"]);
  });
});
