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
import { NovahizHome, packageRoot } from "../spec.ts";
import { stitchConfigured } from "./stitch.ts";

const INBOX_DIR = "Inbox";
const ARCHIVE_DIR = "Archive";
const TEMPLATES_DIR = "Templates";
const INDEX_FILE = "INDEX.md";
const LOG_FILE = "log.md";
const MOC_FILE = "_MOC.md";
/** Chemin de lien d'un MOC : sans extension, forme canonique `[[X/_MOC|X MOC]]`. */
const MOC_ID = MOC_FILE.slice(0, -3);
const BACKUP_DIR = ".backup";
// Deux écritures plus rapprochées que ça comptent comme synchronisées :
// la mtime fraîche d'une note qu'on vient d'écrire ne doit pas repartir en push.
const SYNC_TOLERANCE_MS = 1500;

// --- Arborescence canonique -------------------------------------------------
// L'arborescence du vault est FIXE : elle est gravée dans le skill
// novahiz-second-memory et, côté machine, dans catalog/vault-structure.json
// (source de vérité partagée). Une écriture n'invente jamais de chemin : elle
// active le domaine concerné, qui recrée toute son arborescence — dossiers,
// _MOC.md à chaque niveau, lien parent puis lien INDEX.
type StructNode = {
  id?: string;
  name: string;
  title?: string;
  kind: "domain" | "branch" | "memory" | "docs" | "journal" | "decisions" | "notes";
  keywords?: string[];
  children?: StructNode[];
};

type VaultStructure = {
  version: number;
  index: string;
  log: string;
  structureFile: string;
  moc: string;
  indexSection: string;
  systemFolders: string[];
  systemFiles: string[];
  defaultProject: string;
  domains: StructNode[];
  docsKeywords: string[];
  journalKeywords: string[];
  decisionsKeywords: string[];
  plugins: Array<{ id: string; repo: string; required?: boolean }>;
};

/** Un niveau du chemin canonique : dossier à créer + titre de son MOC. */
type Segment = { rel: string; title: string };

let structureCache: VaultStructure | null = null;

function structureFilePath(): string | null {
  const candidates = [join(NovahizHome(), "catalog", "vault-structure.json")];
  const pkg = packageRoot();
  if (pkg) candidates.push(join(pkg, "catalog", "vault-structure.json"));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function loadStructure(): VaultStructure {
  if (structureCache) return structureCache;
  const file = structureFilePath();
  if (!file) {
    throw new Error("catalog/vault-structure.json not found — run `novahiz setup` from the Novahiz home");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`catalog/vault-structure.json unreadable: ${(error as Error).message}`);
  }
  const raw = parsed as Partial<VaultStructure>;
  if (!raw || !Array.isArray(raw.domains) || raw.domains.length === 0) {
    throw new Error("catalog/vault-structure.json: `domains` must be a non-empty array");
  }
  if (!Array.isArray(raw.plugins)) throw new Error("catalog/vault-structure.json: `plugins` must be an array");
  // Le catalogue est la source de vérité : s'il diverge des constantes du code,
  // on échoue fort plutôt que d'écrire une moitié de structure.
  if ((raw.index ?? INDEX_FILE) !== INDEX_FILE) throw new Error(`catalog/vault-structure.json: index must be "${INDEX_FILE}"`);
  if ((raw.log ?? LOG_FILE) !== LOG_FILE) throw new Error(`catalog/vault-structure.json: log must be "${LOG_FILE}"`);
  if ((raw.moc ?? MOC_FILE) !== MOC_FILE) throw new Error(`catalog/vault-structure.json: moc must be "${MOC_FILE}"`);
  structureCache = {
    version: raw.version ?? 1,
    index: INDEX_FILE,
    log: LOG_FILE,
    structureFile: raw.structureFile || "STRUCTURE.md",
    moc: MOC_FILE,
    indexSection: raw.indexSection || "Categories",
    systemFolders: Array.isArray(raw.systemFolders) && raw.systemFolders.length > 0 ? raw.systemFolders : [INBOX_DIR, ARCHIVE_DIR, TEMPLATES_DIR],
    systemFiles: Array.isArray(raw.systemFiles) && raw.systemFiles.length > 0 ? raw.systemFiles : [INDEX_FILE, LOG_FILE],
    defaultProject: raw.defaultProject || "general",
    domains: raw.domains,
    docsKeywords: Array.isArray(raw.docsKeywords) ? raw.docsKeywords : [],
    journalKeywords: Array.isArray(raw.journalKeywords) ? raw.journalKeywords : [],
    decisionsKeywords: Array.isArray(raw.decisionsKeywords) ? raw.decisionsKeywords : [],
    plugins: raw.plugins
  };
  return structureCache;
}

function nodeTitle(node: StructNode): string {
  return node.title ?? node.name;
}

/** Mot-clé déjà normalisé → vrai match sur frontière de mot (les mots courts
 *  comme "ci", "ui", "app" ne doivent pas croiser à l'intérieur d'un mot). */
function keywordHit(lowerText: string, keyword: string): boolean {
  const kw = keyword.toLowerCase().trim();
  if (kw.length === 0) return false;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(lowerText);
}

/** Plus de hits gagne, pas le premier trouvé : sans ça "api" (Code) écrasait
 *  "owasp"+"sécurité" (Security) sur le seul ordre du catalogue. À égalité,
 *  l'ordre du catalogue tranche. Aucun hit → premier nœud, matched:false
 *  (repli sur la première branche, premier domaine). */
export function matchNode(nodes: StructNode[], lowerText: string): { node: StructNode | null; matched: boolean; score: number } {
  let best: StructNode | null = null;
  let bestScore = 0;
  for (const node of nodes) {
    let score = 0;
    for (const keyword of node.keywords ?? []) {
      if (keywordHit(lowerText, keyword)) score += 1;
    }
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  if (best) return { node: best, matched: true, score: bestScore };
  return { node: nodes[0] ?? null, matched: false, score: 0 };
}

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
  /** nom de dossier (minuscules) → rel du `_MOC.md` qu'il contient. */
  mocByFolder: Map<string, string>;
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

export function isCategoryDir(name: string): boolean {
  if (name.startsWith(".")) return false;
  // Les dossiers système viennent du catalogue, pas d'une liste codée en dur :
  // un dossier système déclaré plus tard (ex. Excalidraw) doit être exclu lui aussi.
  let system: string[];
  try {
    system = loadStructure().systemFolders;
  } catch {
    system = [INBOX_DIR, ARCHIVE_DIR, TEMPLATES_DIR];
  }
  return !system.includes(name);
}

function isSystemFile(rel: string): boolean {
  const name = basename(rel);
  if (name === INDEX_FILE || name === LOG_FILE || name === "README.md") return true;
  try {
    return name === loadStructure().structureFile;
  } catch {
    return name === "STRUCTURE.md";
  }
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
  // Tous les `_MOC.md` partagent le même basename : sans index par dossier,
  // le raccourci `[[Mobile MOC]]` se résoudrait sur le premier venu.
  const mocByFolder = new Map<string, string>();
  for (const rel of notes) {
    const key = basename(rel).toLowerCase();
    if (!byBaseName.has(key)) byBaseName.set(key, rel);
    if (key === MOC_FILE) {
      const folder = normalizeRel(dirname(rel));
      const full = folder === "." ? "" : folder;
      if (full.length > 0) mocByFolder.set(full.toLowerCase(), rel);
      // Le raccourci `[[Mobile MOC]]` porte un nom de dossier sans son chemin :
      // on indexe aussi la dernière segment, première écriture gagne.
      const leaf = full.includes("/") ? full.slice(full.lastIndexOf("/") + 1) : full;
      if (leaf.length > 0 && !mocByFolder.has(leaf.toLowerCase())) mocByFolder.set(leaf.toLowerCase(), rel);
    }
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
  return { notes, byBaseName, mocByFolder, folders };
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
    const byFolder = vi.mocByFolder.get(moc[1].toLowerCase().replace(/\\/g, "/"));
    if (byFolder) return { kind: "note", rel: byFolder };
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
  if (moc && resolved.rel.endsWith(`/${MOC_FILE}`)) {
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

/** MOC d'un dossier : titre, sections de navigation, lien vers le parent.
 *  Les sous-dossiers et les notes sont ajoutés par addLinkToSection au fil
 *  de l'eau — un lien n'est écrit que lorsque sa cible existe (sinon lint
 *  le signalerait comme lien mort). */
function mocTemplate(title: string, parent: { rel: string; title: string } | null): string {
  const related = ["[[INDEX|Home]]"];
  if (parent) related.push(`[[${parent.rel}/${MOC_ID}|${parent.title} MOC]]`);
  return `---
type: moc
title: ${title} MOC
---

# ${title} MOC

## Subcategories

## Notes

## Related MOCs
${related.map((link) => `- ${link}`).join("\n")}
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
 * pour ne jamais dupliquer un lien. `position` = "first" place en tête de
 * section (les plus récents d'abord), "last" en fin de section (ordre de
 * création, donc l'ordre du catalogue).
 */
function addLinkToSection(
  vault: string,
  rel: string,
  section: string,
  linkText: string,
  aliases: string[] = [],
  position: "first" | "last" = "first"
): boolean {
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
  let insertAt = headerIndex + 1;
  if (position === "last") {
    while (insertAt < lines.length && lines[insertAt].trim() !== "" && !lines[insertAt].startsWith("##")) insertAt += 1;
  }
  lines.splice(insertAt, 0, `- ${linkText}`);
  writeFileSync(abs, lines.join("\n"), "utf8");
  return true;
}

/** Dossier + `_MOC.md` + lien dans le MOC parent (ou dans INDEX pour un domaine).
 *  Idempotent : un dossier déjà en place n'est pas recréé, mais son lien manquant
 *  vers le parent est ajouté (addLinkToSection ne duplique jamais). */
function ensureFolder(vault: string, rel: string, title: string, parent: { rel: string; title: string } | null): void {
  ensureDir(join(vault, rel));
  const mocRel = `${rel}/${MOC_FILE}`;
  if (!existsSync(join(vault, mocRel))) {
    writeFileSync(join(vault, mocRel), mocTemplate(title, parent), "utf8");
  }
  const link = `[[${rel}/${MOC_ID}|${title} MOC]]`;
  const aliases = [`${title} MOC`];
  if (parent) {
    const parentMoc = `${parent.rel}/${MOC_FILE}`;
    if (existsSync(join(vault, parentMoc))) {
      addLinkToSection(vault, parentMoc, "## Subcategories", link, aliases, "last");
    }
    return;
  }
  if (existsSync(join(vault, INDEX_FILE))) {
    addLinkToSection(vault, INDEX_FILE, `## ${loadStructure().indexSection}`, link, aliases, "last");
  }
}

/** Recrée un nœud du catalogue et toute sa descendance, en reliant chaque
 *  niveau à son parent. Retourne le chemin du nœud. */
function ensureNodeTree(vault: string, node: StructNode, parent: { rel: string; title: string } | null): string {
  const rel = parent ? `${parent.rel}/${node.name}` : node.name;
  ensureFolder(vault, rel, nodeTitle(node), parent);
  const self = { rel, title: nodeTitle(node) };
  for (const child of node.children ?? []) ensureNodeTree(vault, child, self);
  return rel;
}

function findDomain(name: string): StructNode | null {
  return loadStructure().domains.find((domain) => domain.name === name) ?? null;
}

/** Activation d'un domaine : son arborescence COMPLÈTE (toutes ses branches,
 *  leurs memory/ et docs/) apparaît d'un coup, reliée jusqu'à INDEX. */
function activateDomain(vault: string, domain: StructNode): void {
  ensureNodeTree(vault, domain, null);
}

function projectFolder(name: string | undefined, fallback: string): string {
  const raw = (name ?? "").trim();
  if (raw.length === 0) return fallback;
  const slug = raw.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return slug.length > 0 ? slug : fallback;
}

function hasKeyword(lowerText: string, keywords: string[]): boolean {
  for (const keyword of keywords) {
    if (keywordHit(lowerText, keyword)) return true;
  }
  return false;
}

/** Sidecar projet → branche, écrit par `second-memory project-init` :
 *  `<slug>` → { domain, branch }, dans le racine mémoire (registre machine).
 *  Une note qui porte un projet lié atterrit dans SA branche même sans mot-clé
 *  de domaine : toutes les données d'un projet restent ensemble (prompt 2).
 *  Absent, illisible ou périmé (domaine/branche hors catalogue) → repli sur le
 *  routage par mots-clés, strictement inchangé. */
function readBinding(slug: string): { domain: string; branch: string } | null {
  const root = memoryRootForSync();
  if (!root) return null;
  const file = join(root, "vault.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const entry = parsed[slug];
    if (!entry || typeof entry !== "object") return null;
    const { domain, branch } = entry as { domain?: unknown; branch?: unknown };
    if (typeof domain !== "string" || typeof branch !== "string") return null;
    if (domain.length === 0 || branch.length === 0) return null;
    return { domain, branch };
  } catch {
    return null;
  }
}

/**
 * Chemin canonique d'une note, dérivé du catalogue — aucun chemin inventé :
 * domaine → branche → memory|docs|journal|decisions → projet. Un projet lié par
 * `project-init` l'emporte sur les mots-clés : ses notes restent dans sa branche.
 * Sans signal de domaine, le tableau est vide et la note part dans Inbox pour
 * triage (comportement historique).
 */
export function routePath(text: string, kind: "memory" | "docs" | "journal" | "decisions" | "auto", projectName?: string): Segment[] {
  const structure = loadStructure();
  const lower = ` ${text.toLowerCase()} `;
  let domain: StructNode | null = null;
  let branchHint: StructNode | null = null;
  const slug = projectName === undefined ? null : projectFolder(projectName, structure.defaultProject);
  const binding = slug ? readBinding(slug) : null;
  if (binding) {
    const boundDomain = findDomain(binding.domain);
    const boundBranch = boundDomain?.children?.find((node) => node.name === binding.branch) ?? null;
    if (boundDomain && boundBranch) {
      domain = boundDomain;
      branchHint = boundBranch;
    }
  }
  if (!domain) {
    const domainMatch = matchNode(structure.domains, lower);
    if (domainMatch.matched) domain = domainMatch.node;
  }
  if (!domain) {
    // 2e passe : un mot-clé de BRANCHE route aussi vers son domaine, sinon
    // "flutter" n'atterrirait nulle part alors que Code/Mobile le porte.
    // Le domaine le mieux classé gagne, pas le premier de la liste.
    let best = 0;
    for (const candidate of structure.domains) {
      const hit = matchNode(candidate.children ?? [], lower);
      if (hit.matched && hit.node && hit.score > best) {
        domain = candidate;
        branchHint = hit.node;
        best = hit.score;
      }
    }
  }
  if (!domain) return [];
  const segments: Segment[] = [{ rel: domain.name, title: nodeTitle(domain) }];
  const branches = domain.children ?? [];
  if (branches.length === 0) return segments;
  const branch = branchHint ?? matchNode(branches, lower).node ?? branches[0];
  const branchRel = `${domain.name}/${branch.name}`;
  segments.push({ rel: branchRel, title: nodeTitle(branch) });
  const leaves = branch.children ?? [];
  if (leaves.length === 0) return segments;
  const wanted = kind === "auto"
    ? (hasKeyword(lower, structure.decisionsKeywords) ? "decisions"
      : hasKeyword(lower, structure.journalKeywords) ? "journal"
      : hasKeyword(lower, structure.docsKeywords) ? "docs" : "memory")
    : kind;
  const leaf = leaves.find((node) => node.kind === wanted) ?? leaves[0];
  const leafRel = `${branchRel}/${leaf.name}`;
  segments.push({ rel: leafRel, title: nodeTitle(leaf) });
  if (leaf.kind === "memory" || leaf.kind === "docs" || leaf.kind === "journal" || leaf.kind === "decisions") {
    const project = projectFolder(projectName, structure.defaultProject);
    const title = project.charAt(0).toUpperCase() + project.slice(1);
    segments.push({ rel: `${leafRel}/${project}`, title });
  }
  return segments;
}

/** Active le domaine complet, crée les niveaux manquants, retourne le dossier cible. */
function ensureTarget(vault: string, segments: Segment[]): string {
  if (segments.length === 0) return INBOX_DIR;
  const domain = findDomain(segments[0].rel);
  if (domain) activateDomain(vault, domain);
  let parent: { rel: string; title: string } | null = null;
  for (const segment of segments) {
    ensureFolder(vault, segment.rel, segment.title, parent);
    parent = { rel: segment.rel, title: segment.title };
  }
  return segments[segments.length - 1].rel;
}

/** Dossier + MOC + entrée INDEX : domaine du catalogue activé intégralement,
 *  dossier hors catalogue en repli émergent (vaults antérieurs au catalogue). */
function ensureCategory(vault: string, cat: string): void {
  if (cat === INBOX_DIR) return;
  const domain = findDomain(cat);
  if (domain) {
    activateDomain(vault, domain);
    return;
  }
  ensureFolder(vault, cat, cat, null);
}

function backupFile(vault: string, rel: string, backedUp: string[]): void {
  const backupDir = join(vault, ARCHIVE_DIR, BACKUP_DIR);
  ensureDir(backupDir);
  const flat = `${rel.replace(/[\\/]/g, "__")}.bak`;
  copyFileSync(join(vault, rel), join(backupDir, flat));
  backedUp.push(rel);
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

// --- .obsidian : arbre documenté + plugins obligatoires ----------------------
const OBSIDIAN_DIR = ".obsidian";
const PLUGIN_ASSETS = ["manifest.json", "main.js", "styles.css"];
const PLUGIN_TIMEOUT_MS = 20000;

type PluginReport = {
  installed: string[];
  enabled: string[];
  present: string[];
  failed: Array<{ id: string; reason: string }>;
};

/** Arbre ASCII du vault, tel que gravé dans le catalogue (STRUCTURE.md). */
function renderStructureTree(): string {
  const structure = loadStructure();
  const roots: StructNode[] = [
    ...structure.systemFolders.map((name) => ({ name, kind: "branch" as const })),
    ...structure.domains
  ];
  const lines: string[] = [];
  const walk = (nodes: StructNode[], prefix: string): void => {
    nodes.forEach((node, index) => {
      const last = index === nodes.length - 1;
      const children = node.children ?? [];
      lines.push(`${prefix}${last ? "└── " : "├── "}${node.name}${children.length > 0 ? "/" : ""}`);
      if (children.length > 0) walk(children, `${prefix}${last ? "    " : "│   "}`);
    });
  };
  walk(roots, "");
  return lines.join("\n");
}

/** STRUCTURE.md : la carte lisible au premier ouverture du vault.
 *  Aucun wikilink dedans — lint vérifierait leurs cibles, et les domaines
 *  inactifs n'ont pas encore de MOC.
 *  Exportée : doctor --apply régénère le fichier quand son contenu dérive,
 *  et les tests écrivent le canonique plutôt qu'un stub. */
export function structureMarkdown(): string {
  const structure = loadStructure();
  const domainLines = structure.domains
    .map((domain) => {
      const branches = (domain.children ?? [])
        .map((child) => {
          const leaves = (child.children ?? []).map((leaf) => leaf.name);
          return `  - ${child.name}/ → ${leaves.length > 0 ? leaves.join(", ") : "notes"}`;
        })
        .join("\n");
      return branches.length > 0 ? `- ${nodeTitle(domain)}/\n${branches}` : `- ${nodeTitle(domain)}/`;
    })
    .join("\n");
  const fence = "```";
  return [
    "---",
    "type: doc",
    "title: Vault structure",
    `created: ${todayIso()}`,
    `updated: ${todayIso()}`,
    "---",
    "",
    "# Vault structure",
    "",
    "This tree is fixed. It comes from `catalog/vault-structure.json` in the Novahiz home",
    "and is embedded in the `novahiz-second-memory` skill. Nothing is ever written outside it.",
    "",
    "## Rules",
    "",
    "1. `INDEX.md` is the single entry point: every active domain links from `## Categories`.",
    "2. Every folder owns a `_MOC.md` linking its children; children link back under `## Related MOCs`.",
    "3. Routing: `<Domain>/<Branch>/memory|docs/<project>/<note>.md`.",
    "4. A domain appears whole the first time content routes to it.",
    "5. Notes with no domain signal wait in `Inbox/` for triage.",
    "6. `second-memory doctor` audits this tree; `--apply` repairs it.",
    "",
    "## Tree",
    "",
    `${fence}text`,
    renderStructureTree(),
    `${fence}`,
    "",
    "## Domains",
    "",
    domainLines,
    ""
  ].join("\n");
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(PLUGIN_TIMEOUT_MS) });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function readEnabledPlugins(vault: string): string[] {
  const file = join(vault, OBSIDIAN_DIR, "community-plugins.json");
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function writeEnabledPlugins(vault: string, ids: string[]): void {
  const file = join(vault, OBSIDIAN_DIR, "community-plugins.json");
  ensureDir(dirname(file));
  writeFileSync(file, `${JSON.stringify(ids, null, 2)}\n`, "utf8");
}

/**
 * Installe les plugins obligatoires depuis les releases GitHub officielles
 * (`releases/latest/download/…`, le même mécanisme qu'Obsidian) et les active
 * dans `community-plugins.json`. Hors ligne : échec signalé, jamais fatal.
 * Le mode restreint d'Obsidian reste à désactiver une fois dans les réglages.
 */
async function installPlugins(vault: string): Promise<PluginReport> {
  const structure = loadStructure();
  const report: PluginReport = { installed: [], enabled: [], present: [], failed: [] };
  const pluginsDir = join(vault, OBSIDIAN_DIR, "plugins");
  ensureDir(pluginsDir);
  for (const plugin of structure.plugins) {
    const dir = join(pluginsDir, plugin.id);
    const manifestPath = join(dir, "manifest.json");
    const mainPath = join(dir, "main.js");
    if (existsSync(manifestPath) && existsSync(mainPath)) {
      report.present.push(plugin.id);
      continue;
    }
    ensureDir(dir);
    const base = `https://github.com/${plugin.repo}/releases/latest/download`;
    let failure = "";
    for (const asset of PLUGIN_ASSETS) {
      const text = await fetchText(`${base}/${asset}`);
      if (text === null) {
        if (asset === "styles.css") break; // asset optionnel selon les dépôts
        failure = `${asset} — offline or no release on ${plugin.repo}`;
        break;
      }
      if (asset === "manifest.json") {
        try {
          JSON.parse(text);
        } catch {
          failure = `manifest.json — invalid JSON from ${plugin.repo}`;
          break;
        }
      }
      writeFileSync(join(dir, asset), text, "utf8");
    }
    if (failure.length > 0) {
      report.failed.push({ id: plugin.id, reason: failure });
      continue;
    }
    report.installed.push(plugin.id);
  }

  const enabled = readEnabledPlugins(vault);
  const enabledSet = new Set(enabled);
  const onDisk = [...report.present, ...report.installed].filter((id) => !enabledSet.has(id));
  if (onDisk.length > 0) {
    writeEnabledPlugins(vault, [...enabled, ...onDisk]);
    report.enabled = onDisk;
  }
  return report;
}

/** Rendu commun du rapport de plugins (init et doctor partagent le format). */
function pluginReportLines(report: PluginReport): string[] {
  const lines: string[] = [];
  if (report.installed.length > 0) lines.push(`  plugins installed: ${report.installed.join(", ")}`);
  if (report.enabled.length > 0) lines.push(`  plugins enabled: ${report.enabled.join(", ")}`);
  if (report.present.length > 0) lines.push(`  plugins already present: ${report.present.join(", ")}`);
  for (const failure of report.failed) lines.push(`  ! plugin ${failure.id}: ${failure.reason}`);
  return lines;
}

async function initVault(options: { plugins: boolean }): Promise<{ created: string[]; vault: string; plugins: PluginReport | null }> {
  const structure = loadStructure();
  const vault = vaultPath();
  const created: string[] = [];
  const dirs = [vault, ...structure.systemFolders.map((name) => join(vault, name))];
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

## ${structure.indexSection}
<!-- Active domains appear here as they activate. Each links to its ${MOC_ID}. -->

## System
${structure.systemFolders.map((name) => `- [[${name}]]`).join("\n")}
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
- [[Category/_MOC|Category MOC]]
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
- [[Category/_MOC|Category MOC]]
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
- [[Category/_MOC|Category MOC]]
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
- [[Category/_MOC|Category MOC]]
`
  };
  for (const [name, content] of Object.entries(templates)) {
    const tplPath = join(vault, TEMPLATES_DIR, name);
    if (!existsSync(tplPath)) {
      writeFileSync(tplPath, content);
      created.push(tplPath);
    }
  }

  // La carte du vault : l'arborescence fixe, lisible au premier ouverture.
  const structurePath = join(vault, structure.structureFile);
  if (!existsSync(structurePath)) {
    writeFileSync(structurePath, structureMarkdown(), "utf8");
    created.push(structurePath);
  }

  // Les domaines restent inactifs jusqu'à leur premier contenu — init ne crée
  // que le squelette système. Les plugins, eux, arrivent tout de suite.
  const plugins = options.plugins ? await installPlugins(vault) : null;
  return { created, vault, plugins };
}

/** Remplace les liens [[...]] pointant sur l'ancien nom d'un fichier renommé.
 *  Sans ça, les MOC et notes gardent un lien périmé (cassé sur un FS
 *  sensible à la casse, simple doublon sur Windows). */
export function updateLinksAfterRename(vault: string, oldRel: string, newRel: string): string[] {
  const oldBase = basename(oldRel).replace(/\.md$/, "");
  const newBase = basename(newRel).replace(/\.md$/, "");
  if (oldBase === newBase) return [];
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(\\[\\[[^\\]]*?)${escape(oldBase)}(?=[#\\]|])`, "g");
  const updated: string[] = [];
  for (const note of listVaultNotes(vault)) {
    const file = join(vault, note);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    const next = text.replace(pattern, `$1${newBase}`);
    if (next !== text) {
      writeFileSync(file, next, "utf8");
      updated.push(note);
    }
  }
  return updated;
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
    // Un renommage qui ne change que la casse : sur un FS insensible à la casse
    // (Windows), existsSync voit la cible comme existante alors que c'est le
    // même fichier — faux positif, on saute le test pour laisser le rename agir.
    const caseOnly = rel.toLowerCase() === targetRel.toLowerCase();
    if (!caseOnly && existsSync(join(vault, targetRel))) {
      report.skipped.push(`rename ${rel} → ${targetRel}: target exists`);
      continue;
    }
    if (apply) {
      backupFile(vault, rel, report.backedUp);
      renameSync(join(vault, rel), join(vault, targetRel));
      for (const note of updateLinksAfterRename(vault, rel, targetRel)) {
        report.linksRewritten.push(`relinked after rename: ${note}`);
      }
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
    const segments = routePath(signal, "auto", note?.frontmatter.project);
    let targetDir: string;
    if (segments.length > 0) {
      targetDir = segments[segments.length - 1].rel;
    } else {
      const cat = soleCategory(vault);
      if (!cat) {
        report.skipped.push(`kept in Inbox: ${rel} (no category signal)`);
        continue;
      }
      targetDir = cat;
    }
    const targetRel = `${targetDir}/${basename(rel)}`;
    if (existsSync(join(vault, targetRel))) {
      report.skipped.push(`triage ${rel} → ${targetRel}: target exists`);
      continue;
    }
    if (apply) {
      if (segments.length > 0) ensureTarget(vault, segments);
      else ensureCategory(vault, targetDir);
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
    // Le MOC cible est le plus proche possible : le _MOC du dossier de la note,
    // sinon celui du domaine, sinon INDEX.
    const folder = normalizeRel(dirname(rel));
    let mocRel = INDEX_FILE;
    if (folder && folder !== ".") {
      const nearest = `${folder}/${MOC_FILE}`;
      const top = folder.includes("/") ? folder.slice(0, folder.indexOf("/")) : folder;
      const topMoc = `${top}/${MOC_FILE}`;
      if (existsSync(join(vault, nearest))) mocRel = nearest;
      else if (isCategoryDir(top) && existsSync(join(vault, topMoc))) mocRel = topMoc;
    }
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
      const tagged = (slot.tags ?? []).map((tag) => tag.trim()).find((tag) => tag.toLowerCase().startsWith("project:"));
      const segments = routePath(signal, "memory", tagged ? tagged.slice("project:".length).trim() : undefined);
      const dir = segments.length > 0 ? segments[segments.length - 1].rel : INBOX_DIR;
      const rel = `${dir}/${slot.id}-${slugify(slot.title)}.md`;
      report.actions.push(`${apply ? "create note" : "would create note"}: ${rel} ← slot ${slot.id}`);
      if (apply) {
        try {
          const body = slotBody(memory, slot);
          const target = ensureTarget(vault, segments);
          const rendered = renderSlotNote(slot, body, new Date().toISOString(), null);
          writeNote(vault, `${target}/${basename(rel)}`, rendered.fm, rendered.body);
          const mocRel = `${target}/${MOC_FILE}`;
          if (existsSync(join(vault, mocRel))) {
            addLinkToSection(vault, mocRel, "## Notes", `[[${target}/${basename(rel, ".md")}]]`);
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

async function secondMemoryInit(parsed: Parsed): Promise<void> {
  const wanted = !flagOn(parsed, "no-plugins") && !flagOn(parsed, "skip-plugins");
  const { created, vault, plugins } = await initVault({ plugins: wanted });
  emit(parsed, { vault, created, plugins }, () => {
    const lines = [`second-memory init: vault at ${vault}`];
    if (created.length === 0) lines.push("  already initialized");
    else for (const item of created) lines.push(`  created: ${item}`);
    if (plugins) lines.push(...pluginReportLines(plugins));
    if (wanted && plugins && plugins.enabled.length > 0) {
      lines.push("  ! restricted mode: open Obsidian once and disable Settings → Community plugins → restricted mode.");
    }
    // T5: onboarding Stitch — recommande uniquement quand la cle manque
    // reellement (sinon le message pollue chaque init).
    if (!stitchConfigured()) {
      lines.push("  Google Stitch MCP not configured — run `novahiz stitch` and paste your API key to enable Stitch screens.");
    }
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

// --- doctor -----------------------------------------------------------------

type DoctorCheck = { name: string; status: "ok" | "warn" | "fail"; detail: string };

type DoctorReport = {
  vault: string;
  exists: boolean;
  apply: boolean;
  checks: DoctorCheck[];
  actions: string[];
  warnings: string[];
  issues: Array<{ severity: string; file: string; message: string }>;
  backedUp: string[];
  plugins: PluginReport | null;
  remaining: number;
};

type StructureAudit = {
  missing: string[];
  rootNotes: string[];
  unknownFolders: string[];
  foldersWithoutMoc: string[];
  unlinked: Array<{ rel: string; parent: string }>;
  partialDomains: string[];
  indexDrift: string[];
  /** STRUCTURE.md existe mais son contenu ne correspond plus au catalogue. */
  structureDrift: boolean;
};

/** Liens que `INDEX → ## Categories` doit porter : un par domaine actif. */
function desiredIndexLinks(structure: VaultStructure, vault: string): string[] {
  return structure.domains
    .filter((domain) => existsSync(join(vault, domain.name)))
    .map((domain) => `[[${domain.name}/${MOC_ID}|${nodeTitle(domain)} MOC]]`);
}

function currentIndexLinks(vault: string, section: string): string[] {
  const file = join(vault, INDEX_FILE);
  if (!existsSync(file)) return [];
  const out: string[] = [];
  let inSection = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("## ")) {
      inSection = line.trim() === section;
      continue;
    }
    if (inSection && /^\s*-\s*\[\[/.test(line)) out.push(line.trim().replace(/^- /, ""));
  }
  return out;
}

/** Réécrit la section `## Categories` de l'INDEX : exactement les domaines actifs,
 *  dans l'ordre du catalogue. Seule section machine du fichier. */
export function rewriteIndexCategories(vault: string, section: string, links: string[]): void {
  const file = join(vault, INDEX_FILE);
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split("\n");
  const marker = `<!-- Active domains appear here as they activate. Each links to its ${MOC_ID}. -->`;
  const start = lines.findIndex((line) => line.trim() === section);
  if (start === -1) {
    // Section absente (INDEX écrit à la main ou ancienne version) : on la crée
    // avant « ## System » si possible, sinon à la fin — sinon `--apply` ne
    // pourrait jamais converger (dérive d'INDEX non réparable).
    const at = lines.findIndex((line) => line.trim() === "## System");
    lines.splice(at === -1 ? lines.length : at, 0, section, marker, ...links.map((link) => `- ${link}`), "");
    writeFileSync(file, lines.join("\n"), "utf8");
    return;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end += 1;
  const head = lines.slice(0, start + 1);
  const tail = lines.slice(end);
  const next = [...head, marker, ...links.map((link) => `- ${link}`), "", ...tail];
  writeFileSync(file, next.join("\n"), "utf8");
}

/** Dossiers attendus d'un domaine (les dossiers projet sont créés à la demande). */
function expectedDomainFolders(domain: StructNode): string[] {
  const out: string[] = [];
  const walk = (node: StructNode, parent: string): void => {
    const rel = parent ? `${parent}/${node.name}` : node.name;
    out.push(rel);
    for (const child of node.children ?? []) walk(child, rel);
  };
  walk(domain, "");
  return out;
}

/** Titre d'un dossier : celui du nœud du catalogue s'il y en a un, sinon le nom. */
function nodeTitleAt(rel: string): string {
  const parts = rel.split("/");
  let nodes = loadStructure().domains;
  let matched = false;
  let title = parts[parts.length - 1];
  for (const part of parts) {
    const found = nodes.find((node) => node.name === part);
    if (!found) {
      // Dossier hors catalogue (projet ou dossier legacy) : titre = son nom.
      matched = false;
      break;
    }
    title = nodeTitle(found);
    nodes = found.children ?? [];
    matched = true;
  }
  return matched ? title : parts[parts.length - 1];
}

/** Dossiers du vault avec leur casse d'origine — `VaultIndex.folders` est en
 *  minuscules (usage : résolution de liens) et ne convient pas à l'audit. */
function listVaultFolders(vault: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, base: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const rel = base ? `${base}/${entry.name}` : entry.name;
      out.push(rel);
      walk(join(dir, entry.name), rel);
    }
  };
  walk(vault, "");
  return out;
}

/** `hasLink` compare à la lettre ; Obsidian, lui, ignore la casse. */
function hasLinkI(text: string, target: string): boolean {
  const lower = text.toLowerCase();
  const key = target.toLowerCase();
  return lower.includes(`[[${key}]]`) || lower.includes(`[[${key}|`);
}

export function auditStructure(vault: string): StructureAudit {
  const structure = loadStructure();
  const index = buildVaultIndex(vault);
  const systemTop = new Set(structure.systemFolders);
  const domainNames = new Set(structure.domains.map((domain) => domain.name));
  const audit: StructureAudit = { missing: [], rootNotes: [], unknownFolders: [], foldersWithoutMoc: [], unlinked: [], partialDomains: [], indexDrift: [], structureDrift: false };

  for (const name of structure.systemFolders) if (!existsSync(join(vault, name))) audit.missing.push(name);
  if (!existsSync(join(vault, INDEX_FILE))) audit.missing.push(INDEX_FILE);
  if (!existsSync(join(vault, structure.structureFile))) audit.missing.push(structure.structureFile);
  else {
    // STRUCTURE.md présent mais périmé : le gravé ne suit plus le catalogue
    // (domaines ajoutés, règles relues). Les dates du frontmatter sont
    // neutralisées — sinon tout serait en dérive dès le lendemain.
    const stripDates = (text: string): string => text.replace(/^(created|updated):.*$/gm, "$1:");
    const current = readFileSync(join(vault, structure.structureFile), "utf8");
    audit.structureDrift = stripDates(current) !== stripDates(structureMarkdown());
  }
  // log.md manquait de `missing` : doctor donnait exit 0 sur un vault dont il
  // avait disparu, alors que init le recrée. Le test « systemFiles ⊆ fichiers
  // créés par init » verrouille le catalogue : si un jour un fichier déclaré
  // n'est plus créé, c'est ce test qui crie, pas un vault en production.
  if (!existsSync(join(vault, LOG_FILE))) audit.missing.push(LOG_FILE);

  for (const cat of listCategories(vault)) {
    if (!domainNames.has(cat) && !systemTop.has(cat)) audit.unknownFolders.push(cat);
  }

  for (const note of index.notes) {
    if (!note.includes("/") && !isSystemFile(note)) audit.rootNotes.push(note);
  }

  for (const folder of listVaultFolders(vault)) {
    const top = folder.includes("/") ? folder.slice(0, folder.indexOf("/")) : folder;
    if (systemTop.has(top)) continue; // Inbox/Archive/Templates restent hors graphe
    if (!existsSync(join(vault, folder, MOC_FILE))) {
      audit.foldersWithoutMoc.push(folder);
      continue;
    }
    const parentRel = normalizeRel(dirname(folder));
    if (parentRel === "." || parentRel === "") continue; // niveau racine : INDEX réconcilié à part
    const parentText = existsSync(join(vault, parentRel, MOC_FILE)) ? readFileSync(join(vault, parentRel, MOC_FILE), "utf8") : "";
    if (parentText.length > 0 && !hasLinkI(parentText, `${folder}/${MOC_ID}`)) {
      audit.unlinked.push({ rel: folder, parent: parentRel });
    }
  }

  // L'INDEX doit relier exactement les domaines actifs — plus, jamais moins.
  const desired = desiredIndexLinks(structure, vault);
  const current = currentIndexLinks(vault, `## ${structure.indexSection}`);
  const desiredKeys = new Set(desired.map((link) => link.toLowerCase()));
  const currentKeys = new Set(current.map((link) => link.toLowerCase()));
  for (const link of desired) if (!currentKeys.has(link.toLowerCase())) audit.indexDrift.push(`INDEX missing ${link}`);
  for (const link of current) if (!desiredKeys.has(link.toLowerCase())) audit.indexDrift.push(`INDEX stray ${link}`);

  for (const domain of structure.domains) {
    if (!existsSync(join(vault, domain.name))) continue;
    const gaps = expectedDomainFolders(domain).filter((rel) => !existsSync(join(vault, rel)));
    if (gaps.length > 0) audit.partialDomains.push(`${domain.name} (${gaps.length} folder(s) missing)`);
  }
  return audit;
}

function pluginPresence(): { missing: string[]; disabled: string[] } {
  const structure = loadStructure();
  const vault = vaultPath();
  const enabled = new Set(readEnabledPlugins(vault));
  const missing: string[] = [];
  const disabled: string[] = [];
  for (const plugin of structure.plugins) {
    const dir = join(vault, OBSIDIAN_DIR, "plugins", plugin.id);
    if (!existsSync(join(dir, "manifest.json")) || !existsSync(join(dir, "main.js"))) missing.push(plugin.id);
    else if (!enabled.has(plugin.id)) disabled.push(plugin.id);
  }
  return { missing, disabled };
}

/** Chemin canonique visé par une note du vault, ou null (aucun signal de domaine). */
function routeOf(vault: string, rel: string): Segment[] | null {
  const note = readVaultNote(join(vault, rel), rel);
  const signal = `${note?.frontmatter.title ?? ""} ${note?.body ?? ""}`;
  const segments = routePath(signal, "auto", note?.frontmatter.project);
  return segments.length > 0 ? segments : null;
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

/** Note sans signal de domaine : la place prédéfinie est `Inbox/`, jamais la racine. */
function parkInInbox(vault: string, rel: string, report: DoctorReport): void {
  const target = `${INBOX_DIR}/${basename(rel)}`;
  if (existsSync(join(vault, target))) {
    report.warnings.push(`kept at root: ${rel} (${target} already exists)`);
    return;
  }
  backupFile(vault, rel, report.backedUp);
  renameSync(join(vault, rel), join(vault, target));
  report.actions.push(`parked, no domain signal: ${rel} → ${target}`);
}

async function doctorVault(apply: boolean, options: { plugins: boolean }): Promise<DoctorReport> {
  const structure = loadStructure();
  const vault = vaultPath();
  const report: DoctorReport = {
    vault,
    exists: existsSync(vault),
    apply,
    checks: [],
    actions: [],
    warnings: [],
    issues: [],
    backedUp: [],
    plugins: null,
    remaining: 0
  };
  if (!report.exists) {
    report.checks.push({ name: "vault", status: "fail", detail: "missing — run `novahiz second-memory init`" });
    report.remaining = 1;
    return report;
  }

  const before = auditStructure(vault);
  const lintBefore = lintVault();

  if (apply) {
    if (before.missing.length > 0) {
      const init = await initVault({ plugins: false });
      report.actions.push(`recreated ${init.created.length} system item(s)`);
    }
    for (const domain of structure.domains) {
      if (!existsSync(join(vault, domain.name))) continue;
      const gaps = expectedDomainFolders(domain).filter((rel) => !existsSync(join(vault, rel)));
      if (gaps.length === 0) continue;
      activateDomain(vault, domain);
      report.actions.push(`completed arborescence: ${domain.name} (${gaps.length} folder(s))`);
    }
    for (const folder of before.foldersWithoutMoc) {
      const parentRel = normalizeRel(dirname(folder));
      const parent = parentRel === "." ? null : { rel: parentRel, title: nodeTitleAt(parentRel) };
      ensureFolder(vault, folder, nodeTitleAt(folder), parent);
      report.actions.push(`created MOC: ${folder}/${MOC_ID}`);
    }
    for (const entry of before.unlinked) {
      const link = `[[${entry.rel}/${MOC_ID}|${nodeTitleAt(entry.rel)} MOC]]`;
      const target = `${entry.parent}/${MOC_FILE}`;
      if (addLinkToSection(vault, target, "## Subcategories", link, [`${nodeTitleAt(entry.rel)} MOC`], "last")) {
        report.actions.push(`linked: ${entry.rel} → ${target}`);
      }
    }
    const activeBefore = new Set(structure.domains.filter((domain) => existsSync(join(vault, domain.name))).map((domain) => domain.name));
    for (const rel of before.rootNotes) {
      const segments = routeOf(vault, rel);
      if (!segments) {
        parkInInbox(vault, rel, report);
        continue;
      }
      const dir = ensureTarget(vault, segments);
      const target = `${dir}/${basename(rel)}`;
      if (existsSync(join(vault, target))) {
        report.warnings.push(`kept at root: ${rel} (target exists)`);
        continue;
      }
      backupFile(vault, rel, report.backedUp);
      renameSync(join(vault, rel), join(vault, target));
      addLinkToSection(vault, `${dir}/${MOC_FILE}`, "## Notes", `[[${dir}/${basename(rel, ".md")}]]`);
      report.actions.push(`relocated: ${rel} → ${target}`);
    }
    for (const domain of structure.domains) {
      if (!activeBefore.has(domain.name) && existsSync(join(vault, domain.name))) {
        report.actions.push(`activated domain: ${domain.name} (full arborescence)`);
      }
    }
    const fixed = fixVault(true);
    for (const group of [fixed.renamed, fixed.mocCreated, fixed.triaged, fixed.linksRewritten, fixed.orphansLinked]) {
      for (const line of group) report.actions.push(line);
    }
    for (const line of fixed.skipped) report.warnings.push(line);
    report.backedUp.push(...fixed.backedUp);
    if (before.indexDrift.length > 0) {
      const links = desiredIndexLinks(structure, vault);
      rewriteIndexCategories(vault, `## ${structure.indexSection}`, links);
      report.actions.push(`rewrote INDEX ${structure.indexSection}: ${links.length} domain link(s)`);
    }
    if (before.structureDrift) {
      writeFileSync(join(vault, structure.structureFile), structureMarkdown(), "utf8");
      report.actions.push(`regenerated ${structure.structureFile} (content drift)`);
    }
    if (options.plugins) report.plugins = await installPlugins(vault);
  } else {
    for (const name of before.missing) report.actions.push(`would create: ${name}`);
    for (const gap of before.partialDomains) report.actions.push(`would complete arborescence: ${gap}`);
    for (const folder of before.foldersWithoutMoc) report.actions.push(`would create MOC: ${folder}/${MOC_ID}`);
    for (const entry of before.unlinked) {
      report.actions.push(`would link: ${entry.rel} → ${entry.parent}/${MOC_FILE}`);
    }
    for (const rel of before.rootNotes) {
      const segments = routeOf(vault, rel);
      if (segments) {
        report.actions.push(`would relocate: ${rel} → ${segments[segments.length - 1].rel}/${basename(rel)}`);
      } else {
        report.actions.push(`would park (no domain signal): ${rel} → ${INBOX_DIR}/${basename(rel)}`);
      }
    }
    if (before.indexDrift.length > 0) {
      report.actions.push(`would rewrite INDEX ${structure.indexSection} (${desiredIndexLinks(structure, vault).length} domain link(s))`);
    }
    if (before.structureDrift) report.actions.push(`would regenerate ${structure.structureFile} (content drift)`);
    const actionable = lintBefore.filter((issue) => issue.severity !== "info");
    if (actionable.length > 0) report.actions.push(`would fix ${actionable.length} lint issue(s) (fix subcommand)`);
    if (options.plugins) {
      const presence = pluginPresence();
      const needed = [...presence.missing, ...presence.disabled];
      if (needed.length > 0) report.actions.push(`would install/enable plugins: ${needed.join(", ")}`);
    }
  }

  const after = apply ? auditStructure(vault) : before;
  const lintAfter = apply ? lintVault() : lintBefore;
  report.issues = lintAfter.slice(0, 20).map((issue) => ({ severity: issue.severity, file: issue.file, message: issue.message }));

  const structureIssues = [
    ...after.rootNotes.map((note) => `root note ${note}`),
    ...after.foldersWithoutMoc.map((folder) => `${folder} has no MOC`),
    ...after.unlinked.map((entry) => `${entry.rel} not linked from ${entry.parent}`),
    ...after.partialDomains.map((gap) => `incomplete ${gap}`),
    ...(after.structureDrift ? [`${structure.structureFile} out of date`] : []),
    ...after.indexDrift
  ];
  const lintErrors = lintAfter.filter((issue) => issue.severity === "error");
  const lintWarnings = lintAfter.filter((issue) => issue.severity === "warning");
  const lintInfos = lintAfter.filter((issue) => issue.severity === "info");
  const presence = options.plugins ? pluginPresence() : null;
  const pluginsMissing = presence ? presence.missing.length + presence.disabled.length : 0;
  const memoryRoot = memoryRootForSync() ?? null;
  const drift = memoryRoot ? syncWithMemory(false).actions.length : 0;
  const brief = (items: string[]): string => (items.length <= 3 ? items.join("; ") : `${items.slice(0, 3).join("; ")} (+${items.length - 3})`);

  report.checks.push({
    name: "vault",
    status: "ok",
    detail: `${listVaultNotes(vault).length} note(s), ${listCategories(vault).length} top-level folder(s)`
  });
  report.checks.push({
    name: "skeleton",
    status: after.missing.length > 0 ? "fail" : "ok",
    detail: after.missing.length > 0 ? `missing: ${after.missing.join(", ")}` : `${INDEX_FILE}, ${structure.structureFile} and system folders present`
  });
  report.checks.push({
    name: "arborescence",
    status: structureIssues.length > 0 ? "fail" : "ok",
    detail: structureIssues.length > 0 ? brief(structureIssues) : "every folder is inside the fixed tree, MOC'd and linked"
  });
  report.checks.push({
    name: "outside-tree folders",
    status: after.unknownFolders.length > 0 ? "warn" : "ok",
    detail: after.unknownFolders.length > 0 ? `${after.unknownFolders.join(", ")} — not in the catalog (move their notes manually)` : "none"
  });
  report.checks.push({
    name: "links",
    status: lintErrors.length > 0 ? "fail" : lintWarnings.length > 0 ? "warn" : "ok",
    detail: `${lintErrors.length} error(s), ${lintWarnings.length} warning(s), ${lintInfos.length} info`
  });
  report.checks.push({
    name: "plugins",
    status: options.plugins && pluginsMissing > 0 ? "fail" : "ok",
    detail: !options.plugins
      ? "skipped (--no-plugins)"
      : pluginsMissing > 0
        ? `${pluginsMissing} mandatory plugin(s) missing or disabled`
        : `all ${structure.plugins.length} mandatory plugins installed and enabled`
  });
  report.checks.push({
    name: "memory",
    status: memoryRoot && drift > 0 ? "warn" : "ok",
    detail: !memoryRoot ? "no project memory linked" : drift > 0 ? `${drift} change(s) pending — run \`novahiz second-memory sync --apply\`` : "in sync"
  });

  report.remaining = after.missing.length + structureIssues.length + lintErrors.length + (options.plugins ? pluginsMissing : 0);
  return report;
}

function doctorLines(report: DoctorReport): string {
  const head = report.apply ? "second-memory doctor (apply):" : "second-memory doctor (dry-run — add --apply to execute):";
  if (!report.exists) return `${head}\n  [fail] vault: missing — run \`novahiz second-memory init\``;
  const lines = [head];
  // Recommandation conditionnelle : si Stitch n'est pas configure, le recommander.
  // Le code verifie la presence du bloc 'stitch' dans opencode.jsonc.
  try {
    const opencodeConfigPath = join(process.env.HOME || process.env.USERPROFILE || "", ".config", "opencode", "opencode.jsonc");
    if (existsSync(opencodeConfigPath)) {
      const cfgRaw = readFileSync(opencodeConfigPath, "utf8");
      const hasStitchServer = cfgRaw.includes('"stitch"') && (cfgRaw.includes('"servers"') || cfgRaw.includes('"sse"'));
      if (!hasStitchServer) {
        lines.push("  [info] Google Stitch MCP: non configure — pour generer des ecrans via /novahiz skill stitch-design-fidelity, ajoutez le bloc 'stitch' (SSE, Bearer token) a votre opencode.jsonc et redemarrez le client.");
        lines.push("    Voir: skills/stitch-design-fidelity/references/stitch-mcp.md et le template dans mcp/stitch-template/recommandation.md");
      }
    }
  } catch {
    // Ignore si la lecture echoue : la recommandation est un plus, pas un blocage.
  }
  for (const check of report.checks) lines.push(`  [${check.status}] ${check.name}: ${check.detail}`);
  if (report.actions.length > 0) {
    lines.push(report.apply ? "  repairs:" : "  planned:");
    for (const action of report.actions) lines.push(`    ${action}`);
  }
  for (const warning of report.warnings) lines.push(`  ! ${warning}`);
  if (report.backedUp.length > 0) lines.push(`  backed up: ${report.backedUp.length} file(s)`);
  lines.push(`  remaining issues: ${report.remaining}`);
  return lines.join("\n");
}

async function secondMemoryDoctor(parsed: Parsed): Promise<void> {
  const apply = flagOn(parsed, "apply");
  const plugins = !flagOn(parsed, "no-plugins") && !flagOn(parsed, "skip-plugins");
  const report = await doctorVault(apply, { plugins });
  emit(parsed, report, () => doctorLines(report));
  if (report.remaining > 0) process.exitCode = 1;
}

// --- Recherche plein texte --------------------------------------------------
// `second-memory search` est LA porte d'entrée de consultation du vault : la
// CLI, l'agent et le plugin (auto-consult) passent par la même fonction.
// Balayage en mémoire, sans index à maintenir — le vault compte quelques
// dizaines de notes, un scan par recherche est suffisant et restera simple.

export type VaultHit = {
  rel: string;
  title: string;
  score: number;
  snippet: string;
  updated: string;
};

/** Mots vides FR/EN : fréquents, non discriminants, ils gonfleraient le score. */
const SEARCH_STOPWORDS = new Set([
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "en", "au", "aux",
  "pour", "par", "avec", "sur", "dans", "que", "qui", "quoi", "est", "sont",
  "ce", "cet", "cette", "ces", "son", "sa", "ses", "the", "and", "for", "of",
  "to", "in", "on", "is", "are", "it", "at", "as"
]);

/** Minuscules sans accents : le vault est en FR, `Étape` doit matcher `etape`. */
function normalizeText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Termes de requête uniques, triés par longueur (les plus précis d'abord). */
export function tokenizeQuery(query: string): string[] {
  const words = normalizeText(query)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !SEARCH_STOPWORDS.has(word));
  return [...new Set(words)].sort((a, b) => b.length - a.length);
}

/** Occurrences sur frontière de mot : "code" ne compte pas dans "decode". */
function countTerm(text: string, term: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = text.match(new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "g"));
  return matches ? matches.length : 0;
}

/** Titre d'une note : frontmatter, sinon premier `#`, sinon le nom de fichier. */
function noteTitle(note: VaultNote): string {
  const fm = note.frontmatter.title;
  if (fm && fm.trim().length > 0) return fm.trim();
  const heading = /^#\s+(.+)$/m.exec(note.body);
  if (heading) return heading[1].trim();
  return basename(note.rel).replace(/\.md$/, "");
}

/** Fenêtre de texte autour de la première occurrence d'un terme. */
function buildSnippet(body: string, terms: string[]): string {
  const flat = body.replace(/\s+/g, " ").trim();
  let index = -1;
  for (const term of terms) {
    const hit = normalizeText(flat).indexOf(term);
    if (hit !== -1 && (index === -1 || hit < index)) index = hit;
  }
  const start = index === -1 ? 0 : Math.max(0, index - 60);
  const slice = flat.slice(start, start + 180).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + 180 < flat.length ? "…" : ""}`;
}

/**
 * Recherche classée dans le vault. Score borné [0,1] : un terme présent dans
 * le titre vaut 3, dans le corps jusqu'à 3, somme rapportée aux termes.
 * Notes système, templates et MOC exclus — on cherche du contenu.
 */
export function searchVault(vault: string, query: string, options: { k?: number; minScore?: number } = {}): VaultHit[] {
  const terms = tokenizeQuery(query);
  if (terms.length === 0 || !existsSync(vault)) return [];
  const k = Number.isFinite(options.k) && (options.k as number) > 0 ? Math.trunc(options.k as number) : 10;
  const minScore = typeof options.minScore === "number" && options.minScore >= 0 && options.minScore <= 1 ? options.minScore : 0;
  const hits: VaultHit[] = [];
  for (const rel of listVaultNotes(vault)) {
    if (isTemplateFile(rel) || isSystemFile(rel) || isMocFile(rel)) continue;
    const note = readVaultNote(join(vault, rel), rel);
    if (!note) continue;
    const title = noteTitle(note);
    const nTitle = normalizeText(title);
    const nBody = normalizeText(note.body);
    let total = 0;
    let matched = 0;
    for (const term of terms) {
      const inTitle = nTitle.includes(term);
      const inBody = countTerm(nBody, term);
      if (inTitle) {
        total += 3;
        matched += 1;
      }
      if (inBody > 0) {
        total += Math.min(inBody, 3);
        if (!inTitle) matched += 1;
      }
    }
    if (matched === 0) continue;
    const score = Math.min(1, total / (terms.length * 4));
    if (score < minScore) continue;
    hits.push({ rel, title, score: Math.round(score * 1000) / 1000, snippet: buildSnippet(note.body, terms), updated: note.frontmatter.updated ?? "" });
  }
  hits.sort((a, b) => b.score - a.score || (b.updated < a.updated ? -1 : b.updated > a.updated ? 1 : a.rel < b.rel ? -1 : 1));
  return hits.slice(0, k);
}

function secondMemorySearch(parsed: Parsed): void {
  const vault = vaultPath();
  const query = parsed.positionals.slice(2).join(" ").trim();
  if (query.length === 0) {
    process.stderr.write("novahiz second-memory search: missing query — usage: second-memory search <terms...> [--k=N] [--min-score=N] [--json]\n");
    process.exitCode = 1;
    return;
  }
  const k = Number.isFinite(Number(parsed.flags.k)) && Number(parsed.flags.k) > 0 ? Math.trunc(Number(parsed.flags.k)) : 10;
  const minScore = Number.isFinite(Number(parsed.flags["min-score"])) ? Number(parsed.flags["min-score"]) : 0;
  const hits = searchVault(vault, query, { k, minScore });
  emit(parsed, { vault, query, count: hits.length, hits }, () => {
    if (hits.length === 0) return `second-memory search: no hit for "${query}" in ${vault}`;
    const lines = [`second-memory search: ${hits.length} hit(s) for "${query}"`];
    for (const hit of hits) lines.push(`  ${hit.score.toFixed(3)}  ${hit.rel} — ${hit.title}\n        ${hit.snippet}`);
    lines.push(`read a hit: <vault>/${hits[0].rel}`);
    return lines.join("\n");
  });
}

export async function secondMemoryCommand(argv: string[], parsed: Parsed): Promise<void> {
  const sub = argv[0] ?? "status";
  switch (sub) {
    case "init":
      await secondMemoryInit(parsed);
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
    case "doctor":
      await secondMemoryDoctor(parsed);
      return;
    case "status":
      secondMemoryStatus(parsed);
      return;
    case "search":
      secondMemorySearch(parsed);
      return;
    default:
      process.stderr.write(`novahiz second-memory: unknown subcommand "${sub}" (init|doctor|lint|fix|sync|status|search)\n`);
      process.exitCode = 1;
  }
}
