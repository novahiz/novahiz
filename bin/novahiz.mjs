#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
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
