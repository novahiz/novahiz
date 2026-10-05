// `novahiz second-memory` — vault Obsidian dynamique synchronisé avec la mémoire novahiz.
// Structure PARA + MOC, catégories émergentes, auto-correction, sync bidirectionnel.
// Vault par défaut : ~/Documents/second-memory ; NOVAHIZ_SM_VAULT le redirige (tests hermétiques).
// Mémoire : NOVAHIZ_SM_MEMORY, sinon ~/.config/project-memory, sinon la racine workspace.
//
// Sync — last-writer-wins guidé par le frontmatter `novahiz_synced_at` :
// - push (note → slot) quand la note a changé depuis la dernière synchro ;
// - pull (slot → note) quand le slot a changé depuis la dernière synchro ;
// - égalité des horodatages dans SYNC_TOLERANCE_MS : rien à faire (stabilité) ;
// - note sans `novahiz_synced_at` (créée par une version antérieure) : rebuild note ← slot ;
// - création de note pour un slot actif sans note, création de slot pour une
//   note marquée `novahiz_slot_sync: true` sans `novahiz_slot_id` (opt-in).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

import { emit, flagOn, type Parsed } from "./context.ts";
import { createSlot, MAX_SUMMARY_CHARS, readIndex, readSlot, resolveMemoryDir, updateSlot, type SlotMeta } from "../memory.ts";

const INBOX_DIR = "Inbox";
const ARCHIVE_DIR = "Archive";
const TEMPLATES_DIR = "Templates";
const INDEX_FILE = "INDEX.md";
const LOG_FILE = "log.md";
const MOC_FILE = "_MOC.md";
const BACKUP_DIR = ".backup";
// Deux écritures plus rapprochées que ça comptent comme synchronisées :
// la mtime fraîche d'une note qu'on vient d'écrire ne doit pas repartir en push.
const SYNC_TOLERANCE_MS = 1500;

type VaultNote = {
  path: string;
  rel: string;
  frontmatter: Record<string, string>;
  body: string;
  links: string[];
};

type LinkTarget = { kind: "note"; rel: string } | { kind: "folder" };

type VaultIndex = {
  notes: string[];
  byBaseName: Map<string, string>;
  folders: string[];
};

type LintIssue = {
  severity: "error" | "warning" | "info";
  file: string;
  message: string;
  fix?: string;
  /** Cible brute d'un lien concerné (rewrite-link / remove-link). */
  link?: string;
  /** Forme canonique complète `[[...]]` à écrire (rewrite-link). */
  rewrite?: string;
};

type FixReport = {
  apply: boolean;
  renamed: string[];
  mocCreated: string[];
  triaged: string[];
  linksRewritten: string[];
  linksRemoved: string[];
  orphansLinked: string[];
  skipped: string[];
  backedUp: string[];
  remaining: number;
};

type SyncReport = {
  apply: boolean;
  vault: string;
  memory: string;
  actions: string[];
  warnings: string[];
};

function vaultPath(): string {
  const override = (process.env.NOVAHIZ_SM_VAULT ?? "").trim();
  if (override.length > 0) return override;
  return join(homedir(), "Documents", "second-memory");
}

function memoryRootForSync(): string | null {
  const override = (process.env.NOVAHIZ_SM_MEMORY ?? "").trim();
  if (override.length > 0) return existsSync(override) ? override : null;
  const globalRoot = join(homedir(), ".config", "project-memory");
  if (existsSync(globalRoot)) return globalRoot;
  const { dir } = resolveMemoryDir(undefined, process.cwd());
  return existsSync(dir) ? dir : null;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function normalizeRel(rel: string): string {
  return rel.replace(/\\/g, "/");
}

/** Refuse toute cible qui sortirait du vault (absolu, `..`, lettre de lecteur). */
function safeJoin(vault: string, rel: string): string | null {
  const clean = rel.replace(/\\/g, "/");
  if (clean.length === 0) return null;
  if (clean.startsWith("/") || /^[A-Za-z]:/.test(clean)) return null;
  if (clean.split("/").includes("..")) return null;
  return join(vault, clean);
}

function parseFmValue(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value;
    }
  }
  return value;
}

function fmValue(value: string): string {
  const v = value.trim();
  if (v.length === 0) return '""';
  if (/^\[[^\]]*\]$/.test(v)) return v;
  if (/^[A-Za-z0-9_./-]+$/.test(v)) return v;
  return JSON.stringify(v);
}

function renderFrontmatter(fm: Record<string, string>): string {
  const lines = Object.entries(fm).map(([key, value]) => `${key}: ${fmValue(value)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function readVaultNote(filePath: string, rel: string): VaultNote | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf8");
  const frontmatter: Record<string, string> = {};
  let body = raw;
  if (raw.startsWith("---\n")) {
    const end = raw.indexOf("\n---\n", 4);
    if (end !== -1) {
      const fmText = raw.slice(4, end);
      for (const line of fmText.split("\n")) {
        const colon = line.indexOf(":");
        if (colon > 0) {
          frontmatter[line.slice(0, colon).trim()] = parseFmValue(line.slice(colon + 1));
        }
      }
      body = raw.slice(end + 5);
    }
  }
  const links: string[] = [];
  const linkRe = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(body)) !== null) {
    const target = match[1].trim();
    if (target.length > 0) links.push(target);
  }
  return { path: filePath, rel: normalizeRel(rel), frontmatter, body, links };
}

function listVaultNotes(dir: string, base: string = ""): string[] {
  if (!existsSync(dir)) return [];
  const notes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      notes.push(...listVaultNotes(join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".md")) {
      notes.push(rel);
    }
  }
  return notes;
}

function isCategoryDir(name: string): boolean {
  return ![INBOX_DIR, ARCHIVE_DIR, TEMPLATES_DIR].includes(name) && !name.startsWith(".");
}

function isSystemFile(rel: string): boolean {
  const name = basename(rel);
  return name === INDEX_FILE || name === LOG_FILE || name === "README.md";
}

function isTemplateFile(rel: string): boolean {
  return rel.startsWith(`${TEMPLATES_DIR}/`);
}

function isMocFile(rel: string): boolean {
  return basename(rel).endsWith(MOC_FILE);
}

function isExcludedFromOrphan(rel: string): boolean {
  if (isSystemFile(rel) || isTemplateFile(rel) || isMocFile(rel)) return true;
  const top = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "";
  return [INBOX_DIR, ARCHIVE_DIR, TEMPLATES_DIR].includes(top);
}

function listCategories(vault: string): string[] {
  if (!existsSync(vault)) return [];
  return readdirSync(vault, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isCategoryDir(entry.name))
    .map((entry) => entry.name);
}

function soleCategory(vault: string): string | null {
  const categories = listCategories(vault);
  return categories.length === 1 ? categories[0] : null;
}

function buildVaultIndex(vault: string): VaultIndex {
  const notes = listVaultNotes(vault);
  const byBaseName = new Map<string, string>();
  for (const rel of notes) {
    const key = basename(rel).toLowerCase();
    if (!byBaseName.has(key)) byBaseName.set(key, rel);
  }
  const folders: string[] = [];
  const walk = (dir: string, base: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      folders.push(rel.toLowerCase());
      walk(join(dir, entry.name), rel);
    }
  };
  walk(vault, "");
  return { notes, byBaseName, folders };
}

/**
 * Résolution façon Obsidian : chemin relatif à la note, chemin racine,
 * alias `Home` → INDEX, raccourci `X MOC` → `X/_MOC.md`, basename partout
 * dans le vault, enfin nom de dossier. `null` = lien réellement mort.
 */
function resolveLink(vault: string, vi: VaultIndex, fromRel: string, rawTarget: string): LinkTarget | null {
  const target = rawTarget.trim().replace(/\\/g, "/");
  if (target.length === 0) return null;
  const withMd = target.endsWith(".md") ? target : `${target}.md`;
  const fromDir = normalizeRel(dirname(fromRel));
  const candidates: string[] = [];
  if (fromDir !== "." && fromDir !== fromRel) candidates.push(`${fromDir}/${withMd}`);
  candidates.push(withMd);
  for (const candidate of candidates) {
    const abs = safeJoin(vault, candidate);
    if (abs && existsSync(abs)) return { kind: "note", rel: normalizeRel(candidate) };
  }
  if (target === "Home" && existsSync(join(vault, INDEX_FILE))) return { kind: "note", rel: INDEX_FILE };
  const bare = safeJoin(vault, target);
  if (bare && existsSync(bare) && statSync(bare).isDirectory()) return { kind: "folder" };
  const moc = /^(.+)\s+MOC$/.exec(target);
  if (moc) {
    const mocRel = `${moc[1]}/${MOC_FILE}`;
    if (existsSync(join(vault, mocRel))) return { kind: "note", rel: mocRel };
  }
  const byName = vi.byBaseName.get(withMd.toLowerCase());
  if (byName) return { kind: "note", rel: byName };
  if (vi.folders.includes(target.toLowerCase())) return { kind: "folder" };
  return null;
}

/** Forme canonique à réécrire, ou null si le lien est déjà canonique. */
function canonicalForm(link: string, resolved: LinkTarget): string | null {
  if (resolved.kind !== "note") return null;
  const target = link.trim().replace(/\\/g, "/");
  const moc = /^(.+)\s+MOC$/.exec(target);
  if (moc && resolved.rel === `${moc[1]}/${MOC_FILE}`) {
    return `[[${resolved.rel.slice(0, -3)}|${target}]]`;
  }
  if (target === "Home" && resolved.rel === INDEX_FILE) return `[[INDEX|Home]]`;
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function linkPattern(target: string): RegExp {
  return new RegExp(`\\[\\[${escapeRegExp(target.trim())}(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`, "g");
}

function hasLink(text: string, target: string): boolean {
  return text.includes(`[[${target}]]`) || text.includes(`[[${target}|`);
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return slug.length > 0 ? slug : "note";
}

function mocTemplate(cat: string): string {
  return `---
type: moc
title: ${cat} MOC
---

# ${cat} MOC

## Subcategories

## Notes

## Related MOCs
`;
}

function parseIso(value: string | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function lintVault(): LintIssue[] {
  const issues: LintIssue[] = [];
  const vault = vaultPath();
  if (!existsSync(vault)) {
    issues.push({ severity: "error", file: "", message: "Vault not found. Run `novahiz second-memory init` first." });
    return issues;
  }

  const vi = buildVaultIndex(vault);
  const notes = vi.notes;

  // Noms de fichiers (système et templates exclus).
  for (const rel of notes) {
    if (isSystemFile(rel) || isTemplateFile(rel)) continue;
    const name = basename(rel);
    if (name !== name.toLowerCase() && !name.startsWith("_")) {
      issues.push({ severity: "warning", file: rel, message: `File name has uppercase: ${name}`, fix: "rename" });
    }
    if (name.includes(" ")) {
      issues.push({ severity: "warning", file: rel, message: `File name has spaces: ${name}`, fix: "rename" });
    }
  }

  // Liens : morts = error, formes non canoniques = info, cibles valides = rien.
  // La collecte pour les orphelins ignore INDEX, log et templates.
  const linked = new Set<string>();
  for (const rel of notes) {
    if (isTemplateFile(rel)) continue;
    const note = readVaultNote(join(vault, rel), rel);
    if (!note) continue;
    const seen = new Set<string>();
    for (const link of note.links) {
      if (seen.has(link)) continue;
      seen.add(link);
      const resolved = resolveLink(vault, vi, rel, link);
      if (!resolved) {
        issues.push({ severity: "error", file: rel, message: `Broken link: [[${link}]]`, fix: "remove-link", link });
        continue;
      }
      if (resolved.kind === "note" && rel !== INDEX_FILE && rel !== LOG_FILE && !isTemplateFile(rel)) {
        linked.add(resolved.rel);
      }
      const canonical = canonicalForm(link, resolved);
      if (canonical) {
        issues.push({
          severity: "info",
          file: rel,
          message: `Non-canonical link: [[${link}]] → ${canonical}`,
          fix: "rewrite-link",
          link,
          rewrite: canonical
        });
      }
    }
  }

  // Orphelins : non liés depuis un MOC (système, templates, MOC, Inbox,
  // Archive et Templates exclus — seuls les vrais notes de catégorie comptent).
  for (const rel of notes) {
    if (isExcludedFromOrphan(rel)) continue;
    if (!linked.has(rel)) {
      issues.push({ severity: "warning", file: rel, message: "Orphan note: not linked from any MOC", fix: "link" });
    }
  }

  // Catégories sans MOC.
  for (const cat of listCategories(vault)) {
    if (!existsSync(join(vault, cat, MOC_FILE))) {
      issues.push({ severity: "warning", file: cat, message: `Category ${cat}/ has no ${MOC_FILE}`, fix: "create-moc" });
    }
  }

  // Inbox en attente de triage.
  const inboxPath = join(vault, INBOX_DIR);
  if (existsSync(inboxPath)) {
    for (const note of listVaultNotes(inboxPath, INBOX_DIR)) {
      if (isSystemFile(note) || isMocFile(note)) continue;
      issues.push({ severity: "info", file: note, message: `Inbox note needs triage: ${note}`, fix: "triage" });
    }
  }

  return issues;
}

/**
 * Ajoute `- <linkText>` après l'en-tête `section` (ou crée la section en fin
 * de fichier). Détecte la cible déjà présente sous forme relative ou alias
 * pour ne jamais dupliquer un lien.
 */
function addLinkToSection(vault: string, rel: string, section: string, linkText: string, aliases: string[] = []): boolean {
  const abs = join(vault, rel);
  if (!existsSync(abs)) return false;
  const text = readFileSync(abs, "utf8");
  const inner = linkText.startsWith("[[") && linkText.endsWith("]]") ? linkText.slice(2, -2) : linkText;
  const parts = inner.split("|");
  const keys = [parts[0], parts.slice(1).join("|"), ...aliases].filter((key) => key.length > 0);
  for (const key of keys) {
    if (hasLink(text, key)) return false;
  }
  const lines = text.split("\n");
  const headerIndex = lines.findIndex((line) => line.trim() === section);
  if (headerIndex === -1) {
    const sep = text.endsWith("\n") || text.length === 0 ? "" : "\n";
    writeFileSync(abs, `${text}${sep}\n${section}\n- ${linkText}\n`, "utf8");
    return true;
  }
  lines.splice(headerIndex + 1, 0, `- ${linkText}`);
  writeFileSync(abs, lines.join("\n"), "utf8");
  return true;
}

/** Dossier + MOC + entrée INDEX pour une catégorie émergente. */
function ensureCategory(vault: string, cat: string): void {
  if (cat === INBOX_DIR) return;
  ensureDir(join(vault, cat));
  const mocRel = `${cat}/${MOC_FILE}`;
  if (!existsSync(join(vault, mocRel))) {
    writeFileSync(join(vault, mocRel), mocTemplate(cat), "utf8");
  }
  if (existsSync(join(vault, INDEX_FILE))) {
    addLinkToSection(vault, INDEX_FILE, "## Categories", `[[${cat}/_MOC|${cat} MOC]]`, [`${cat} MOC`]);
  }
}

function backupFile(vault: string, rel: string, backedUp: string[]): void {
  const backupDir = join(vault, ARCHIVE_DIR, BACKUP_DIR);
  ensureDir(backupDir);
  const flat = `${rel.replace(/[\\/]/g, "__")}.bak`;
  copyFileSync(join(vault, rel), join(backupDir, flat));
  backedUp.push(rel);
}

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/\b(code|coding|dev|developer|flutter|react|web|api|cli|npm|typescript|javascript|python|app|application|logiciel|android|ios)\b/i, "Code"],
  [/\b(trading|trader|finance|financial|crypto|bourse|invest|investissement|market|marche|marché)\b/i, "Trading"],
  [/\b(cours|course|learning|tutorial|formation|apprendre|etude|étude|ecole|école|universite|université)\b/i, "Cours"],
  [/\b(wiki|doc|docs|documentation|guide|reference|référence|manuel)\b/i, "Wiki"],
  [/\b(projet|project|build|release|version|novahiz|roadmap|plan)\b/i, "Projet"]
];

function categoryFor(text: string): string | null {
  for (const [pattern, cat] of CATEGORY_RULES) {
    if (pattern.test(text)) return cat;
  }
  return null;
}

function parseTags(value: string | undefined): string[] {
  if (!value) return [];
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((tag) => tag.trim().replace(/^"|"$/g, ""))
    .filter((tag) => tag.length > 0);
}

function writeNote(vault: string, rel: string, fm: Record<string, string>, body: string): void {
  const normalized = body.startsWith("\n") || body.length === 0 ? body : `\n${body}`;
  let text = renderFrontmatter(fm) + normalized;
  if (!text.endsWith("\n")) text += "\n";
  writeFileSync(join(vault, rel), text, "utf8");
}

function renderSlotNote(
  slot: SlotMeta,
  parts: { summary: string; details: string },
  syncedAt: string,
  keep: VaultNote | null
): { fm: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  fm.type = keep?.frontmatter.type ?? "resource";
  fm.title = slot.title;
  fm.created = keep?.frontmatter.created ?? syncedAt.slice(0, 10);
  fm.updated = syncedAt.slice(0, 10);
  fm.status = keep?.frontmatter.status ?? "active";
  fm.tags = `[${slot.tags.join(", ")}]`;
  fm.novahiz_slot_id = slot.id;
  fm.novahiz_synced_at = syncedAt;
  let body = `# ${slot.title}`;
  if (parts.summary.length > 0) body += `\n\n## Summary\n${parts.summary}`;
  if (parts.details.length > 0) body += `\n\n## Details\n${parts.details}`;
  return { fm, body };
}

function extractSection(body: string, name: string): string | null {
  const header = new RegExp(`^##\\s+${name}\\s*$`, "im");
  const match = header.exec(body);
  if (!match) return null;
  const rest = body.slice(match.index + match[0].length);
  const next = /^[ \t]*##[ \t]/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function stripSection(body: string, name: string): string {
  const header = new RegExp(`^##\\s+${name}\\s*$`, "im");
  const match = header.exec(body);
  if (!match) return body;
  const rest = body.slice(match.index + match[0].length);
  const next = /^[ \t]*##[ \t]/m.exec(rest);
  const end = next ? match.index + match[0].length + next.index : body.length;
  return `${body.slice(0, match.index)}${body.slice(end)}`.replace(/\n{3,}/g, "\n\n").trim();
}

/** Découpe le corps d'une note en Résumé (Summary) et Détails (Details). */
function splitNoteBody(body: string): { summary: string; details: string } {
  const summary = extractSection(body, "Summary") ?? "";
  const innerDetails = extractSection(body, "Details");
  let details = innerDetails !== null && innerDetails.length > 0 ? innerDetails : stripSection(body, "Summary");
  details = details.replace(/^#[^\n]*\n+/, "").trim();
  return { summary, details };
}

function initVault(): { created: string[]; vault: string } {
  const vault = vaultPath();
  const created: string[] = [];
  const dirs = [vault, join(vault, INBOX_DIR), join(vault, ARCHIVE_DIR), join(vault, TEMPLATES_DIR)];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  const indexPath = join(vault, INDEX_FILE);
  if (!existsSync(indexPath)) {
    writeFileSync(
      indexPath,
      `---
type: index
title: Second Memory
---

# Second Memory

Personal knowledge vault. Start here.

## Categories
<!-- Categories appear here as they emerge. Each links to its _MOC.md. -->

## System
- [[Inbox]]
- [[Archive]]
- [[Templates]]
`
    );
    created.push(indexPath);
  }

  const logPath = join(vault, LOG_FILE);
  if (!existsSync(logPath)) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);
    writeFileSync(logPath, `# Second Memory Log\n\nAppend-only. Never delete entries.\n\n## ${date}\n- ${time} — vault initialized\n`);
    created.push(logPath);
  }

  const templates: Record<string, string> = {
    "project.md": `---
type: project
title: Project Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [project]
---

# Project Name

## Goal
What is this project trying to achieve?

## Progress
- [ ] Task 1

## Notes
- [[Related Note]]

## Related MOCs
- [[Category MOC]]
`,
    "course.md": `---
type: course
title: Course Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [course]
---

# Course Name

## Key concepts
- Concept 1

## Resources
- [[Related Resource]]

## Related MOCs
- [[Category MOC]]
`,
    "resource.md": `---
type: resource
title: Resource Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [resource]
---

# Resource Name

## Summary
Brief description.

## Key takeaways
- Takeaway 1

## Related MOCs
- [[Category MOC]]
`,
    "wiki.md": `---
type: wiki
title: Wiki Article Name
created: YYYY-MM-DD
updated: YYYY-MM-DD
status: active
tags: [wiki]
---

# Wiki Article Name

## Overview
Brief overview.

## Details
Detailed content.

## See also
- [[Related Note]]

## Related MOCs
- [[Category MOC]]
`
  };
  for (const [name, content] of Object.entries(templates)) {
    const tplPath = join(vault, TEMPLATES_DIR, name);
    if (!existsSync(tplPath)) {
      writeFileSync(tplPath, content);
      created.push(tplPath);
    }
  }

  return { created, vault };
}

function fixVault(apply: boolean): FixReport {
  const report: FixReport = {
    apply,
    renamed: [],
    mocCreated: [],
    triaged: [],
    linksRewritten: [],
    linksRemoved: [],
    orphansLinked: [],
    skipped: [],
    backedUp: [],
    remaining: 0
  };
  const vault = vaultPath();
  if (!existsSync(vault)) {
    report.skipped.push("vault not found — run init first");
    return report;
  }

  const first = lintVault();

  // Phase 1 — structure : renommage (dédoublonné pour éviter le double
  // rename), création de MOC + entrée INDEX, triage Inbox → catégorie.
  const renames = new Set<string>();
  for (const issue of first) {
    if (issue.fix === "rename" && issue.file) renames.add(issue.file);
  }
  for (const rel of renames) {
    if (isSystemFile(rel) || isTemplateFile(rel)) continue;
    const name = basename(rel);
    const dirPart = normalizeRel(dirname(rel));
    const dirPrefix = dirPart === "." || dirPart === "" ? "" : `${dirPart}/`;
    const newName = name.toLowerCase().replace(/\s+/g, "-");
    if (newName === name) continue;
    const targetRel = `${dirPrefix}${newName}`;
    if (existsSync(join(vault, targetRel))) {
      report.skipped.push(`rename ${rel} → ${targetRel}: target exists`);
      continue;
    }
    if (apply) {
      backupFile(vault, rel, report.backedUp);
      renameSync(join(vault, rel), join(vault, targetRel));
      report.renamed.push(`renamed: ${rel} → ${targetRel}`);
    } else {
      report.renamed.push(`would rename: ${rel} → ${targetRel}`);
    }
  }

  for (const issue of first) {
    if (issue.fix !== "create-moc" || !issue.file) continue;
    const cat = issue.file;
    if (apply) {
      ensureCategory(vault, cat);
      report.mocCreated.push(`created: ${cat}/${MOC_FILE}`);
    } else {
      report.mocCreated.push(`would create: ${cat}/${MOC_FILE}`);
    }
  }

  for (const issue of first) {
    if (issue.fix !== "triage" || !issue.file) continue;
    const rel = issue.file;
    const note = readVaultNote(join(vault, rel), rel);
    const signal = `${note?.frontmatter.title ?? ""} ${note?.body ?? ""}`;
    const cat = categoryFor(signal) ?? soleCategory(vault);
    if (!cat) {
      report.skipped.push(`kept in Inbox: ${rel} (no category signal)`);
      continue;
    }
    const targetRel = `${cat}/${basename(rel)}`;
    if (existsSync(join(vault, targetRel))) {
      report.skipped.push(`triage ${rel} → ${targetRel}: target exists`);
      continue;
    }
    if (apply) {
      ensureCategory(vault, cat);
      backupFile(vault, rel, report.backedUp);
      renameSync(join(vault, rel), join(vault, targetRel));
      report.triaged.push(`triaged: ${rel} → ${targetRel}`);
    } else {
      report.triaged.push(`would triage: ${rel} → ${targetRel}`);
    }
  }

  // Phase 2 — liens : re-lint après la phase 1 (les chemins ont bougé),
  // puis réparation canonique, retrait des liens morts, liaison des orphelins.
  const second = apply ? lintVault() : first;
  type FileFix = { rewrites: Array<{ from: string; to: string }>; removals: string[] };
  const perFile = new Map<string, FileFix>();
  const orphans: string[] = [];
  for (const issue of second) {
    if (issue.fix === "rewrite-link" && issue.file && issue.link && issue.rewrite) {
      const entry = perFile.get(issue.file) ?? { rewrites: [], removals: [] };
      entry.rewrites.push({ from: issue.link, to: issue.rewrite });
      perFile.set(issue.file, entry);
    }
    if (issue.fix === "remove-link" && issue.file && issue.link) {
      const entry = perFile.get(issue.file) ?? { rewrites: [], removals: [] };
      entry.removals.push(issue.link);
      perFile.set(issue.file, entry);
    }
    if (issue.fix === "link" && issue.file) orphans.push(issue.file);
  }

  for (const [rel, fileFix] of perFile) {
    if (fileFix.rewrites.length === 0 && fileFix.removals.length === 0) continue;
    if (!apply) {
      for (const rewrite of fileFix.rewrites) report.linksRewritten.push(`would rewrite: ${rel} [[${rewrite.from}]] → ${rewrite.to}`);
      for (const dead of fileFix.removals) report.linksRemoved.push(`would remove: ${rel} [[${dead}]]`);
      continue;
    }
    const abs = join(vault, rel);
    if (!existsSync(abs)) continue;
    let text = readFileSync(abs, "utf8");
    let changed = false;
    for (const rewrite of fileFix.rewrites) {
      const before = text;
      text = text.replace(linkPattern(rewrite.from), () => rewrite.to);
      if (text !== before) {
        changed = true;
        report.linksRewritten.push(`rewritten: ${rel} [[${rewrite.from}]] → ${rewrite.to}`);
      }
    }
    for (const dead of fileFix.removals) {
      const before = text;
      text = text.replace(linkPattern(dead), "");
      if (text !== before) {
        // Une puce qui ne portait plus que ce lien n'a plus de sens : on la
        // retire, sans toucher au reste de la ligne ailleurs dans le fichier.
        text = text
          .split("\n")
          .filter((line) => !/^[ \t]*-[ \t]*$/.test(line))
          .join("\n");
        changed = true;
        report.linksRemoved.push(`removed: ${rel} [[${dead}]]`);
      }
    }
    if (changed) {
      backupFile(vault, rel, report.backedUp);
      writeFileSync(abs, text, "utf8");
    }
  }

  for (const rel of orphans) {
    const top = rel.includes("/") ? rel.slice(0, rel.indexOf("/")) : "";
    const mocRel = top.length > 0 && isCategoryDir(top) ? `${top}/${MOC_FILE}` : INDEX_FILE;
    const canonical = rel.slice(0, -3);
    const linkText = `[[${canonical}]]`;
    if (!apply) {
      report.orphansLinked.push(`would link: ${rel} → ${mocRel}`);
      continue;
    }
    if (!existsSync(join(vault, mocRel))) {
      report.skipped.push(`orphan ${rel}: no ${mocRel} to link into`);
      continue;
    }
    if (addLinkToSection(vault, mocRel, "## Notes", linkText)) {
      report.orphansLinked.push(`linked: ${rel} → ${mocRel}`);
    } else {
      report.skipped.push(`orphan ${rel}: already linked in ${mocRel}`);
    }
  }

  report.remaining = lintVault().length;
  return report;
}

function slotBody(memory: string, slot: SlotMeta): { summary: string; details: string } {
  const file = readSlot(memory, slot);
  return { summary: file.body.summary ?? "", details: file.body.details ?? "" };
}

function stampNote(vault: string, note: VaultNote, extra: Record<string, string>): void {
  const fm: Record<string, string> = { ...note.frontmatter, ...extra, updated: todayIso() };
  writeNote(vault, note.rel, fm, note.body);
}

function syncWithMemory(apply: boolean): SyncReport {
  const vault = vaultPath();
  const report: SyncReport = { apply, vault, memory: "", actions: [], warnings: [] };
  if (!existsSync(vault)) {
    report.warnings.push("vault not found — run init first");
    return report;
  }
  const memory = memoryRootForSync();
  if (!memory) {
    report.warnings.push("no project-memory found");
    return report;
  }
  report.memory = memory;

  let index;
  try {
    index = readIndex(memory);
  } catch {
    report.warnings.push("memory index unreadable");
    return report;
  }

  const vi = buildVaultIndex(vault);
  const notesBySlot = new Map<string, VaultNote>();
  const flagged: VaultNote[] = [];
  for (const rel of vi.notes) {
    if (isTemplateFile(rel) || isSystemFile(rel)) continue;
    const note = readVaultNote(join(vault, rel), rel);
    if (!note) continue;
    const slotId = note.frontmatter.novahiz_slot_id;
    if (slotId) {
      notesBySlot.set(slotId, note);
    } else if ((note.frontmatter.novahiz_slot_sync ?? "").toLowerCase() === "true") {
      flagged.push(note);
    }
  }

  for (const slot of index.slots) {
    if (slot.status !== "active") continue;
    const note = notesBySlot.get(slot.id);

    if (!note) {
      const signal = `${slot.title} ${slot.description} ${(slot.tags ?? []).join(" ")}`;
      const cat = categoryFor(signal) ?? INBOX_DIR;
      const rel = `${cat}/${slot.id}-${slugify(slot.title)}.md`;
      report.actions.push(`${apply ? "create note" : "would create note"}: ${rel} ← slot ${slot.id}`);
      if (apply) {
        try {
          const body = slotBody(memory, slot);
          if (cat !== INBOX_DIR) ensureCategory(vault, cat);
          const rendered = renderSlotNote(slot, body, new Date().toISOString(), null);
          writeNote(vault, rel, rendered.fm, rendered.body);
          const mocRel = `${cat}/${MOC_FILE}`;
          if (existsSync(join(vault, mocRel))) {
            addLinkToSection(vault, mocRel, "## Notes", `[[${rel.slice(0, -3)}]]`);
          }
        } catch (error) {
          report.warnings.push(`create note ${slot.id}: ${String(error).slice(0, 200)}`);
        }
      }
      continue;
    }

    const stamp = note.frontmatter.novahiz_synced_at;
    if (!stamp) {
      // Note créée par une version antérieure, sans horodatage : jamais synchronisée.
      // On la reconstruit depuis le slot (sens sûr, la mémoire n'est jamais écrite).
      report.actions.push(`${apply ? "rebuild" : "would rebuild"}: ${note.rel} ← slot ${slot.id}`);
      if (apply) {
        try {
          const body = slotBody(memory, slot);
          const rendered = renderSlotNote(slot, body, new Date().toISOString(), note);
          writeNote(vault, note.rel, rendered.fm, rendered.body);
        } catch (error) {
          report.warnings.push(`rebuild ${slot.id}: ${String(error).slice(0, 200)}`);
        }
      }
      continue;
    }
    const syncedAt = parseIso(stamp);
    const slotTime = parseIso(slot.updated);
    let noteTime = 0;
    try {
      noteTime = statSync(note.path).mtimeMs;
    } catch {
      report.warnings.push(`note unreadable: ${note.rel}`);
      continue;
    }
    const slotEdited = slotTime > syncedAt + SYNC_TOLERANCE_MS;
    const noteEdited = noteTime > syncedAt + SYNC_TOLERANCE_MS;
    let direction: "pull" | "push" | null = null;
    if (slotEdited && !noteEdited) {
      direction = "pull";
    } else if (noteEdited && !slotEdited) {
      direction = "push";
    } else if (slotEdited && noteEdited) {
      if (slotTime > noteTime + SYNC_TOLERANCE_MS) direction = "pull";
      else if (noteTime > slotTime + SYNC_TOLERANCE_MS) direction = "push";
    }
    if (!direction) continue;

    if (direction === "pull") {
      report.actions.push(`${apply ? "pull" : "would pull"}: slot ${slot.id} → ${note.rel}`);
      if (apply) {
        try {
          const body = slotBody(memory, slot);
          const rendered = renderSlotNote(slot, body, new Date().toISOString(), note);
          writeNote(vault, note.rel, rendered.fm, rendered.body);
        } catch (error) {
          report.warnings.push(`pull ${slot.id}: ${String(error).slice(0, 200)}`);
        }
      }
      continue;
    }

    const parts = splitNoteBody(note.body);
    report.actions.push(`${apply ? "push" : "would push"}: ${note.rel} → slot ${slot.id}`);
    if (apply) {
      try {
        if (parts.summary.length > 0) {
          updateSlot({
            id: slot.id,
            root: memory,
            mode: "summary",
            summary: parts.summary.slice(0, MAX_SUMMARY_CHARS)
          });
        }
        if (parts.details.length > 0) {
          updateSlot({ id: slot.id, root: memory, mode: "replace", content: parts.details });
        }
        if (parts.summary.length === 0 && parts.details.length === 0) {
          report.warnings.push(`push ${slot.id}: note has no content (${note.rel})`);
        } else {
          stampNote(vault, note, { novahiz_synced_at: new Date().toISOString() });
        }
      } catch (error) {
        report.warnings.push(`push ${slot.id}: ${String(error).slice(0, 200)}`);
      }
    }
  }

  for (const note of flagged) {
    report.actions.push(`${apply ? "create slot" : "would create slot"}: ${note.rel} → memory`);
    if (apply) {
      try {
        const title = note.frontmatter.title || basename(note.rel, ".md");
        const parts = splitNoteBody(note.body);
        const created = createSlot(memory, {
          title,
          description: parts.summary || title,
          tags: parseTags(note.frontmatter.tags)
        });
        if (parts.details.length > 0) {
          updateSlot({ id: created.meta.id, root: memory, mode: "replace", content: parts.details });
        }
        stampNote(vault, note, {
          novahiz_slot_id: created.meta.id,
          novahiz_synced_at: new Date().toISOString()
        });
        report.actions.push(`stamped: ${note.rel} → ${created.meta.id}`);
      } catch (error) {
        report.warnings.push(`create slot ${note.rel}: ${String(error).slice(0, 200)}`);
      }
    }
  }

  return report;
}

function secondMemoryInit(parsed: Parsed): void {
  const { created, vault } = initVault();
  emit(parsed, { vault, created }, () => {
    const lines = [`second-memory init: vault at ${vault}`];
    if (created.length === 0) lines.push("  already initialized");
    else for (const item of created) lines.push(`  created: ${item}`);
    return lines.join("\n");
  });
}

function secondMemoryLint(parsed: Parsed): void {
  const issues = lintVault();
  emit(parsed, { issues, count: issues.length }, () => {
    if (issues.length === 0) return "second-memory lint: no issues found";
    const lines = [`second-memory lint: ${issues.length} issue(s)`];
    for (const issue of issues) {
      lines.push(`  [${issue.severity}] ${issue.file || "(vault)"} — ${issue.message}`);
    }
    return lines.join("\n");
  });
}

function secondMemoryFix(parsed: Parsed): void {
  const apply = flagOn(parsed, "apply");
  const report = fixVault(apply);
  emit(parsed, report, () => {
    const head = apply ? "second-memory fix (apply):" : "second-memory fix (dry-run — add --apply to execute):";
    const lines = [head];
    const groups = [report.renamed, report.mocCreated, report.triaged, report.linksRewritten, report.linksRemoved, report.orphansLinked, report.skipped];
    for (const group of groups) for (const line of group) lines.push(`  ${line}`);
    if (groups.every((group) => group.length === 0)) lines.push("  nothing to fix");
    if (report.backedUp.length > 0) lines.push(`  backed up: ${report.backedUp.length} file(s)`);
    lines.push(`  remaining issues: ${report.remaining}`);
    return lines.join("\n");
  });
}

function secondMemorySync(parsed: Parsed): void {
  const apply = flagOn(parsed, "apply");
  const report = syncWithMemory(apply);
  emit(parsed, report, () => {
    const head = apply ? "second-memory sync (apply):" : "second-memory sync (dry-run — add --apply to execute):";
    const lines = [head];
    if (report.memory) lines.push(`  memory: ${report.memory}`);
    for (const action of report.actions) lines.push(`  ${action}`);
    if (report.actions.length === 0 && report.warnings.length === 0) lines.push("  nothing to sync");
    for (const warning of report.warnings) lines.push(`  ! ${warning}`);
    return lines.join("\n");
  });
}

function secondMemoryStatus(parsed: Parsed): void {
  const vault = vaultPath();
  const exists = existsSync(vault);
  const notes = exists ? listVaultNotes(vault) : [];
  const categories = exists ? listCategories(vault) : [];
  const issues = exists ? lintVault() : [];
  const memory = memoryRootForSync() ?? "";
  emit(parsed, { vault, exists, notes: notes.length, categories, issues: issues.length, memory }, () => {
    const lines = ["second-memory status:"];
    lines.push(`  vault: ${vault}`);
    lines.push(`  exists: ${exists}`);
    lines.push(`  notes: ${notes.length}`);
    lines.push(`  categories: ${categories.join(", ") || "(none)"}`);
    lines.push(`  issues: ${issues.length}`);
    lines.push(`  memory: ${memory || "(none)"}`);
    return lines.join("\n");
  });
}

export function secondMemoryCommand(argv: string[], parsed: Parsed): void {
  const sub = argv[0] ?? "status";
  switch (sub) {
    case "init":
      secondMemoryInit(parsed);
      return;
    case "lint":
      secondMemoryLint(parsed);
      return;
    case "fix":
      secondMemoryFix(parsed);
      return;
    case "sync":
      secondMemorySync(parsed);
      return;
    case "status":
      secondMemoryStatus(parsed);
      return;
    default:
      process.stderr.write(`novahiz second-memory: unknown subcommand "${sub}" (init|lint|fix|sync|status)\n`);
      process.exitCode = 1;
  }
}
