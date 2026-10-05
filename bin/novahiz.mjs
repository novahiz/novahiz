#!/usr/bin/env node
import { existsSync } from "node:fs";
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
const src = join(root, "src", "cli.ts");

// npm 11.16+ blocks install scripts unless `allowScripts` covers them, and a
// global install (`npm install -g`) has no package.json to record that
// approval in — so the postinstall can be skipped silently and the machine is
// left half configured. Finishing the job here means the package works
// whether or not npm let the lifecycle script through: the first real `novahiz`
// run installs the core (skills, plugin, agent, MCP), then behaves normally.
// Opt out with NOVAHIZ_AUTOINSTALL=0. Only a package installed from npm is
// touched; a repo checkout keeps its explicit `novahiz-install`.
if (underNodeModules && process.env.NOVAHIZ_AUTOINSTALL !== "0") {
  const args = process.argv.slice(2);
  const infoOnly = args.length > 0 && args.every((arg) => ["-v", "-V", "--version", "--help", "-h"].includes(arg));
  const home = process.env.NOVAHIZ_HOME ? resolve(process.env.NOVAHIZ_HOME) : join(homedir(), ".config", "novahiz");
  if (!infoOnly && !existsSync(join(home, ".novahiz-install.json"))) {
    process.stderr.write(
      "novahiz: npm skipped the postinstall script (allow-scripts), so the setup has not run yet.\n" +
        "novahiz: installing now — re-run it any time with `novahiz-install`.\n"
    );
    const setup = spawnSync(process.execPath, [join(root, "install", "install.mjs"), "--yes"], {
      stdio: "inherit",
      cwd: root,
      env: process.env
    });
    if (setup.status !== 0) {
      process.stderr.write("novahiz: automatic setup did not complete; run `novahiz-install` to see why.\n");
    }
  }
}

let target;
if (underNodeModules) {
  if (!existsSync(dist)) {
    process.stderr.write("novahiz: dist/cli.js is missing from the installed package. Reinstall: npm install novahiz\n");
    process.exit(1);
  }
  target = dist;
} else {
  target = src;
}

await import(pathToFileURL(target).href);
