#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// engines: node >=22.18. Node strips types only OUTSIDE node_modules
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), so:
//  - in the repo (or any checkout), run src/cli.ts directly;
//  - under node_modules, run the compiled dist/cli.js shipped by `prepare`.
const [major, minor] = process.versions.node.split(".").map((value) => Number.parseInt(value, 10));
if (major < 22 || (major === 22 && minor < 18)) {
  process.stderr.write(
    `novahiz requires Node 22.18 or later (found ${process.versions.node}). Upgrade Node: https://nodejs.org/\n`
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const underNodeModules = root.replace(/\\/g, "/").toLowerCase().includes("/node_modules/");
const dist = join(root, "dist", "cli.js");
const src = join(root, "src", "cli.ts"); console.error("DEBUG", JSON.stringify({underNodeModules, root, auto: process.env.NOVAHIZ_AUTOINSTALL, noextras: process.env.NOVAHIZ_NO_EXTRAS}));

// npm 11.16+ blocks install scripts unless `allowScripts` covers them, and a
// global install (`npm install -g`) has no package.json to record that
// approval in — so the postinstall can be skipped silently and the machine is
// left half configured. The first real `novahiz` run therefore finishes the
// job, in two passes:
//   1. no install manifest -> install the core (skills, plugin, agent, config);
//   2. manifest says extrasPending -> run the network/system extras once
//      (providers, global MCP servers, Obsidian vault, npm refresh).
// Opt out with NOVAHIZ_AUTOINSTALL=0 (both passes) or NOVAHIZ_NO_EXTRAS=1
// (extras only). A repo checkout keeps its explicit `novahiz-install`.
function readManifest(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

if (underNodeModules && process.env.NOVAHIZ_AUTOINSTALL !== "0") {
  const args = process.argv.slice(2);
  const infoOnly = args.length > 0 && args.every((arg) => ["-v", "-V", "--version", "--help", "-h"].includes(arg));
  const home = process.env.NOVAHIZ_HOME ? resolve(process.env.NOVAHIZ_HOME) : join(homedir(), ".config", "novahiz");
  const manifestPath = join(home, ".novahiz-install.json");
  const manifest = readManifest(manifestPath);
  const installer = join(root, "install", "install.mjs");
  const runInstaller = (mode, reason) => {
    process.stderr.write(`novahiz: ${reason}\n`);
    const setup = spawnSync(process.execPath, [installer, "--yes", mode], {
      stdio: "inherit",
      cwd: root,
      env: process.env
    });
    if (setup.status !== 0) {
      process.stderr.write(`novahiz: setup (${mode}) did not complete; re-run it with \`novahiz-install ${mode}\`.\n`);
    }
    return setup.status === 0;
  };
  if (!infoOnly && manifest === null) {
    const coreOk = runInstaller("--core", "first run - installing the core (the npm postinstall was skipped or did not finish).");
    // Meme lancement, deux passes : le premier appel doit tout laisser pret, pas
    // seulement le core. Les extras restent optionnels via NOVAHIZ_NO_EXTRAS=1.
    if (coreOk && process.env.NOVAHIZ_NO_EXTRAS !== "1") {
      runInstaller("--extras", "installing the extras (providers, global MCP servers, Obsidian vault). One time only; skip with NOVAHIZ_NO_EXTRAS=1.");
    }
  } else if (!infoOnly && manifest?.extrasPending === true && process.env.NOVAHIZ_NO_EXTRAS !== "1") {
    runInstaller("--extras", "finishing the setup installed earlier (providers, global MCP servers, Obsidian vault). One time only; skip with NOVAHIZ_NO_EXTRAS=1.");
  }
}

let target;
if (underNodeModules) {
  if (!existsSync(dist)) {
    process.stderr.write(
      "novahiz: dist/cli.js is missing from this package copy.\n" +
        "novahiz: npm blocked the `prepare` script (allow-scripts). Reinstall with:\n" +
        "novahiz:   npm install -g --allow-scripts=novahiz novahiz\n"
    );
    process.exit(1);
  }
  target = dist;
} else {
  target = src;
}

await import(pathToFileURL(target).href);
