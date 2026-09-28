import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MEMORY_DIR = "project-memory";
export const SLOTS_DIR = "slots";
export const INDEX_FILE = "index.json";
export const DEFAULT_LIMIT_CHARS = 8000;
export const DEFAULT_LIMIT_LINES = 200;
export const MAX_CONTENT_LEN = 100000;
export const MAX_TITLE_LEN = 200;
export const MAX_DESC_LEN = 500;

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
};

export type MemoryIndex = {
  version: 1;
  updated: string;
  slots: SlotMeta[];
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

export function ensureMemoryRoot(root: string): MemoryIndex {
  const slots = slotsDir(root);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  if (!existsSync(slots)) mkdirSync(slots, { recursive: true });
  const file = indexPath(root);
  if (!existsSync(file)) {
    const index = emptyIndex();
    writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    return index;
  }
  return readIndex(root);
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

export function writeIndex(root: string, index: MemoryIndex): MemoryIndex {
  const next: MemoryIndex = { ...index, version: 1, updated: nowIso() };
  writeFileSync(indexPath(root), `${JSON.stringify(next, null, 2)}\n`, "utf8");
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

export function relatedness(a: string, b: string): number {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

export function findTargetSlot(
  index: MemoryIndex,
  root: string,
  input: { title: string; description?: string; tags?: string[]; slotId?: string }
): SlotMeta | null {
  if (input.slotId) {
    const explicit = index.slots.find((slot) => slot.id === input.slotId);
    if (!explicit) throw memError("E_SLOT", `slot inconnu: ${input.slotId}`);
    if (explicit.status === "archived") throw memError("E_SLOT", `slot archivé: ${input.slotId}`);
    return explicit;
  }
  const haystack = [input.title, input.description ?? "", ...(input.tags ?? [])].join(" ");
  let best: SlotMeta | null = null;
  let bestScore = 0;
  for (const slot of index.slots) {
    if (slot.status !== "active") continue;
    const score = relatedness(haystack, `${slot.title} ${slot.description} ${slot.tags.join(" ")}`);
    if (score > bestScore) {
      bestScore = score;
      best = slot;
    }
  }
  if (best && bestScore >= 0.25) return best;
  void root;
  return null;
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

function compactBody(body: SlotBody): { body: SlotBody; changed: boolean } {
  const details = body.details.trim();
  if (details.length === 0) return { body, changed: false };
  const lines = details.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 4) return { body, changed: false };
  const keep = lines.slice(-4).join("\n");
  const fold = lines.slice(0, -4).join("\n");
  const summary = [body.summary.trim(), `- ${fold}`].filter(Boolean).join("\n");
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
  let index = ensureMemoryRoot(root);

  let target = findTargetSlot(index, root, {
    title,
    description: input.description,
    tags: input.tags,
    slotId: input.slotId
  });

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
    const rotatedMeta = persistSlot(root, made.meta, slotBody);
    index = upsertIndexSlot(index, nextMeta);
    index = upsertIndexSlot(index, rotatedMeta);
    index = writeIndex(root, index);
    return { slot: rotatedMeta, rotated: true, compacted, created, index };
  }

  index = upsertIndexSlot(index, nextMeta);
  index = writeIndex(root, index);
  return { slot: nextMeta, rotated: false, compacted, created, index };
}

export function listSlots(root?: string): MemoryIndex {
  const dir = root && root.length > 0 ? root : memoryRoot();
  return ensureMemoryRoot(dir);
}

export function getSlot(id: string, root?: string): SlotFile {
  const dir = root && root.length > 0 ? root : memoryRoot();
  const index = ensureMemoryRoot(dir);
  const meta = index.slots.find((slot) => slot.id === id);
  if (!meta) throw memError("E_SLOT", `slot inconnu: ${id}`);
  return readSlot(dir, meta);
}

export function rebuildIndex(root: string): MemoryIndex {
  ensureMemoryRoot(root);
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
      file: join(SLOTS_DIR, name)
    };
    slots.push(measure(base, body));
  }
  slots.sort((a, b) => a.id.localeCompare(b.id));
  return writeIndex(root, { version: 1, updated: nowIso(), slots });
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
    slotId: typeof args?.slotId === "string" ? args.slotId : undefined,
    root: typeof args?.root === "string" ? args.root : undefined
  };
}
