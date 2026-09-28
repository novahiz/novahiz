#!/usr/bin/env node
/**
 * package-risk-audit: lightweight dependency risk hints from manifests.
 * Offline heuristics. Pair with `npm audit` / OSV queries for CVEs.
 *
 * Usage: node scripts/dep_risk_lint.mjs <project-dir> [...]
 * Exit 1 if any HIGH finding.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "Pipfile.lock",
  "composer.lock",
];

const SUSPICIOUS_NAME = /(?:^|[-_.@])(util|utils|helper|helpers|core|base|common|lib)(?:$|[-_.@])/i;

function walkProjects(root, out = []) {
  const st = statSync(root);
  if (!st.isDirectory()) return out;
  const hasManifest =
    existsSync(join(root, "package.json")) ||
    existsSync(join(root, "Cargo.toml")) ||
    existsSync(join(root, "pyproject.toml")) ||
    existsSync(join(root, "go.mod"));
  if (hasManifest) out.push(root);
  if (basename(root) === "node_modules" || basename(root) === "target" || basename(root) === ".git") return out;
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    try {
      if (statSync(p).isDirectory()) walkProjects(p, out);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function checkProject(dir) {
  const findings = [];
  const push = (level, id, file, msg) => findings.push({ level, id, file, msg });

  const lock = LOCKFILES.find((l) => existsSync(join(dir, l)));
  const pkgPath = join(dir, "package.json");

  if (existsSync(pkgPath) && !lock) {
    push("HIGH", "missing-lockfile", pkgPath, "package.json without committed lockfile");
  }

  if (existsSync(pkgPath)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      push("HIGH", "manifest-parse", pkgPath, "package.json is not valid JSON");
      pkg = null;
    }
    if (pkg) {
      const deps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      for (const [name, range] of Object.entries(deps)) {
        if (range === "*" || range === "latest" || range === "next") {
          push("HIGH", "floating-range", `${pkgPath}#${name}`, `Unpinned range: ${range}`);
        }
        if (/@[^/]+\/[^/]+$/.test(name) === false && name.includes("/") && !name.startsWith("@")) {
          // git or path deps often used for attacks when unexpected
          if (String(range).startsWith("git") || String(range).includes("github:")) {
            push("MED", "git-dependency", `${pkgPath}#${name}`, `Git dependency: ${range}`);
          }
        }
        if (SUSPICIOUS_NAME.test(name) && !name.startsWith("@types/") && !name.startsWith("@babel/")) {
          push("LOW", "generic-name", `${pkgPath}#${name}`, "Generic suffix name; confirm identity");
        }
      }
      if (pkg.scripts && (pkg.scripts.preinstall || pkg.scripts.install || pkg.scripts.postinstall)) {
        push("MED", "install-script", pkgPath, "Install lifecycle scripts present; review what they run");
      }
    }
  }

  if (lock) {
    try {
      const text = readFileSync(join(dir, lock), "utf8");
      if (lock.endsWith(".json")) {
        const data = JSON.parse(text);
        const packages = data.packages || data.dependencies || {};
        const count = Object.keys(packages).length;
        if (count > 400) {
          push("MED", "large-graph", join(dir, lock), `Lockfile lists ${count} package entries`);
        }
      }
    } catch {
      push("MED", "lock-parse", join(dir, lock), "Lockfile unreadable as JSON");
    }
  }

  return findings;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error("usage: node scripts/dep_risk_lint.mjs <project-dir> [...]");
  process.exit(2);
}

const projects = roots.flatMap((r) => walkProjects(r));
const all = projects.flatMap(checkProject);
const byLevel = { HIGH: [], MED: [], LOW: [] };
for (const f of all) byLevel[f.level].push(f);

for (const level of ["HIGH", "MED", "LOW"]) {
  for (const f of byLevel[level]) {
    console.log(`${level}\t${f.id}\t${f.file}\t${f.msg}`);
  }
}

const high = byLevel.HIGH.length;
console.error(`dep_risk_lint: ${projects.length} projects, ${all.length} findings (${high} HIGH)`);
process.exit(high > 0 ? 1 : 0);
