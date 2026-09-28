#!/usr/bin/env node
// Reproduces .github/workflows/ci.yml on the local machine, step for step:
//
//   1. Build the catalog     NOVAHIZ_HOME=<repo> node src/cli.ts sync
//   2. Run tests             node --test                (NOVAHIZ_HOME absent, as on CI)
//   3. Installer dry-run     node install/install.mjs --dry-run --home <repo>/.ci-home
//   4. Run check             NOVAHIZ_HOME=<repo> node src/cli.ts check
//
// Usage: npm run ci:local
//
// The workflow is the source of truth; keep this list in sync with it. The run
// stops at the first failing step so the reported exit code matches CI.

import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ciHome = join(root, ".ci-home");

const steps = [
  {
    name: "Build the catalog",
    args: ["src/cli.ts", "sync"],
    env: { NOVAHIZ_HOME: root },
  },
  {
    name: "Run tests",
    args: ["--test"],
    env: { NOVAHIZ_HOME: null }, // the workflow does not define it either
  },
  {
    name: "Installer dry-run",
    args: ["install/install.mjs", "--dry-run", "--home", ciHome],
    env: {},
    prepare: () => rmSync(ciHome, { recursive: true, force: true }),
  },
  {
    name: "Run check",
    args: ["src/cli.ts", "check"],
    env: { NOVAHIZ_HOME: root },
  },
];

let failed = null;
for (const step of steps) {
  step.prepare?.();
  const env = { ...process.env };
  for (const [key, value] of Object.entries(step.env)) {
    if (value === null) delete env[key];
    else env[key] = value;
  }
  const label = `> ${step.name}`;
  console.log(`\n${label}\n${">".repeat(label.length)}`);
  const result = spawnSync(process.execPath, step.args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    failed = step.name;
    console.error(`\nci:local FAILED at "${step.name}" (exit ${result.status})`);
    break;
  }
}

if (failed) process.exit(1);
if (existsSync(ciHome)) rmSync(ciHome, { recursive: true, force: true });
console.log("\nci:local OK - all 4 workflow steps passed");
