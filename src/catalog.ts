import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expandHome, type Spec } from "./spec.ts";

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  power: number;
  stars: number | null;
  tags: string[];
  categories: string[];
};

const IGNORED_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return result;
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) return result;

  const block = lines.slice(1, end);
  for (let index = 0; index < block.length; index += 1) {
    const line = block[index];
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (key.length === 0) continue;
    const raw = line.slice(separator + 1).trim();
    const isBlock = ["|", "|-", "|+", ">", ">-", ">+"].includes(raw);
    if (isBlock) {
      const folded = raw.startsWith(">");
      const parts: string[] = [];
      while (index + 1 < block.length) {
        const next = block[index + 1];
        if (next.trim() === "" || /^\s/.test(next)) {
          index += 1;
          parts.push(next.replace(/^\s+/, ""));
        } else {
          break;
        }
      }
      result[key] = folded ? parts.join(" ").replace(/\s+/g, " ").trim() : parts.join("\n").trim();
      continue;
    }
    result[key] = stripQuotes(raw);
  }
  return result;
}

function walkForSkillFiles(root: string, found: string[], visited: Set<string>): void {
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    return;
  }
  if (visited.has(real)) return;
  visited.add(real);

  let entries: string[];
  try {
    entries = readdirSync(root).sort();
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry)) continue;
    const full = join(root, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      walkForSkillFiles(full, found, visited);
    } else if (entry === "SKILL.md") {
      found.push(full);
    }
  }
}

export function scanSkills(spec: Spec): SkillRecord[] {
  const files: string[] = [];
  const visited = new Set<string>();
  for (const root of spec.config.skillRoots) {
    const expanded = expandHome(root);
    walkForSkillFiles(isAbsolute(expanded) ? expanded : join(spec.root, expanded), files, visited);
  }
  files.sort();

  const byId = new Map<string, SkillRecord>();
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const frontmatter = parseFrontmatter(content);
    const folder = basename(join(file, ".."));
    const id = (frontmatter.name || folder).trim();
    if (id.length === 0) continue;
    const override = spec.overrides.skills?.[id];
    const record: SkillRecord = {
      id,
      name: frontmatter.name || folder,
      description: frontmatter.description || "",
      sourcePath: file,
      power: override?.power ?? 3,
      stars: override?.stars ?? null,
      tags: override?.tags ?? [],
      categories: override?.categories ?? []
    };
    const existing = byId.get(id);
    const better =
      !existing ||
      record.power > existing.power ||
      (record.power === existing.power && record.sourcePath < existing.sourcePath);
    if (better) byId.set(id, record);
  }

  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function writeSkillIndex(spec: Spec, skills: SkillRecord[]): string {
  const directory = join(spec.root, "build");
  mkdirSync(directory, { recursive: true });
  const target = join(directory, "installed-skills.json");
  const ids = skills.map((skill) => skill.id).sort();
  writeFileSync(target, `${JSON.stringify(ids, null, 2)}\n`, "utf8");
  return target;
}

export type InstalledIndex = {
  available: boolean;
  skills: Set<string>;
};

export function loadInstalledSkills(spec: Spec): InstalledIndex {
  let raw: string;
  try {
    raw = readFileSync(join(spec.root, "build", "installed-skills.json"), "utf8");
  } catch {
    return { available: false, skills: new Set() };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { available: false, skills: new Set() };
    return { available: true, skills: new Set(parsed.map((value) => String(value))) };
  } catch {
    return { available: false, skills: new Set() };
  }
}

export function persistCatalog(db: DatabaseSync, spec: Spec, skills: SkillRecord[]): void {
  const now = new Date().toISOString();
  const upsertSkill = db.prepare(
    `INSERT INTO skills (id, name, description, source_path, power, stars, tags, categories, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       source_path = excluded.source_path,
       power = excluded.power,
       stars = excluded.stars,
       tags = excluded.tags,
       categories = excluded.categories,
       scanned_at = excluded.scanned_at`
  );
  for (const skill of skills) {
    upsertSkill.run(
      skill.id,
      skill.name,
      skill.description,
      skill.sourcePath,
      skill.power,
      skill.stars,
      JSON.stringify(skill.tags),
      JSON.stringify(skill.categories),
      now
    );
  }

  const upsertCategory = db.prepare(
    `INSERT INTO categories (id, label, priority, keywords, default_skills)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       priority = excluded.priority,
       keywords = excluded.keywords,
       default_skills = excluded.default_skills`
  );
  for (const category of spec.categories) {
    upsertCategory.run(
      category.id,
      category.label,
      category.priority,
      JSON.stringify(category.keywords),
      JSON.stringify(category.defaultSkills)
    );
  }

  db.prepare("DELETE FROM rules").run();
  const insertRule = db.prepare("INSERT INTO rules (id, json) VALUES (?, ?)");
  for (const rule of spec.rules) {
    insertRule.run(rule.id, JSON.stringify(rule));
  }
}
