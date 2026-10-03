import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fold } from "./classify.ts";
import { rankSlots } from "./relevance.ts";
import type { SlotDoc } from "./relevance.ts";

export const MEMORY_DIR = "project-memory";
export const SLOTS_DIR = "slots";
export const INDEX_FILE = "index.json";
export const DEFAULT_LIMIT_CHARS = 8000;
export const DEFAULT_LIMIT_LINES = 200;
export const MAX_CONTENT_LEN = 100000;
export const MAX_TITLE_LEN = 200;
export const MAX_DESC_LEN = 500;
// S3: le Resume est borne — compacter doit vraiment liberer de la place.
export const MAX_SUMMARY_CHARS = 1000;

// --- S1: robustesse index ---
// Verrou par racine mémoire (protection multi-processus: un même projet peut
// etre ouvert dans plusieurs instances opencode, chacune avec son MCP).
const LOCK_FILE = ".lock";
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_DEFAULT_MS = 2_000;
const LOCK_RETRY_MS = 25;
// Delais d'attente (synchrone) entre les tentatives de rename de l'index:
// un antivirus peut refuser le remplacement quelques dizaines de ms sur Windows.
const INDEX_RETRY_DELAYS_MS = [0, 10, 25, 50];

export type SlotStatus = "active" | "archived";

export type SlotMeta = {
  id: string;
  title: string;
  description: string;
  created: string;
  updated: string;
  chars: number;
  lines: number;
  limit_chars: number;
  limit_lines: number;
  status: SlotStatus;
  tags: string[];
  file: string;
  /** S3: id du slot parent branche par rotation (chaine de ancestraux). */
  previous?: string;
};

export type MemoryIndex = {
  version: 1;
  updated: string;
  slots: SlotMeta[];
  /**
   * S1 auto-heal: positionne en memoire uniquement quand ensureMemoryRoot a
   * reconstruit un index illisible depuis les fichiers slots. Jamais persiste
   * (writeIndex ne serialise que version/updated/slots); les reponses MCP le
   * propagent tel quel pour signaler la guerison.
   */
  healed?: boolean;
};

export type SlotBody = {
  summary: string;
  details: string;
};

export type SlotFile = {
  meta: SlotMeta;
  body: SlotBody;
  raw: string;
};

export type WriteEntryInput = {
  title: string;
  description?: string;
  content: string;
  tags?: string[];
  slotId?: string;
  root?: string;
};

export type WriteEntryResult = {
  slot: SlotMeta;
  rotated: boolean;
  compacted: boolean;
  created: boolean;
  /** S3: true quand le contenu existe deja dans le slot (ecriture idempotente). */
  duplicate?: boolean;
  /** S4: qualite du routage — high >= 0.5, medium >= 0.25, low sinon (memes bornes que memory_search). */
  confidence: "high" | "medium" | "low";
  index: MemoryIndex;
};

export type MemoryError = Error & { code: string };

function memError(code: string, message: string): MemoryError {
  const error = new Error(message) as MemoryError;
  error.code = code;
  return error;
}

export function memoryRoot(cwd?: string): string {
  const base = cwd && cwd.length > 0 ? cwd : process.cwd();
  return join(base, MEMORY_DIR);
}

export function slotsDir(root: string): string {
  return join(root, SLOTS_DIR);
}

export function indexPath(root: string): string {
  return join(root, INDEX_FILE);
}

function emptyIndex(): MemoryIndex {
  return { version: 1, updated: new Date().toISOString(), slots: [] };
}

function countChars(text: string): number {
  return [...text].length;
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "slot";
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseFrontmatter(raw: string): { meta: Partial<SlotMeta>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const header = match[1];
  const body = match[2];
  const meta: Partial<SlotMeta> = {};
  for (const line of header.split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!pair) continue;
    const key = pair[1];
    const value = pair[2].trim();
    if (key === "id") meta.id = value;
    else if (key === "title") meta.title = value;
    else if (key === "description") meta.description = value;
    else if (key === "created") meta.created = value;
    else if (key === "updated") meta.updated = value;
    else if (key === "chars") meta.chars = Number(value);
    else if (key === "lines") meta.lines = Number(value);
    else if (key === "limit_chars") meta.limit_chars = Number(value);
    else if (key === "limit_lines") meta.limit_lines = Number(value);
    else if (key === "status") meta.status = value === "archived" ? "archived" : "active";
    else if (key === "previous") meta.previous = value.length > 0 ? value : undefined;
    else if (key === "tags") {
      meta.tags = value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((tag) => tag.trim().replace(/^"|"$/g, ""))
        .filter((tag) => tag.length > 0);
    }
  }
  return { meta, body };
}

function splitSections(bodyText: string): SlotBody {
  const summaryMatch = bodyText.match(/##\s*R[ée]sum[ée]\s*\r?\n?([\s\S]*?)(?=\r?\n##\s+|$)/i);
  const detailsMatch = bodyText.match(/##\s+D[ée]tails\s*\r?\n?([\s\S]*)$/i);
  return {
    summary: (summaryMatch?.[1] ?? "").trim(),
    details: (detailsMatch?.[1] ?? bodyText).trim()
  };
}

function serializeSlot(meta: SlotMeta, body: SlotBody): string {
  const tags = meta.tags.length > 0 ? meta.tags.join(", ") : "";
  return [
    "---",
    `id: ${meta.id}`,
    `title: ${meta.title}`,
    `description: ${meta.description}`,
    `created: ${meta.created}`,
    `updated: ${meta.updated}`,
    `chars: ${meta.chars}`,
    `lines: ${meta.lines}`,
    `limit_chars: ${meta.limit_chars}`,
    `limit_lines: ${meta.limit_lines}`,
    `status: ${meta.status}`,
    `tags: ${tags}`,
    ...(meta.previous ? [`previous: ${meta.previous}`] : []),
    "---",
    "",
    "## Résumé",
    body.summary.trim().length > 0 ? body.summary.trim() : "(vide)",
    "",
    "## Détails",
    body.details.trim().length > 0 ? body.details.trim() : "(vide)",
    ""
  ].join("\n");
}

function measure(meta: Omit<SlotMeta, "chars" | "lines" | "updated">, body: SlotBody): SlotMeta {
  const draft: SlotMeta = { ...meta, chars: 0, lines: 0, updated: nowIso() };
  const raw = serializeSlot(draft, body);
  return { ...meta, chars: countChars(raw), lines: countLines(raw), updated: nowIso() };
}

function ensureRootDirs(root: string): void {
  const slots = slotsDir(root);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  if (!existsSync(slots)) mkdirSync(slots, { recursive: true });
}

// Verrouillage intra-processus (profondeur) puis inter-processus (fichier .lock).
const lockDepth = new Map<string, number>();

function lockPath(root: string): string {
  return join(root, LOCK_FILE);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = processus existe mais appartient a un autre utilisateur.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLockInfo(root: string): { pid: number; at: number } | null {
  try {
    const raw = readFileSync(lockPath(root), "utf8");
    const [pidRaw, atRaw] = raw.split("\n");
    const pid = Number(pidRaw);
    const at = Number(atRaw);
    if (!Number.isInteger(pid) || !Number.isFinite(at)) return null;
    return { pid, at };
  } catch {
    // Absent ou illisible: traite comme un verrou perime.
    return null;
  }
}

function tryStealLock(root: string, info: { pid: number; at: number } | null): boolean {
  const stale =
    info === null || !isProcessAlive(info.pid) || Date.now() - info.at > LOCK_STALE_MS;
  if (!stale) return false;
  try {
    unlinkSync(lockPath(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  return !existsSync(lockPath(root));
}

/**
 * Acquiert le verrou d'ecriture de la racine memoire. Retourne la fonction de
 * liberation (a appeler dans un finally). Reentrant dans le meme processus
 * (profondeur), bloquant jusqu'a `waitMs` sinon, vol de verrou perime (pid mort
 * ou horodatage > LOCK_STALE_MS) sinon E_LOCK.
 */
export function acquireRootLock(root: string, waitMs = LOCK_WAIT_DEFAULT_MS): () => void {
  const depth = lockDepth.get(root) ?? 0;
  if (depth > 0) {
    lockDepth.set(root, depth + 1);
    return () => releaseRootLock(root);
  }

  ensureRootDirs(root);
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    try {
      writeFileSync(lockPath(root), `${process.pid}\n${Date.now()}\n`, { flag: "wx" });
      lockDepth.set(root, 1);
      return () => releaseRootLock(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = readLockInfo(root);
    if (info !== null && info.pid === process.pid && Date.now() - info.at <= LOCK_STALE_MS) {
      // Notre propre verrou (section interrompue par un crash precedent au
      // meme pid): on le reprend en reentrant.
      lockDepth.set(root, 1);
      return () => releaseRootLock(root);
    }
    if (tryStealLock(root, info)) continue;
    if (Date.now() >= deadline) {
      const holder = info === null ? "illisible" : String(info.pid);
      throw memError("E_LOCK", `verrou memoire occupe (pid ${holder}) sous ${root}`);
    }
    sleepSync(LOCK_RETRY_MS);
  }
}

function releaseRootLock(root: string): void {
  const depth = lockDepth.get(root) ?? 0;
  if (depth > 1) {
    lockDepth.set(root, depth - 1);
    return;
  }
  lockDepth.delete(root);
  try {
    const info = readLockInfo(root);
    if (info === null || info.pid === process.pid) unlinkSync(lockPath(root));
    // Verrou repris par un autre (course apres peremption): on ne touche pas
    // au fichier d'un tiers.
  } catch {
    // Deja libere (ENOENT) ou lecture echouee: rien a faire.
  }
}

export function ensureMemoryRoot(root: string): MemoryIndex {
  ensureRootDirs(root);
  const file = indexPath(root);
  if (!existsSync(file)) {
    const index = emptyIndex();
    writeIndex(root, index);
    return index;
  }
  try {
    return readIndex(root);
  } catch (error) {
    if ((error as MemoryError).code !== "E_INDEX") throw error;
    // S1 auto-heal: l'index est illisible (crash, ecriture tronquee...).
    // Les fichiers slots font foi: on les ressuscite dans un index sain.
    const release = acquireRootLock(root);
    try {
      try {
        // Course possible: un autre processus a pu guerir entre-temps.
        const healed = readIndex(root);
        return healed;
      } catch {
        const rebuilt: MemoryIndex = {
          version: 1,
          updated: nowIso(),
          slots: scanSlots(root)
        };
        writeIndex(root, rebuilt);
        return { ...rebuilt, healed: true };
      }
    } finally {
      release();
    }
  }
}

export function readIndex(root: string): MemoryIndex {
  const file = indexPath(root);
  if (!existsSync(file)) return emptyIndex();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<MemoryIndex>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.slots)) {
      throw memError("E_INDEX", "index.json invalide: structure absente");
    }
    return {
      version: 1,
      updated: typeof parsed.updated === "string" ? parsed.updated : nowIso(),
      slots: parsed.slots.filter(
        (slot): slot is SlotMeta =>
          Boolean(slot && typeof slot.id === "string" && isSafeSlotFile(slot.file))
      )
    };
  } catch (error) {
    if ((error as MemoryError).code === "E_INDEX") throw error;
    throw memError("E_INDEX", `index.json illisible: ${(error as Error).message}`);
  }
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isRetryableFsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "EEXIST" ||
    code === "ENOTEMPTY";
}

// Ecriture atomique: fichier temporaire + rename. Sur Windows le rename
// remplace la cible (MOVEFILE_REPLACE_EXISTING) mais un antivirus peut le
// refuser quelques ms: on reessaie avec une attente synchrone plutot que
// d'ecrire l'index en place (risque de JSON tronque = E_INDEX a la lecture).
function atomicWriteText(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  let lastError: unknown;
  for (const delay of INDEX_RETRY_DELAYS_MS) {
    if (delay > 0) sleepSync(delay);
    try {
      writeFileSync(tmp, text, "utf8");
      renameSync(tmp, file);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableFsError(error)) break;
    }
  }
  try {
    if (existsSync(tmp)) unlinkSync(tmp);
  } catch {
    // Nettoyage best-effort du temporaire; l'erreur d'ecriture initiale est
    // remontee juste en dessous.
  }
  throw lastError;
}

export function writeIndex(root: string, index: MemoryIndex): MemoryIndex {
  const next: MemoryIndex = { ...index, version: 1, updated: nowIso() };
  // Seules ces trois cles sont persistees: `healed` (S1) reste en memoire.
  const persisted = { version: next.version, updated: next.updated, slots: next.slots };
  atomicWriteText(indexPath(root), `${JSON.stringify(persisted, null, 2)}\n`);
  return next;
}

/** A slot file must be a relative path with no traversal segment (memory index hardening). */
export function isSafeSlotFile(file: unknown): boolean {
  if (typeof file !== "string" || file.trim() === "") return false;
  if (/^([\\/]|[A-Za-z]:)/.test(file)) return false;
  return !file.split(/[\\/]/).includes("..");
}

export function slotPath(root: string, meta: Pick<SlotMeta, "file">): string {
  if (!isSafeSlotFile(meta.file)) {
    throw memError("E_INDEX", `slot.file invalide ou hors racine: ${String(meta.file)}`);
  }
  return join(root, meta.file);
}

export function readSlot(root: string, meta: Pick<SlotMeta, "file" | "id">): SlotFile {
  const file = slotPath(root, meta);
  if (!existsSync(file)) throw memError("E_SLOT", `slot introuvable: ${meta.id}`);
  const raw = readFileSync(file, "utf8");
  const parsed = parseFrontmatter(raw);
  const body = splitSections(parsed.body);
  const withFile: SlotMeta = {
    id: meta.id,
    title: parsed.meta.title ?? meta.id,
    description: parsed.meta.description ?? "",
    created: parsed.meta.created ?? nowIso(),
    updated: parsed.meta.updated ?? nowIso(),
    chars: countChars(raw),
    lines: countLines(raw),
    limit_chars: parsed.meta.limit_chars ?? DEFAULT_LIMIT_CHARS,
    limit_lines: parsed.meta.limit_lines ?? DEFAULT_LIMIT_LINES,
    status: parsed.meta.status ?? "active",
    tags: parsed.meta.tags ?? [],
    previous: parsed.meta.previous,
    file: meta.file
  };
  return { meta: withFile, body, raw };
}

export function nextSlotId(index: MemoryIndex): string {
  let max = 0;
  for (const slot of index.slots) {
    const match = slot.id.match(/^slot-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `slot-${String(max + 1).padStart(3, "0")}`;
}

export function isFull(meta: Pick<SlotMeta, "chars" | "lines" | "limit_chars" | "limit_lines">): boolean {
  return meta.chars >= meta.limit_chars || meta.lines >= meta.limit_lines;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9àâäéèêëîïôöùûüç]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 2)
  );
}

// S4: mots-outils FR/EN exclus du routage. Ils gonflaient le denominateur de
// relatedness — "release des tests" vs "release les metriques" partageait
// 1 token sur 3 au lieu de 1 sur 2 — et faussaient les écritures jumelles.
const ROUTE_STOPWORDS = new Set([
  // FR
  "afin", "alors", "apres", "aussi", "avec", "aux", "car", "ceux", "cette",
  "chez", "comme", "dans", "depuis", "des", "donc", "dont", "entre", "est",
  "etre", "être", "jusqu", "les", "leur", "leurs", "lors", "mais", "par",
  "plus", "pour", "que", "qui", "sans", "ses", "son", "sont", "sous", "sur",
  "très", "tres", "une", "vers", "vue", "cette",
  // EN
  "about", "after", "again", "all", "and", "any", "are", "been", "being",
  "but", "can", "does", "done", "for", "from", "had", "has", "have", "into",
  "its", "may", "might", "must", "not", "over", "same", "should", "such",
  "than", "that", "the", "their", "them", "then", "these", "they", "this",
  "those", "too", "under", "very", "was", "were", "will", "with", "would",
  "you", "your"
]);

// S4: tokenize() sans les mots-outils — le vocabulaire du routage.
function contentTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of tokenize(text)) if (!ROUTE_STOPWORDS.has(token)) tokens.add(token);
  return tokens;
}

// S4: seuil de routage, valeur S0 inchangee (0.25) mais rendue explicite —
// en dessous, l'ecriture cree un nouveau slot plutot que de s'inscrire.
export const ROUTE_MIN_SCORE = 0.25;

// S4: memes bornes que memory_search (0.5 / 0.25), appliquees au score de
// routage expose dans WriteEntryResult.confidence.
function routeConfidence(score: number): "high" | "medium" | "low" {
  return score >= 0.5 ? "high" : score >= ROUTE_MIN_SCORE ? "medium" : "low";
}

// S4: poids IDF optionnels (cf. buildRouteIdf). Sans carte, tous les poids
// valent 1 et la formule est exactement celle de S0: commun / max(commun).
export function relatedness(
  a: string,
  b: string,
  idf?: ReadonlyMap<string, number>
): number {
  const left = contentTokens(a);
  const right = contentTokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  const weight = (token: string): number => idf?.get(token) ?? 1;
  let leftTotal = 0;
  let rightTotal = 0;
  let shared = 0;
  for (const token of left) {
    leftTotal += weight(token);
    if (right.has(token)) shared += weight(token);
  }
  for (const token of right) rightTotal += weight(token);
  return shared / Math.max(leftTotal, rightTotal);
}

// S4: IDF du corpus actif, formule alignee sur rankSlots: ln((N+1)/(df+1))+1.
// Un token present partout pese 1 (neutre); un token rare pese jusqu'a
// ln(N+1)+1 et domine le score — les mots partages deviennent decisifs.
export function buildRouteIdf(texts: string[]): Map<string, number> {
  const total = texts.length;
  const frequency = new Map<string, number>();
  for (const text of texts) {
    for (const token of contentTokens(text)) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [token, count] of frequency) {
    idf.set(token, Math.log((total + 1) / (count + 1)) + 1);
  }
  return idf;
}

export type RankTarget = { slot: SlotMeta; score: number };

// S4: routage stopwords + IDF + Resume. Retourne aussi le score pour que
// writeEntry en derive sa confidence; findTargetSlot est le wrapper qui ne
// garde que le slot (contrat S0 inchange).
export function rankTargetSlot(
  index: MemoryIndex,
  root: string,
  input: { title: string; description?: string; tags?: string[]; slotId?: string }
): RankTarget | null {
  if (input.slotId) {
    const explicit = index.slots.find((slot) => slot.id === input.slotId);
    if (!explicit) throw memError("E_SLOT", `slot inconnu: ${input.slotId}`);
    if (explicit.status === "archived") throw memError("E_SLOT", `slot archivé: ${input.slotId}`);
    // Ecriture dirigeée: la cible est nommement choisie, score maximal.
    return { slot: explicit, score: 1 };
  }
  const haystack = [input.title, input.description ?? "", ...(input.tags ?? [])].join(" ");
  const active = index.slots.filter((slot) => slot.status === "active");
  // S4: le Resume entre dans le score — c'est lui qui retrouve un slot dont
  // le titre ne matche plus apres une reecriture de Resume. Un slot
  // illisible (fantome) compte sans Resume plutot que de casser l'ecriture.
  const routed = active.map((slot) => {
    let summary = "";
    try {
      summary = readSlot(root, slot).body.summary;
    } catch {
      summary = "";
    }
    return { slot, text: `${slot.title} ${slot.description} ${slot.tags.join(" ")} ${summary}` };
  });
  const idf = buildRouteIdf(routed.map((entry) => entry.text));
  let best: RankTarget | null = null;
  for (const entry of routed) {
    const score = relatedness(haystack, entry.text, idf);
    if (best === null || score > best.score) best = { slot: entry.slot, score };
  }
  if (best !== null && best.score >= ROUTE_MIN_SCORE) return best;
  return null;
}

export function findTargetSlot(
  index: MemoryIndex,
  root: string,
  input: { title: string; description?: string; tags?: string[]; slotId?: string }
): SlotMeta | null {
  return rankTargetSlot(index, root, input)?.slot ?? null;
}

export function createSlot(
  root: string,
  input: { title: string; description?: string; tags?: string[] }
): { meta: SlotMeta; index: MemoryIndex } {
  const index = ensureMemoryRoot(root);
  const id = nextSlotId(index);
  const file = join(SLOTS_DIR, `${id}-${slugify(input.title)}.md`);
  const body: SlotBody = { summary: input.description?.trim() || input.title.trim(), details: "" };
  const base = {
    id,
    title: input.title.trim().slice(0, MAX_TITLE_LEN) || id,
    description: (input.description ?? "").trim().slice(0, MAX_DESC_LEN),
    created: nowIso(),
    limit_chars: DEFAULT_LIMIT_CHARS,
    limit_lines: DEFAULT_LIMIT_LINES,
    status: "active" as SlotStatus,
    tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 12),
    file
  };
  const meta = measure(base, body);
  writeFileSync(slotPath(root, meta), serializeSlot(meta, body), "utf8");
  const nextIndex = writeIndex(root, { ...index, slots: [...index.slots, meta] });
  return { meta, index: nextIndex };
}

// S3: borne le Resume a MAX_SUMMARY_CHARS en conservant la premiere ligne
// (titre) puis les lignes les plus recentes qui tiennent dans le budget.
function boundSummary(summary: string): string {
  const text = summary.trim();
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  const lines = text.split("\n");
  const head = lines[0].slice(0, MAX_SUMMARY_CHARS);
  let used = head.length;
  const tail: string[] = [];
  for (let i = lines.length - 1; i >= 1; i -= 1) {
    const cost = lines[i].length + 1;
    if (used + cost > MAX_SUMMARY_CHARS) break;
    tail.unshift(lines[i]);
    used += cost;
  }
  return [head, ...tail].join("\n");
}

function compactBody(body: SlotBody): { body: SlotBody; changed: boolean } {
  const details = body.details.trim();
  if (details.length === 0) return { body, changed: false };
  const lines = details.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 4) return { body, changed: false };
  const keep = lines.slice(-4).join("\n");
  const fold = lines.slice(0, -4).join("\n");
  // S3: le fold est insere PUIS le Resume est borne — compacter libere
  // reellement des caracteres au lieu de seulement deplacer le contenu.
  const summary = boundSummary([body.summary.trim(), `- ${fold}`].filter(Boolean).join("\n"));
  return { body: { summary, details: keep }, changed: true };
}

function appendToBody(body: SlotBody, content: string): SlotBody {
  const block = content.trim();
  const details =
    body.details.trim().length > 0 && body.details.trim() !== "(vide)"
      ? `${body.details.trim()}\n\n${block}`
      : block;
  return { summary: body.summary, details };
}

// S3: dedup par hash — re-ecrire un bloc identique est idempotent.
function blockHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isDuplicateBlock(details: string, content: string): boolean {
  const wanted = blockHash(content.trim());
  const blocks = details
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  return blocks.some((block) => blockHash(block) === wanted);
}

function persistSlot(root: string, meta: SlotMeta, body: SlotBody): SlotMeta {
  const next = measure(meta, body);
  writeFileSync(slotPath(root, next), serializeSlot(next, body), "utf8");
  return next;
}

function upsertIndexSlot(index: MemoryIndex, meta: SlotMeta): MemoryIndex {
  const slots = index.slots.some((slot) => slot.id === meta.id)
    ? index.slots.map((slot) => (slot.id === meta.id ? meta : slot))
    : [...index.slots, meta];
  return { ...index, slots };
}

export function writeEntry(input: WriteEntryInput): WriteEntryResult {
  const content = (input.content ?? "").trim();
  if (content.length === 0) throw memError("E_CONTENT", "contenu vide");
  if (content.length > MAX_CONTENT_LEN) {
    throw memError("E_CONTENT", `contenu trop long: ${content.length} > ${MAX_CONTENT_LEN}`);
  }
  const title = (input.title ?? "").trim().slice(0, MAX_TITLE_LEN);
  if (title.length === 0) throw memError("E_TITLE", "titre vide");

  const root = input.root && input.root.length > 0 ? input.root : memoryRoot();
  // S1: tout le cycle de mutation tourne sous le verrou de la racine.
  const release = acquireRootLock(root);
  try {
    return writeEntryLocked(root, input, title, content);
  } finally {
    release();
  }
}

function writeEntryLocked(
  root: string,
  input: WriteEntryInput,
  title: string,
  content: string
): WriteEntryResult {
  let index = ensureMemoryRoot(root);
  // L'auto-heal (S1) peut avoir eu lieu dans ensureMemoryRoot; createSlot
  // relit ensuite un index deja republie (sans la marque) — on retablit le
  // drapeau sur le resultat pour qu'il atteigne les reponses MCP.
  const healedHere = index.healed === true;
  const withHeal = (value: MemoryIndex): MemoryIndex =>
    healedHere ? { ...value, healed: true } : value;

  const rank = rankTargetSlot(index, root, {
    title,
    description: input.description,
    tags: input.tags,
    slotId: input.slotId
  });
  let target = rank?.slot ?? null;
  // S4: qualite du routage — aucune correspondance (slot cree ici) = low.
  // Calculee avant mutation pour rester identique sur les 3 retours.
  const confidence = routeConfidence(rank?.score ?? 0);

  let created = false;
  let rotated = false;
  let compacted = false;

  if (!target) {
    const made = createSlot(root, {
      title,
      description: input.description,
      tags: input.tags
    });
    target = made.meta;
    index = made.index;
    created = true;
  }

  let slot = readSlot(root, target);
  // S3 dedup: le bloc existe deja dans ce slot -> retour idempotente sans
  // aucune mutation (ni meta ni corps), signale duplicate: true.
  if (isDuplicateBlock(slot.body.details, content)) {
    return {
      slot: slot.meta,
      rotated: false,
      compacted: false,
      created,
      duplicate: true,
      confidence,
      index: withHeal(index)
    };
  }
  let body = appendToBody(slot.body, content);
  if (input.description && input.description.trim().length > 0) {
    const desc = input.description.trim().slice(0, MAX_DESC_LEN);
    body = { ...body, summary: body.summary && body.summary !== "(vide)" ? body.summary : desc };
    slot = {
      ...slot,
      meta: { ...slot.meta, description: desc || slot.meta.description }
    };
  }
  if (input.tags && input.tags.length > 0) {
    const tags = [...new Set([...slot.meta.tags, ...input.tags.map((tag) => tag.trim()).filter(Boolean)])].slice(0, 12);
    slot = { ...slot, meta: { ...slot.meta, tags } };
  }

  let nextMeta = persistSlot(root, slot.meta, body);

  if (isFull(nextMeta)) {
    const compact = compactBody(body);
    if (compact.changed) {
      body = compact.body;
      nextMeta = persistSlot(root, nextMeta, body);
      compacted = true;
    }
  }

  if (isFull(nextMeta)) {
    nextMeta = { ...nextMeta, status: "archived" };
    writeFileSync(slotPath(root, nextMeta), serializeSlot(nextMeta, body), "utf8");
    const made = createSlot(root, {
      title: nextMeta.title,
      description: nextMeta.description,
      tags: nextMeta.tags
    });
    const slotBody = appendToBody({ summary: made.meta.title, details: "" }, content);
    // S3 lignee: le slot neuf pointe vers son parent archive (previous: id).
    const rotatedMeta = persistSlot(root, { ...made.meta, previous: nextMeta.id }, slotBody);
    index = upsertIndexSlot(index, nextMeta);
    index = upsertIndexSlot(index, rotatedMeta);
    index = writeIndex(root, index);
    return { slot: rotatedMeta, rotated: true, compacted, created, confidence, index: withHeal(index) };
  }

  index = upsertIndexSlot(index, nextMeta);
  index = writeIndex(root, index);
  return { slot: nextMeta, rotated: false, compacted, created, confidence, index: withHeal(index) };
}

export function listSlots(root?: string): MemoryIndex {
  const dir = root && root.length > 0 ? root : memoryRoot();
  return ensureMemoryRoot(dir);
}

export function getSlot(id: string, root?: string): SlotFile {
  assertSlotId(id);
  const dir = root && root.length > 0 ? root : memoryRoot();
  const index = ensureMemoryRoot(dir);
  const meta = index.slots.find((slot) => slot.id === id);
  if (!meta) throw memError("E_SLOT", `slot inconnu: ${id}`);
  return readSlot(dir, meta);
}

// Reconstruit les metadonnees depuis les fichiers slots, SANS lire l'index:
// c'est exactement ce qui echouait quand l'index etait corrompu (bug revele
// en S0, corrige ici — les fichiers .md font foi).
function scanSlots(root: string): SlotMeta[] {
  const dir = slotsDir(root);
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")) : [];
  const slots: SlotMeta[] = [];
  for (const name of files) {
    const raw = readFileSync(join(dir, name), "utf8");
    const parsed = parseFrontmatter(raw);
    const body = splitSections(parsed.body);
    const id = parsed.meta.id ?? name.replace(/\.md$/, "").split("-").slice(0, 2).join("-");
    const base = {
      id,
      title: parsed.meta.title ?? id,
      description: parsed.meta.description ?? "",
      created: parsed.meta.created ?? nowIso(),
      limit_chars: parsed.meta.limit_chars ?? DEFAULT_LIMIT_CHARS,
      limit_lines: parsed.meta.limit_lines ?? DEFAULT_LIMIT_LINES,
      status: parsed.meta.status ?? ("active" as SlotStatus),
      tags: parsed.meta.tags ?? [],
      previous: parsed.meta.previous,
      file: join(SLOTS_DIR, name)
    };
    slots.push(measure(base, body));
  }
  slots.sort((a, b) => a.id.localeCompare(b.id));
  return slots;
}

export function rebuildIndex(root: string): MemoryIndex {
  const release = acquireRootLock(root);
  try {
    ensureRootDirs(root);
    return writeIndex(root, { version: 1, updated: nowIso(), slots: scanSlots(root) });
  } finally {
    release();
  }
}

const SLOT_ID_MAX_LEN = 128;

// Audit 2026-09-25, LOW: slot ids are index keys, not paths — they must never
// carry path segments. getSlot/parseSlotInput already refuse unknown ids via
// E_SLOT; this adds an explicit format check so a crafted id fails on its own
// terms (defense in depth, and a clearer error than "slot inconnu").
export function assertSlotId(id: string): string {
  const hasPathChar = [...id].some((ch) => {
    const c = ch.charCodeAt(0);
    return c === 47 || c === 92 || c === 0;
  });
  if (id.length === 0 || id.length > SLOT_ID_MAX_LEN || id.includes("..") || hasPathChar) {
    throw memError("E_SLOT_ID", `Invalid params: slot id illégal: ${JSON.stringify(id)}`);
  }
  return id;
}

export function parseSlotInput(args: Record<string, unknown>): WriteEntryInput {
  const title = typeof args?.title === "string" ? args.title : "";
  const content = typeof args?.content === "string" ? args.content : "";
  if (title.length === 0) throw memError("E_TITLE", "Invalid params: title must be a non-empty string");
  if (content.length === 0) throw memError("E_CONTENT", "Invalid params: content must be a non-empty string");
  return {
    title,
    content,
    description: typeof args?.description === "string" ? args.description : undefined,
    tags: Array.isArray(args?.tags) ? args.tags.map(String) : undefined,
    slotId: typeof args?.slotId === "string" ? assertSlotId(args.slotId) : undefined,
    root: typeof args?.root === "string" ? args.root : undefined
  };
}

export type SlotSearchHit = {
  meta: SlotMeta;
  score: number;
  confidence: "high" | "medium" | "low";
  matched: string[];
  snippet: string;
};

export type SlotSearchResult = {
  root: string;
  query: string;
  searched: number;
  hits: SlotSearchHit[];
};

// S2: snippet = premiere ligne non vide dont le texte froisse contient un
// token matche. Granularite ligne: aucune derive de position malgre le fold
// d'accents (le fold ne sert qu'a la comparaison, jamais au decoupage).
function buildSnippet(text: string, matched: string[]): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const hit = lines.find((line) => {
    const folded = fold(line);
    return matched.some((token) => folded.includes(token));
  });
  const base = hit ?? lines[0] ?? "";
  return base.length > 160 ? `${base.slice(0, 157)}...` : base;
}

/**
 * S2: recherche ciblee — rankSlots (fold + IDF sur le corpus actif) applique
 * a title + description + tags + Resume + Details de chaque slot, retourne les
 * meilleurs hits avec score [0,1], confidence (seuils 0.5 / 0.25 alignes sur
 * le seuil de routage) et un snippet d'orientation.
 */
export function searchSlots(
  root: string,
  query: string,
  options: { limit?: number; includeArchived?: boolean } = {}
): SlotSearchResult {
  const dir = root && root.length > 0 ? root : memoryRoot();
  const index = ensureMemoryRoot(dir);
  const limit = Math.min(Math.max(1, options.limit ?? 5), 20);
  const includeArchived = options.includeArchived === true;
  const pool = index.slots.filter((slot) => (includeArchived ? true : slot.status === "active"));

  const docs: SlotDoc[] = [];
  const metaById = new Map<string, SlotMeta>();
  const textById = new Map<string, string>();
  for (const meta of pool) {
    let file: SlotFile;
    try {
      file = readSlot(dir, meta);
    } catch {
      // Slot declare dans l'index mais fichier absent/ilisible: non lisible
      // en lecture (l'ecriture et le rebuild restent les chemins bruyants).
      continue;
    }
    const text = `${file.body.summary}\n${file.body.details}`;
    docs.push({
      id: meta.id,
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      text
    });
    metaById.set(meta.id, meta);
    textById.set(meta.id, text);
  }

  const ranked = rankSlots(docs, query, limit);
  const hits: SlotSearchHit[] = ranked.map((rankedSlot) => {
    const score = rankedSlot.score;
    const confidence: "high" | "medium" | "low" =
      score >= 0.5 ? "high" : score >= 0.25 ? "medium" : "low";
    return {
      meta: metaById.get(rankedSlot.id) as SlotMeta,
      score,
      confidence,
      matched: rankedSlot.matched,
      snippet: buildSnippet(textById.get(rankedSlot.id) ?? "", rankedSlot.matched)
    };
  });
  return { root: dir, query: query.trim(), searched: pool.length, hits };
}

function withHealFlag(value: MemoryIndex, healed: boolean): MemoryIndex {
  return healed ? { ...value, healed: true } : value;
}

export type SlotUpdateInput = {
  id: string;
  root?: string;
  mode: "replace" | "append" | "summary";
  content?: string;
  summary?: string;
};

export type SlotUpdateResult = {
  slot: SlotMeta;
  mode: SlotUpdateInput["mode"];
  updated: true;
  compacted: boolean;
  index: MemoryIndex;
};

/**
 * S3: corrige un slot existant — remplace les Details (replace), ajoute un
 * bloc (append) ou reecrit le Resume (summary). Jamais de rotation: update ne
 * migre pas le contenu vers un autre slot; si le slot reste plein, la
 * prochaine writeEntry effectuera la rotation. Slot archive = refuse (E_SLOT).
 */
export function updateSlot(input: SlotUpdateInput): SlotUpdateResult {
  const id = assertSlotId(input.id);
  const mode = input.mode;
  if (mode !== "replace" && mode !== "append" && mode !== "summary") {
    throw memError("E_CONTENT", `mode d'update inconnu: ${String(input.mode)}`);
  }
  const root = input.root && input.root.length > 0 ? input.root : memoryRoot();
  const release = acquireRootLock(root);
  try {
    const index = ensureMemoryRoot(root);
    const healed = index.healed === true;
    const meta = index.slots.find((slot) => slot.id === id);
    if (!meta) throw memError("E_SLOT", `slot inconnu: ${id}`);
    if (meta.status === "archived") throw memError("E_SLOT", `slot archive: ${id}`);

    const current = readSlot(root, meta);
    let body = current.body;
    if (mode === "summary") {
      const summary = (input.summary ?? "").trim();
      if (summary.length === 0) throw memError("E_CONTENT", "resume vide");
      if (summary.length > MAX_SUMMARY_CHARS) {
        throw memError(
          "E_CONTENT",
          `resume trop long: ${summary.length} > ${MAX_SUMMARY_CHARS}`
        );
      }
      body = { summary, details: body.details };
    } else {
      const content = (input.content ?? "").trim();
      if (content.length === 0) throw memError("E_CONTENT", "contenu vide");
      if (content.length > MAX_CONTENT_LEN) {
        throw memError("E_CONTENT", `contenu trop long: ${content.length} > ${MAX_CONTENT_LEN}`);
      }
      body =
        mode === "replace"
          ? { summary: body.summary, details: content }
          : appendToBody(body, content);
    }

    let nextMeta = persistSlot(root, meta, body);
    let compacted = false;
    if (isFull(nextMeta)) {
      const compact = compactBody(body);
      if (compact.changed) {
        body = compact.body;
        nextMeta = persistSlot(root, nextMeta, body);
        compacted = true;
      }
    }

    const nextIndex = writeIndex(root, upsertIndexSlot(index, nextMeta));
    return { slot: nextMeta, mode, updated: true, compacted, index: withHealFlag(nextIndex, healed) };
  } finally {
    release();
  }
}

export type SlotArchiveResult = {
  slot: SlotMeta;
  archived: true;
  /** false quand le slot etait deja archive (idempotent). */
  changed: boolean;
  index: MemoryIndex;
};

/**
 * S3: passe un slot en archived. AUCUNE suppression de donnee — le fichier
 * markdown reste sur disque, la lignee previous et les indices de rotation
 * sont conserves; les slots archives sortent du routage et de la recherche
 * (includeArchived les reinclut). Idempotent.
 */
export function archiveSlot(id: string, root?: string): SlotArchiveResult {
  const slotId = assertSlotId(id);
  const dir = root && root.length > 0 ? root : memoryRoot();
  const release = acquireRootLock(dir);
  try {
    const index = ensureMemoryRoot(dir);
    const healed = index.healed === true;
    const meta = index.slots.find((slot) => slot.id === slotId);
    if (!meta) throw memError("E_SLOT", `slot inconnu: ${slotId}`);
    if (meta.status === "archived") {
      return { slot: meta, archived: true, changed: false, index: withHealFlag(index, healed) };
    }
    const current = readSlot(dir, meta);
    const archivedMeta = persistSlot(dir, { ...meta, status: "archived" }, current.body);
    const nextIndex = writeIndex(dir, upsertIndexSlot(index, archivedMeta));
    return {
      slot: archivedMeta,
      archived: true,
      changed: true,
      index: withHealFlag(nextIndex, healed)
    };
  } finally {
    release();
  }
}
