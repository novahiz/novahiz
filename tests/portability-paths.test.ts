import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expandHome, loadSpec } from "../src/spec.ts";
import { isProtectedIndexPath } from "../src/gate.ts";

// Portability gate of the delivered tree.
//
// Novahiz is installed by every member of the community into
// `~/.config/novahiz` - a directory that follows the user, not a fixed
// location. A single absolute path left in the source therefore breaks the
// system for everyone except the machine it was written on. This was measured,
// not assumed: a 2026-10-14 audit found the Playwright profile pinned to a
// hardcoded drive letter and account name in the instructions shipped to every
// session, in two skills, in three docs and in a startup script.
//
// The two regexes below are deliberately narrow: they require a real account
// name after `Users`, so an illustration such as a drive path spelled out to
// its shape (targets.ts, a comment explaining that a drive separator is not an
// escape) does not fail the gate. The rule is about paths a user would actually
// be handed, not about documentation that spells out a shape. Test fixtures are
// excluded: they need example paths, and they use an obviously fake account.

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");

/** Directories whose contents ship to a user. */
const DELIVERED = ["src", "install", "mcp", "adapters", "skills", "docs", "bin", "catalog"];

const EXTENSIONS = new Set([".ts", ".mjs", ".mts", ".md", ".json", ".ps1", ".cmd", ".sh"]);

/** Machine-generated or local-only trees: regenerated, never published. */
const SKIP = /(^|[\\/])(node_modules|dist|build|tmp|logs|\.search|\.snap|\.graph|project-memory|archive|evals)([\\/]|$)/;

/** Backups and local data: kept on a machine, never part of a deliverable. */
const SKIP_FILE = /(\.novahiz-bak|\.pre-.*\.bak|\.bak|\.sqlite|\.sqlite-.*|\.jsonl|\.log|\.tgz|\.age)$/;

const WINDOWS_USER_PATH = /[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9._-]+/;
const UNIX_HOME_PATH = /(?:^|[^A-Za-z0-9._\\/])\/(?:home|Users)\/[A-Za-z0-9._-]+\//;
const ACCOUNT_NAMES = [/\bTawhid\b/, /\bhiz\b/];

interface Offender {
  file: string;
  line: number;
  text: string;
}

function deliveredFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP.test(full)) continue;
        walk(full);
        continue;
      }
      if (!EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) continue;
      if (SKIP_FILE.test(entry.name)) continue;
      if (SKIP.test(full)) continue;
      out.push(full);
    }
  };
  for (const root of DELIVERED) {
    const dir = join(repoRoot, root);
    if (existsSync(dir)) walk(dir);
  }
  return out;
}

function scan(pattern: RegExp): Offender[] {
  const offenders: Offender[] = [];
  for (const file of deliveredFiles()) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) {
        offenders.push({
          file: relative(repoRoot, file).split("\\").join("/"),
          line: index + 1,
          text: line.trim().slice(0, 90)
        });
      }
    });
  }
  return offenders;
}

const report = (label: string, offenders: Offender[]): string =>
  offenders.length === 0
    ? `${label}: none`
    : `${label}:\n` + offenders.map((o) => `  ${o.file}:${o.line}  ${o.text}`).join("\n");

test("aucun chemin absolu machine dans l'arbre livre", () => {
  const windows = scan(WINDOWS_USER_PATH);
  const unix = scan(UNIX_HOME_PATH);
  assert.deepEqual(windows, [], report("chemins Windows absolus", windows));
  assert.deepEqual(unix, [], report("chemins Unix /home absolus", unix));
});

test("aucun nom de compte machine dans l'arbre livre", () => {
  for (const name of ACCOUNT_NAMES) {
    const offenders = scan(name);
    assert.deepEqual(offenders, [], report(`nom de compte ${String(name)}`, offenders));
  }
});

test("chaque commande MCP du catalogue est resolvable par expandHome", () => {
  // A literal `~` in a spawn argv is a broken spawn: `node` never expands it,
  // and on Windows it means nothing at all. catalog/providers.json ships those
  // commands, and src/providers.ts:40 maps expandHome over them before handing
  // them to the harness. This pins that contract: if a provider ever gains a
  // command element expandHome cannot turn into an absolute path, the MCP
  // server silently fails to start for every user.
  const spec = loadSpec(repoRoot);
  assert.ok(spec.providers.length > 0, "no provider loaded: the catalog is unreadable, this test proved nothing");

  // A command element is a path only when it is spelled like one: `~`, `/`,
  // `\`, `./`, `../` or a drive letter. Everything else is a program name
  // (`node`, `npx`) or an npm spec (`@playwright/mcp@0.0.82`), which no file
  // resolution should touch.
  const looksLikePath = (element: string): boolean => /^(~|[\\/]|\.\\|\.\.|[A-Za-z]:[\\/])/.test(element);

  for (const provider of spec.providers) {
    const argv = provider.command ?? [provider.id];
    for (const element of argv) {
      if (!looksLikePath(element)) continue;
      const resolved = expandHome(element);
      assert.ok(
        isAbsolute(resolved),
        `provider ${provider.id}: command element ${JSON.stringify(element)} resolves to ${JSON.stringify(resolved)} - expandHome cannot turn it absolute, so the MCP server never starts for another user`
      );
    }
  }
});

test("le garde-fou C3 voit aussi les separateurs Windows", () => {
  // build/installed-skills.json and build/catalog.json define what the gate
  // requires. The guard compared suffixes spelled with "/", so on Windows
  // (`...\build\catalog.json`) it never fired and the two files were editable
  // like any build output. Both separators must reach the same verdict.
  assert.equal(isProtectedIndexPath("build/catalog.json"), true);
  assert.equal(isProtectedIndexPath("build/installed-skills.json"), true);
  assert.equal(isProtectedIndexPath(String.raw`C:\Users\someone\.config\novahiz\build\catalog.json`), true);
  assert.equal(isProtectedIndexPath("C:/Users/someone/.config/novahiz/build/installed-skills.json"), true);
  assert.equal(isProtectedIndexPath("src/gate.ts"), false);
  assert.equal(isProtectedIndexPath("build/catalog.ts"), false);
});

test("le home se resout sans variable d'environnement", () => {
  // A home built from `process.env.HOME || process.env.USERPROFILE || ""`
  // becomes a cwd-relative path when both are absent - a service, a daemon
  // child or a container - and everything downstream then reads a ghost home.
  const home = NovahizHomeForTest();
  assert.ok(isAbsolute(home), `home resolved relative: ${JSON.stringify(home)}`);
  assert.ok(!home.includes("undefined") && !home.includes("null"), `home carries a placeholder: ${home}`);
  assert.ok(statSync(home).isDirectory(), `home does not exist on this machine: ${home}`);
});

function NovahizHomeForTest(): string {
  return expandHome(process.env.NOVAHIZ_HOME ?? "~/.config/novahiz");
}
