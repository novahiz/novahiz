// Modes de l'installateur et detection de plateforme (install/lib.mjs).
//
// Deux moments, deux modes : le postinstall npm ne lance que le core (local,
// sans reseau ni sudo), le premier lancement du CLI rejoue les extras. Ces
// tests verrouillent les helpers sans ecrire hors d'un dossier temporaire, et
// figent les invariants du paquet (postinstall --core, bootstrap supprime) qui
// peuvent casser en silence au prochain refactor.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

import { installMode, shellSetting, which } from "../install/lib.mjs";
import { manualCoreBootstrap } from "../src/deps.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("installMode", () => {
  test("sans drapeau : tout, comportement historique de novahiz-install", () => {
    assert.deepEqual(installMode({}), { core: true, extras: true, mode: "all" });
  });

  test("--core seul : postinstall npm, ni reseau ni sudo", () => {
    assert.deepEqual(installMode({ core: true }), { core: true, extras: false, mode: "core" });
  });

  test("--extras seul : rejoue les extras d'un core deja installe", () => {
    assert.deepEqual(installMode({ extras: true }), { core: false, extras: true, mode: "extras" });
  });

  test("les deux drapeaux valent tout : on ne refuse jamais ce qui est demande", () => {
    assert.deepEqual(installMode({ core: true, extras: true }), { core: true, extras: true, mode: "all" });
  });

  test("un drapeau a false ne compte pas", () => {
    assert.deepEqual(installMode({ core: false }), { core: true, extras: true, mode: "all" });
  });
});

describe("which : scan de PATH, sans which/where externe", () => {
  test("trouve un binaire present et ignore un absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "novahiz-which-"));
    try {
      writeFileSync(join(dir, "tool"), "");
      writeFileSync(join(dir, "tool.CMD"), "");
      assert.equal(which("tool", { PATH: dir }), true);
      assert.equal(which("missing", { PATH: dir }), false);
      assert.equal(which("tool", { PATH: "" }), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("PATHEXT sous Windows, extension exacte ailleurs", () => {
    const dir = mkdtempSync(join(tmpdir(), "novahiz-which-"));
    try {
      writeFileSync(join(dir, "pwsh.EXE"), "");
      assert.equal(which("pwsh", { PATH: dir }, "win32"), true);
      assert.equal(which("pwsh", { PATH: dir }, "linux"), false);
      assert.equal(which("pwsh", { PATH: `${dir};${dir}`, PATHEXT: ".EXE" }, "win32"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("shellSetting", () => {
  test("macOS : le shell de l'utilisateur, plus de bash force", () => {
    assert.equal(shellSetting({ SHELL: "/bin/zsh" }, "darwin"), "zsh");
    assert.equal(shellSetting({ SHELL: "/usr/bin/bash" }, "linux"), "bash");
  });

  test("shell inconnu ou absent : repli sur bash", () => {
    assert.equal(shellSetting({ SHELL: "/usr/bin/fish" }, "linux"), "bash");
    assert.equal(shellSetting({}, "linux"), "bash");
  });

  test("Windows : pwsh si present, sinon powershell.exe qui est garanti", () => {
    assert.equal(shellSetting({}, "win32", () => true), "pwsh");
    assert.equal(shellSetting({}, "win32", () => false), "powershell");
  });
});

describe("manualCoreBootstrap : rien de privilegie ni de telecharge n'est execute", () => {
  test("sudo et les scripts passes a un shell restent manuels", () => {
    assert.equal(manualCoreBootstrap(["sudo", "apt-get", "install", "-y", "python3"]), true);
    assert.equal(manualCoreBootstrap(["sh", "-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"]), true);
    assert.equal(manualCoreBootstrap(["/bin/bash", "-c", "true"]), true);
  });

  test("les gestionnaires de paquets a argv structure restent executables", () => {
    assert.equal(manualCoreBootstrap(["brew", "install", "uv"]), false);
    assert.equal(manualCoreBootstrap(["winget", "install", "Python.Python.3.13"]), false);
    assert.equal(manualCoreBootstrap(["node", "--version"]), false);
  });
});

describe("contrat du paquet : un seul point d'entree", () => {
  test("le postinstall npm ne lance que le core", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.match(pkg.scripts.postinstall, /install\.mjs --yes --core/);
    assert.equal(pkg.bin["novahiz-bootstrap"], undefined);
    assert.equal(pkg.scripts.bootstrap, undefined);
  });

  test("les wrappers supprimes ne reviennent pas", () => {
    for (const gone of ["install/bootstrap.mjs", "install/install.sh", "install/install.ps1", "bin/veille-mensuelle.ps1"]) {
      assert.equal(existsSync(join(root, gone)), false, `${gone} should stay deleted`);
    }
  });
});
