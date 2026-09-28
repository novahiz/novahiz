import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { emit, flagOn, type Parsed } from "./context.ts";
import { NovahizHome } from "../spec.ts";
import { ensureMemoryRoot, memoryRoot, writeEntry } from "../memory.ts";
import { ensureProjectAutoDocsConfig } from "./autodocs.ts";
import * as ui from "../render.ts";

type StepStatus = "created" | "skipped" | "dry-run" | "failed";

type InitStep = {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
};

type CleanupCandidate = {
  path: string;
  reason: string;
};

type ProjectInfo = {
  kind: string;
  name: string;
  version: string;
  markers: string[];
};

const DOC_FILES = ["ARCHITECTURE.md", "CONVENTIONS.md", "DECISIONS.md", "STANDARDS.md"] as const;

const CLEANUP_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /^\.DS_Store$/, reason: "macOS folder metadata" },
  { pattern: /^Thumbs\.db$/i, reason: "Windows thumbnail cache" },
  { pattern: /\.orig$/i, reason: "merge leftover" },
  { pattern: /\.rej$/i, reason: "patch reject leftover" },
  { pattern: /^npm-debug\.log.*$/i, reason: "npm debug log" },
  { pattern: /^yarn-error\.log.*$/i, reason: "yarn error log" },
  { pattern: /^.*\.novahiz-bak$/i, reason: "Novahiz installer backup" }
];

function detectProject(cwd: string): ProjectInfo {
  const markers: string[] = [];
  let name = "";
  let version = "";
  let kind = "unknown";

  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    markers.push("package.json");
    kind = "node";
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string; version?: string };
      name = typeof pkg.name === "string" ? pkg.name : "";
      version = typeof pkg.version === "string" ? pkg.version : "";
    } catch {
      // name falls back to the folder below
    }
  }
  if (existsSync(join(cwd, "Cargo.toml"))) {
    markers.push("Cargo.toml");
    if (kind === "unknown") kind = "rust";
  }
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "requirements.txt"))) {
    markers.push("python-manifest");
    if (kind === "unknown") kind = "python";
  }
  if (existsSync(join(cwd, "go.mod"))) {
    markers.push("go.mod");
    if (kind === "unknown") kind = "go";
  }
  if (existsSync(join(cwd, ".git"))) markers.push(".git");
  if (existsSync(join(cwd, "README.md"))) markers.push("README.md");

  if (!name) {
    name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? "project";
  }
  return { kind, name, version, markers };
}

function scanCleanup(cwd: string): CleanupCandidate[] {
  const candidates: CleanupCandidate[] = [];
  const skipDirs = new Set(["node_modules", ".git", "project-memory", "novahiz-docs", "dist", "build", ".next", "coverage"]);

  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full, depth + 1);
        continue;
      }
      for (const { pattern, reason } of CLEANUP_PATTERNS) {
        if (pattern.test(entry)) {
          candidates.push({ path: relative(cwd, full).split("\\").join("/"), reason });
          break;
        }
      }
    }
  };

  walk(cwd, 0);
  return candidates.sort((a, b) => a.path.localeCompare(b.path));
}

function copyDocs(templatesDir: string, targetDir: string, dryRun: boolean): InitStep {
  if (!existsSync(templatesDir)) {
    return { id: "docs", label: "Documentation skeleton", status: "failed", detail: `templates missing: ${templatesDir}` };
  }
  if (existsSync(targetDir)) {
    const existing = readdirSync(targetDir).filter((name) => name.endsWith(".md"));
    return {
      id: "docs",
      label: "Documentation skeleton",
      status: "skipped",
      detail: `novahiz-docs/ already has ${existing.length} file(s)`
    };
  }
  if (dryRun) {
    return {
      id: "docs",
      label: "Documentation skeleton",
      status: "dry-run",
      detail: `would create ${DOC_FILES.length} files under novahiz-docs/`
    };
  }
  try {
    mkdirSync(targetDir, { recursive: true });
    for (const file of DOC_FILES) {
      const src = join(templatesDir, file);
      if (existsSync(src)) copyFileSync(src, join(targetDir, file));
    }
    return {
      id: "docs",
      label: "Documentation skeleton",
      status: "created",
      detail: `${DOC_FILES.length} files in novahiz-docs/`
    };
  } catch (error) {
    return {
      id: "docs",
      label: "Documentation skeleton",
      status: "failed",
      detail: (error as Error).message
    };
  }
}

function initMemory(cwd: string, dryRun: boolean, seed: boolean, project: ProjectInfo): InitStep {
  const root = memoryRoot(cwd);
  if (dryRun) {
    const present = existsSync(root);
    return {
      id: "memory",
      label: "Project memory",
      status: "dry-run",
      detail: present ? "project-memory/ already present, seed would append" : "would create project-memory/"
    };
  }
  try {
    const index = ensureMemoryRoot(root);
    const seeded = index.slots.length === 0 && seed;
    if (seeded) {
      const stackLine = project.markers.length > 0 ? project.markers.join(", ") : "no manifest detected";
      writeEntry({
        title: "Project baseline",
        description: `Initial memory for ${project.name}`,
        tags: ["init", project.kind],
        root,
        content: [
          `Name: ${project.name}`,
          project.version ? `Version: ${project.version}` : null,
          `Kind: ${project.kind}`,
          `Markers: ${stackLine}`,
          `Initialized: ${new Date().toISOString()}`,
          "",
          "Next: fill novahiz-docs/ from a deep read of the codebase (skill novahiz-init)."
        ]
          .filter((line): line is string => line !== null)
          .join("\n")
      });
    }
    return {
      id: "memory",
      label: "Project memory",
      status: "created",
      detail: seeded ? "project-memory/ created with baseline slot" : `project-memory/ ready (${index.slots.length} slot(s))`
    };
  } catch (error) {
    return {
      id: "memory",
      label: "Project memory",
      status: "failed",
      detail: (error as Error).message
    };
  }
}

function projectDoctor(project: ProjectInfo): InitStep {
  if (project.markers.length === 0) {
    return {
      id: "doctor",
      label: "Project detection",
      status: "failed",
      detail: "no package.json, Cargo.toml, pyproject.toml, go.mod, or .git in cwd"
    };
  }
  return {
    id: "doctor",
    label: "Project detection",
    status: "created",
    detail: `${project.kind}: ${project.name}${project.version ? `@${project.version}` : ""} (${project.markers.join(", ")})`
  };
}

export function commandInit(parsed: Parsed): void {
  const cwd = process.cwd();
  const home = NovahizHome();
  const dryRun = flagOn(parsed, "dry-run");
  const docsOnly = flagOn(parsed, "docs-only");
  const memoryOnly = flagOn(parsed, "memory-only");
  const noSeed = flagOn(parsed, "no-seed");
  const applyCleanup = flagOn(parsed, "apply") && !dryRun;

  const project = detectProject(cwd);
  const steps: InitStep[] = [];

  steps.push(projectDoctor(project));

  const runMemory = !docsOnly;
  const runDocs = !memoryOnly;
  const runCleanup = !docsOnly && !memoryOnly;

  if (runMemory) steps.push(initMemory(cwd, dryRun, !noSeed, project));
  if (runDocs) {
    const templates = join(home, "skills", "novahiz-docs", "templates");
    steps.push(copyDocs(templates, join(cwd, "novahiz-docs"), dryRun));
  }

  if (!docsOnly && !memoryOnly) {
    if (dryRun) {
      steps.push({
        id: "autodocs",
        label: "Auto docs config",
        status: "dry-run",
        detail: "would write .novahiz/config.json with autoDocs=true"
      });
    } else {
      const status = ensureProjectAutoDocsConfig(cwd);
      steps.push({
        id: "autodocs",
        label: "Auto docs config",
        status: status === "failed" ? "failed" : status === "created" ? "created" : "skipped",
        detail: status === "failed" ? "could not write .novahiz/config.json" : `.novahiz/config.json ${status}`
      });
    }
  }

  let cleanup: CleanupCandidate[] = [];
  let cleanupApplied = 0;
  if (runCleanup) {
    cleanup = scanCleanup(cwd);
    if (applyCleanup && cleanup.length > 0) {
      const removed: string[] = [];
      for (const candidate of cleanup) {
        try {
          rmSync(join(cwd, candidate.path), { force: true });
          removed.push(candidate.path);
        } catch {
          // keep going; the count reflects what succeeded
        }
      }
      cleanupApplied = removed.length;
      cleanup = cleanup.filter((item) => !removed.includes(item.path));
    }
    steps.push({
      id: "cleanup",
      label: "Cleanup candidates",
      status: applyCleanup ? "created" : dryRun || cleanup.length > 0 ? "dry-run" : "skipped",
      detail: applyCleanup
        ? `removed ${cleanupApplied} file(s)`
        : cleanup.length > 0
          ? `${cleanup.length} candidate(s), none deleted (use --apply after review)`
          : "nothing safe to propose"
    });
  } else {
    steps.push({ id: "cleanup", label: "Cleanup candidates", status: "skipped", detail: "skipped by scope flag" });
  }

  const failed = steps.filter((step) => step.status === "failed");
  const value = {
    cwd,
    home,
    dryRun,
    project,
    steps,
    cleanup,
    cleanupApplied,
    next: failed.length === 0 ? "Run the novahiz-init skill in an agent to fill docs and deepen memory." : null,
    failed: failed.map((step) => step.id)
  };

  emit(parsed, value, () => {
    const lines = [
      ui.heading(dryRun ? "novahiz init (dry-run)" : "novahiz init"),
      ui.kv([
        ["Project", `${project.name}${project.version ? `@${project.version}` : ""}`],
        ["Cwd", cwd],
        ["Home", home]
      ]),
      "",
      ui.table(
        ["step", "status", "detail"],
        steps.map((step) => [
          step.label,
          step.status === "failed"
            ? ui.status(false)
            : step.status === "created"
              ? ui.status(true)
              : ui.style("dim", step.status),
          step.detail
        ])
      ),
      ""
    ];
    if (cleanup.length > 0 && !applyCleanup) {
      lines.push(ui.heading("Cleanup (not applied)"));
      for (const item of cleanup) lines.push(`  ${item.path}  ${ui.style("dim", item.reason)}`);
      lines.push("");
    }
    lines.push(
      failed.length > 0
        ? ui.style("red", `${failed.length} step(s) failed.`)
        : ui.style(
            "green",
            dryRun ? "Dry-run only. Re-run without --dry-run to write." : "Scaffold ready. Load the novahiz-init skill to finish."
          )
    );
    return lines.join("\n");
  });

  if (failed.length > 0) process.exitCode = 1;
}
