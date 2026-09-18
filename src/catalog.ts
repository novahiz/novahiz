import { mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expandHome, type Spec } from "./spec.ts";
import type { CatalogSkill } from "./relevance.ts";

type SkillRecord = {
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
  const text = content.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
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

function walkForSkillFiles(root: string, found: string[], visited: Set<string>, errors: string[]): void {
  let real: string;
  try {
    real = realpathSync(root);
  } catch (error) {
    errors.push(`scan could not resolve ${root}: ${String(error)}`);
    return;
  }
  if (visited.has(real)) return;
  visited.add(real);

  let entries: string[];
  try {
    entries = readdirSync(root).sort();
  } catch (error) {
    errors.push(`scan could not list ${root}: ${String(error)}`);
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry)) continue;
    const full = join(root, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch (error) {
      errors.push(`scan could not stat ${full}: ${String(error)}`);
      continue;
    }
    if (stats.isDirectory()) {
      walkForSkillFiles(full, found, visited, errors);
    } else if (entry === "SKILL.md") {
      found.push(full);
    }
  }
}

export function scanSkills(spec: Spec, errors: string[] = []): SkillRecord[] {
  const files: string[] = [];
  const visited = new Set<string>();
  for (const root of spec.config.skillRoots) {
    const expanded = expandHome(root);
    walkForSkillFiles(isAbsolute(expanded) ? expanded : join(spec.root, expanded), files, visited, errors);
  }
  files.sort();

  const byId = new Map<string, SkillRecord>();
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch (error) {
      errors.push(`scan could not read ${file}: ${String(error)}`);
      continue;
    }
    const frontmatter = parseFrontmatter(content);
    const folder = basename(join(file, ".."));
    const id = (frontmatter.name || folder).trim();
    if (id.length === 0) continue;
    const override = spec.overrides.skills?.[id];
    // M4: power was uncapped — a rogue override (power: 100) always won the
    // "better" comparison and could force an attacker-controlled skill.
    // Clamp to the documented 0..5 range, non-numeric falls back to 3.
    const rawPower = override?.power;
    const power =
      typeof rawPower === "number" && Number.isFinite(rawPower) ? Math.min(Math.max(Math.trunc(rawPower), 0), 5) : 3;
    const record: SkillRecord = {
      id,
      name: frontmatter.name || folder,
      description: frontmatter.description || "",
      sourcePath: file,
      power,
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

type InstalledIndex = {
  available: boolean;
  skills: Set<string>;
};

export function writeCatalog(spec: Spec, skills: SkillRecord[]): string {
  const directory = join(spec.root, "build");
  mkdirSync(directory, { recursive: true });
  const target = join(directory, "catalog.json");
  const records = skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    power: skill.power,
    stars: skill.stars,
    tags: skill.tags,
    categories: skill.categories
  }));
  writeFileSync(target, `${JSON.stringify(records, null, 2)}\n`, "utf8");
  return target;
}

export function loadCatalog(spec: Spec): CatalogSkill[] {
  try {
    const raw = readFileSync(join(spec.root, "build", "catalog.json"), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CatalogSkill[]) : [];
  } catch {
    return [];
  }
}

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
  // M3: the destructive DELETE used to run outside the try — a failure between
  // DELETE and COMMIT left an empty catalog with no rollback. Everything is now
  // inside the transaction, and ROLLBACK itself is guarded.
  try {
    db.exec("BEGIN; DELETE FROM skills; DELETE FROM categories; DELETE FROM rules;");
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

    const insertRule = db.prepare("INSERT INTO rules (id, json) VALUES (?, ?)");
    for (const rule of spec.rules) {
      insertRule.run(rule.id, JSON.stringify(rule));
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // no transaction was open — nothing to roll back
    }
    throw error;
  }
}
