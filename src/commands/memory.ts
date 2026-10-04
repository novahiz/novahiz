// P5: `novahiz memory status | clean | prune` — hygiene de la memoire projet.
// Decision validee: dry-run PAR DEFAUT sur clean/prune (execution = --apply).
// GC sans destruction: prune ARCHIVE les slots vecilles (archiveSlot), DEPLACE
// les copies pre-compaction hors retention vers slots/archive/retention/, et
// clean ne retire que de la ferraille (.lock perime, failed-*.json de la file,
// fragments .tmp d'ecriture atomique interrompue) puis reconstruit l'index —
// un fichier slots est lu, reinindexe, archive ou deplace, jamais supprime.
// Doublons inter-slots (Resume + Details strictement identiques): le plus
// ancien est conserve, le plus recent est archive. Decay: slot actif dont la
// derniere touche (last_read / updated / created) depasse --decay jours est
// archive — "jamais lu depuis N jours". status est strictement en lecture:
// ni ecriture, ni heal cache (le heal appartient aux appels memory_*).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { emit, flagOn, type Parsed } from "./context.ts";
import {
  archiveSlot,
  indexPath,
  readIndex,
  readSlot,
  rebuildIndex,
  resolveMemoryDir,
  SLOTS_DIR,
  slotsDir,
  type SlotMeta
} from "../memory.ts";

const DAY_MS = 86_400_000;
const PENDING_DIR = ".pending";
const LOCK_FILE = ".lock";

function resolveRoot(parsed: Parsed): { dir: string; layout: string } {
  const raw = typeof parsed.flags.root === "string" && parsed.flags.root.length > 0 ? parsed.flags.root : undefined;
  // Un --root explicite est un choix de l'humain: son propre dossier sert de
  // reference de workspace (regles 2-5 identiques au MCP). La restriction
  // E_ROOT ne vaut que pour le defaut cwd, comme cote MCP.
  return raw ? resolveMemoryDir(raw, raw) : resolveMemoryDir(undefined, process.cwd());
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = existe mais appartient a un autre utilisateur: vivant.
    return (error as { code?: string }).code === "EPERM";
  }
}

type DiskScan = { files: string[]; readable: string[]; unreadable: string[] };

function scanDisk(root: string): DiskScan {
  const dir = slotsDir(root);
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")).sort() : [];
  const readable: string[] = [];
  const unreadable: string[] = [];
  for (const name of files) {
    try {
      readFileSync(join(dir, name), "utf8");
      readable.push(name);
    } catch {
      unreadable.push(name);
    }
  }
  return { files, readable, unreadable };
}

type PendingInfo = { entries: number; failed: number; failedNames: string[] };

function readPending(root: string): PendingInfo {
  const dir = join(root, PENDING_DIR);
  if (!existsSync(dir)) return { entries: 0, failed: 0, failedNames: [] };
  const names = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
  const failedNames = names.filter((name) => name.startsWith("failed-"));
  return { entries: names.length - failedNames.length, failed: failedNames.length, failedNames };
}

type LockInfo = { present: boolean; pid: number | null; ageMs: number | null; stale: boolean; reason: string };

function inspectLock(root: string): LockInfo {
  const file = join(root, LOCK_FILE);
  if (!existsSync(file)) return { present: false, pid: null, ageMs: null, stale: false, reason: "absent" };
  let rawText = "";
  try {
    rawText = readFileSync(file, "utf8");
  } catch {
    return { present: true, pid: null, ageMs: null, stale: true, reason: "verrou illisible" };
  }
  const lines = rawText.split(/\r?\n/);
  const pid = Number.parseInt(lines[0] ?? "", 10);
  const ts = Number.parseInt(lines[1] ?? "", 10);
  const ageMs = Number.isFinite(ts) && ts > 0 ? Date.now() - ts : null;
  if (!Number.isFinite(pid) || pid <= 0) {
    return { present: true, pid: null, ageMs, stale: true, reason: "verrou sans pid valide" };
  }
  if (!pidAlive(pid)) return { present: true, pid, ageMs, stale: true, reason: `pid ${pid} mort` };
  return { present: true, pid, ageMs, stale: false, reason: `pid ${pid} actif` };
}

type IndexProbe =
  | { state: "absent" }
  | { state: "corrompu" }
  | { state: "sain"; updated: string; slots: SlotMeta[] };

// Lecture pure, sans heal: status/clean planifient, ils n'ecrivent pas.
function probeIndex(root: string): IndexProbe {
  if (!existsSync(indexPath(root))) return { state: "absent" };
  try {
    const index = readIndex(root);
    return { state: "sain", updated: index.updated, slots: index.slots };
  } catch {
    return { state: "corrompu" };
  }
}

function divergence(root: string, probe: IndexProbe, disk: DiskScan): { orphans: string[]; ghosts: string[] } {
  if (probe.state !== "sain") return { orphans: [], ghosts: [] };
  const indexed = new Set(probe.slots.map((slot) => slot.file));
  const orphans = disk.readable.filter((name) => !indexed.has(join(SLOTS_DIR, name)));
  const ghosts = probe.slots.filter((slot) => !existsSync(join(root, slot.file))).map((slot) => slot.id);
  return { orphans, ghosts };
}

// --- status: rapport en lecture seule --------------------------------------
function memoryStatus(parsed: Parsed): void {
  const { dir, layout } = resolveRoot(parsed);
  const exists = existsSync(dir);
  const probe = probeIndex(dir);
  const disk = exists ? scanDisk(dir) : { files: [], readable: [], unreadable: [] };
  const lock = exists
    ? inspectLock(dir)
    : { present: false, pid: null, ageMs: null, stale: false, reason: "memoire absente" };
  const pending = exists ? readPending(dir) : { entries: 0, failed: 0, failedNames: [] };
  const { orphans, ghosts } = divergence(dir, probe, disk);

  const slots =
    probe.state === "sain"
      ? (() => {
          const activeList = probe.slots.filter((slot) => slot.status === "active");
          const archivedList = probe.slots.filter((slot) => slot.status === "archived");
          const biggest = [...probe.slots]
            .sort((a, b) => b.chars - a.chars)
            .slice(0, 3)
            .map((slot) => ({ id: slot.id, chars: slot.chars }));
          return {
            active: activeList.length,
            archived: archivedList.length,
            total: probe.slots.length,
            chars: probe.slots.reduce((sum, slot) => sum + slot.chars, 0),
            lines: probe.slots.reduce((sum, slot) => sum + slot.lines, 0),
            biggest
          };
        })()
      : { active: null, archived: null, total: disk.files.length, chars: null, lines: null, biggest: [] };

  const value = {
    root: dir,
    layout,
    exists,
    index: probe.state === "sain" ? { state: probe.state, updated: probe.updated } : { state: probe.state },
    slots,
    disk: { files: disk.files.length, orphans, ghosts, unreadable: disk.unreadable },
    lock,
    pending: { entries: pending.entries, failed: pending.failed }
  };
  emit(parsed, value, () => {
    const lines: string[] = [];
    lines.push(`memoire: ${dir} (${layout})${exists ? "" : " — absente"}`);
    if (probe.state === "sain") lines.push(`index: sain (maj ${probe.updated})`);
    else if (probe.state === "corrompu") lines.push("index: corrompu — `novahiz memory clean --apply` le reconstruit");
    else lines.push("index: absent");
    if (probe.state === "sain") {
      lines.push(`slots: ${slots.active} actifs, ${slots.archived} archives — ${slots.chars} chars / ${slots.lines} lignes`);
      if (slots.biggest.length > 0) {
        lines.push(`plus gros: ${slots.biggest.map((slot) => `${slot.id} ${slot.chars}c`).join(", ")}`);
      }
    } else {
      lines.push(`slots: index illisible — ${disk.files.length} fichier(s) .md sur disque`);
    }
    const fmt = (list: string[]): string => (list.length > 0 ? list.join(", ") : "aucun");
    lines.push(`disque: ${disk.files.length} .md — orphelins: ${fmt(orphans)} | fantomes: ${fmt(ghosts)} | illisibles: ${fmt(disk.unreadable)}`);
    lines.push(
      `verrou: ${lock.present ? `${lock.reason}${lock.stale ? " (periime)" : ""}` : "absent"} | ` +
        `.pending: ${pending.entries} entree(s), ${pending.failed} echec(s)`
    );
    return lines.join("\n");
  });
}

// --- clean: ferraille + reindexation, dry-run par defaut --------------------
type CleanAction = {
  kind: "lock-stale" | "pending-failed" | "reindex" | "tmp-junk" | "duplicate-slot";
  detail: string;
  result?: string;
  /** duplicate-slot: ids des slots plus recents a archiver (GC: fichier conserve). */
  ids?: string[];
};

/** Fragments d'ecritures atomiques interrompues: <fichier>.tmp ou <fichier>.tmp-<pid>. */
function isTmpFragment(name: string): boolean {
  return /\.tmp(-\d+)?$/.test(name);
}

// P5: la ferraille .tmp ne contient qu'un fichier partiel — retiree comme
// .lock perime, jamais un .md, jamais un contenu ecrit proprement.
function listTmpFragments(dir: string): string[] {
  const out: string[] = [];
  const scan = (base: string, prefix: string): void => {
    if (!existsSync(base)) return;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isFile() && isTmpFragment(entry.name)) out.push(join(prefix, entry.name));
    }
  };
  scan(dir, "");
  scan(slotsDir(dir), SLOTS_DIR);
  return out;
}

type DupGroup = { keep: string; drop: string[] };

// P5 doublons inter-slots: corps (Resume + Details) STRICTEMENT identique —
// double ecriture rejouee (file .pending), jamais de similarite approchee.
// Le plus ancien est conserve, le(s) plus recent(s) est(sont) archive(s).
function planDuplicates(dir: string, slots: SlotMeta[]): DupGroup[] {
  const byBody = new Map<string, SlotMeta[]>();
  for (const slot of slots) {
    if (slot.status !== "active") continue;
    let normalized = "";
    try {
      const file = readSlot(dir, slot);
      normalized = `${file.body.summary}\n\n${file.body.details}`.replace(/\r\n/g, "\n").trim();
    } catch {
      continue; // illisible: deja signale en observation
    }
    if (normalized.length === 0) continue;
    const group = byBody.get(normalized);
    if (group) group.push(slot);
    else byBody.set(normalized, [slot]);
  }
  const groups: DupGroup[] = [];
  for (const group of byBody.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(
      (a, b) => Date.parse(a.created) - Date.parse(b.created) || (a.id < b.id ? -1 : 1)
    );
    groups.push({ keep: ordered[0].id, drop: ordered.slice(1).map((slot) => slot.id) });
  }
  return groups;
}

function planClean(dir: string): { actions: CleanAction[]; observations: string[] } {
  const actions: CleanAction[] = [];
  const observations: string[] = [];
  const lock = inspectLock(dir);
  if (lock.stale) actions.push({ kind: "lock-stale", detail: `.lock periime (${lock.reason})` });
  else if (lock.present) observations.push(`verrou actif conserve (${lock.reason})`);
  const pending = readPending(dir);
  if (pending.failed > 0) {
    actions.push({ kind: "pending-failed", detail: `${pending.failed} failed-*.json dans .pending` });
  }
  if (pending.entries > 0) observations.push(`${pending.entries} entree(s) en file .pending intacte(s) (jamais touchees)`);
  const probe = probeIndex(dir);
  const disk = scanDisk(dir);
  const { orphans, ghosts } = divergence(dir, probe, disk);
  if (probe.state !== "sain") {
    actions.push({ kind: "reindex", detail: `index ${probe.state} — reconstruit depuis les fichiers slots` });
  } else if (orphans.length > 0 || ghosts.length > 0) {
    actions.push({
      kind: "reindex",
      detail: `${orphans.length} orphelin(s) a adopter, ${ghosts.length} fantome(s) a purger`
    });
  }
  if (disk.unreadable.length > 0) {
    observations.push(`slot(s) illisible(s) excludes du scan, jamais supprime(s): ${disk.unreadable.join(", ")}`);
  }
  const slotsPath = slotsDir(dir);
  if (existsSync(slotsPath)) {
    const junk = readdirSync(slotsPath).filter((name) => !name.endsWith(".md") && !isTmpFragment(name)).sort();
    if (junk.length > 0) observations.push(`fichier(s) non-.md dans slots/ laisses en place: ${junk.join(", ")}`);
  }
  const tmpFiles = listTmpFragments(dir);
  if (tmpFiles.length > 0) {
    actions.push({
      kind: "tmp-junk",
      detail: `${tmpFiles.length} fragment(s) .tmp d'ecriture interrompue: ${tmpFiles.join(", ")}`
    });
  }
  if (probe.state === "sain") {
    for (const dup of planDuplicates(dir, probe.slots)) {
      actions.push({
        kind: "duplicate-slot",
        detail: `${dup.drop.join(", ")} — corps identique de ${dup.keep} (double ecriture?) => archive du plus recent`,
        ids: dup.drop
      });
    }
  }
  return { actions, observations };
}

function memoryClean(parsed: Parsed): void {
  const { dir } = resolveRoot(parsed);
  const apply = flagOn(parsed, "apply");
  if (!existsSync(dir)) {
    emit(parsed, { root: dir, apply, exists: false, actions: [], observations: ["memoire absente — rien a nettoyer"], changed: 0 }, () =>
      `memoire absente: ${dir} — rien a nettoyer`
    );
    return;
  }
  const { actions, observations } = planClean(dir);
  const changed: string[] = [];
  const errors: string[] = [];
  if (apply) {
    for (const action of actions) {
      try {
        if (action.kind === "lock-stale") {
          unlinkSync(join(dir, LOCK_FILE));
          action.result = "verrou retire";
        } else if (action.kind === "pending-failed") {
          let count = 0;
          for (const name of readPending(dir).failedNames) {
            unlinkSync(join(dir, PENDING_DIR, name));
            count += 1;
          }
          action.result = `${count} fichier(s) retire(s)`;
        } else if (action.kind === "tmp-junk") {
          let count = 0;
          for (const rel of listTmpFragments(dir)) {
            unlinkSync(join(dir, rel));
            count += 1;
          }
          action.result = `${count} fragment(s) .tmp retire(s)`;
        } else if (action.kind === "duplicate-slot") {
          let count = 0;
          for (const id of action.ids ?? []) {
            const result = archiveSlot(id, dir);
            if (result.changed) count += 1;
          }
          action.result = `${count} doublon(s) archive(s), fichier(s) conserve(s)`;
        } else {
          const rebuilt = rebuildIndex(dir);
          action.result = `index reconstruit (${rebuilt.slots.length} slots${rebuilt.warnings ? `, ${rebuilt.warnings.length} warning(s)` : ""})`;
        }
        changed.push(action.kind);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        action.result = `echec: ${message.slice(0, 160)}`;
        errors.push(`${action.kind}: ${message.slice(0, 160)}`);
      }
    }
  }
  if (errors.length > 0) process.exitCode = 1;
  const value = {
    root: dir,
    apply,
    actions: actions.map((action) => ({ kind: action.kind, detail: action.detail, result: action.result ?? null })),
    observations,
    changed: changed.length,
    errors
  };
  emit(parsed, value, () => {
    const head = apply ? "clean (apply):" : "clean (dry-run — ajouter --apply pour executer):";
    const lines = [head];
    for (const action of actions) {
      lines.push(`  - ${action.detail}${action.result ? ` => ${action.result}` : apply ? "" : ""}`);
    }
    for (const note of observations) lines.push(`  observe: ${note}`);
    if (actions.length === 0) lines.push("  rien a faire");
    else if (!apply) lines.push(`  ${actions.length} action(s) a executer (dry-run)`);
    else lines.push(`  ${changed.length} action(s) effectuee(s)`);
    return lines.join("\n");
  });
}

// --- prune: archivage par age + retention + decay, dry-run par defaut -------
function memoryPrune(parsed: Parsed): void {
  const { dir } = resolveRoot(parsed);
  const apply = flagOn(parsed, "apply");
  const numFlag = (name: string, fallback: number): number => {
    const raw = typeof parsed.flags[name] === "string" ? Number.parseInt(parsed.flags[name], 10) : NaN;
    return Number.isFinite(raw) && raw >= 1 && raw <= 36500 ? raw : fallback;
  };
  const days = numFlag("days", 30);
  const retention = numFlag("retention", 90);
  const decay = numFlag("decay", 90);
  const probe = probeIndex(dir);
  if (probe.state !== "sain") {
    process.stderr.write(
      `novahiz memory prune: index ${probe.state} — lancer d'abord \`novahiz memory clean --apply\`\n`
    );
    process.exitCode = 1;
    return;
  }
  const now = Date.now();
  const cutoff = now - days * DAY_MS;
  // --days: actif dont la derniere USE — derniere lecture (last_read) ou
  // derniere ecriture (updated) — est vieille de `days`: une consultation
  // recente prolonge la vie du slot.
  const lastUseOf = (slot: SlotMeta): number =>
    Math.max(
      Number.isFinite(Date.parse(slot.updated)) ? Date.parse(slot.updated) : 0,
      Number.isFinite(Date.parse(slot.last_read ?? "")) ? Date.parse(slot.last_read ?? "") : 0
    );
  const ageCandidates = probe.slots.filter(
    (slot) => slot.status === "active" && lastUseOf(slot) > 0 && lastUseOf(slot) < cutoff
  );
  // --decay (P5): "jamais lu" — actif sans AUCUNE consultation tracee
  // (last_read absent) dont ecriture ET creation depassent `decay`. Peut
  // chevaucher --days (meme cible listee deux fois, archivage unique via
  // l'unicite de toArchive ci-dessous).
  const decayCutoff = now - decay * DAY_MS;
  const staleSince = (slot: SlotMeta): number => {
    const updated = Date.parse(slot.updated);
    const created = Date.parse(slot.created);
    return Math.max(Number.isFinite(updated) ? updated : 0, Number.isFinite(created) ? created : 0);
  };
  const decayCandidates = probe.slots.filter(
    (slot) => slot.status === "active" && !slot.last_read && staleSince(slot) < decayCutoff
  );
  const touchOf = (slot: SlotMeta): number => {
    const values = [Date.parse(slot.last_read ?? ""), Date.parse(slot.updated), Date.parse(slot.created)]
      .filter((value) => Number.isFinite(value));
    return values.length > 0 ? Math.max(...values) : 0;
  };
  // --retention (P5): copies pre-compaction de slots/archive/ plus vieilles que
  // `retention` — DEPLACEES vers slots/archive/retention/. Ces fichiers ne sont
  // jamais dans l'index (scan non recursif): le deplacement ne casse aucune
  // reference, et le contenu reste intact (GC: archiver, pas detruire).
  const retentionCutoff = now - retention * DAY_MS;
  const archiveDir = join(slotsDir(dir), "archive");
  const retentionFiles: { name: string; ageDays: number }[] = [];
  if (existsSync(archiveDir)) {
    for (const entry of readdirSync(archiveDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue; // sous-dossier retention/ ignore
      try {
        const mtime = statSync(join(archiveDir, entry.name)).mtimeMs;
        if (mtime < retentionCutoff) {
          retentionFiles.push({ name: entry.name, ageDays: Math.floor((now - mtime) / DAY_MS) });
        }
      } catch {
        // Fichier disparu entre readdir et stat: ignore.
      }
    }
  }

  const seenIds = new Set<string>();
  const toArchive = [...ageCandidates, ...decayCandidates].filter((slot) => {
    if (seenIds.has(slot.id)) return false;
    seenIds.add(slot.id);
    return true;
  });
  const archived: string[] = [];
  const moved: string[] = [];
  const errors: string[] = [];
  if (apply) {
    for (const slot of toArchive) {
      try {
        const result = archiveSlot(slot.id, dir);
        if (result.changed) archived.push(slot.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${slot.id}: ${message.slice(0, 160)}`);
      }
    }
    if (retentionFiles.length > 0) {
      try {
        mkdirSync(join(archiveDir, "retention"), { recursive: true });
        for (const file of retentionFiles) {
          renameSync(join(archiveDir, file.name), join(archiveDir, "retention", file.name));
          moved.push(file.name);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`retention: ${message.slice(0, 160)}`);
      }
    }
  }
  if (errors.length > 0) process.exitCode = 1;
  const value = {
    root: dir,
    apply,
    days,
    cutoff: new Date(cutoff).toISOString(),
    candidates: ageCandidates.map((slot) => ({
      id: slot.id,
      updated: slot.updated,
      ageDays: Math.floor((now - Date.parse(slot.updated)) / DAY_MS)
    })),
    decay: {
      days: decay,
      cutoff: new Date(decayCutoff).toISOString(),
      candidates: decayCandidates.map((slot) => ({ id: slot.id, title: slot.title })),
      archived: archived.filter((id) => decayCandidates.some((slot) => slot.id === id))
    },
    retention: {
      days: retention,
      cutoff: new Date(retentionCutoff).toISOString(),
      files: retentionFiles.map((file) => ({ name: file.name, ageDays: file.ageDays })),
      moved
    },
    archived,
    errors
  };
  emit(parsed, value, () => {
    const head = apply ? "prune (apply):" : "prune (dry-run — ajouter --apply pour executer):";
    const lines = [head];
    for (const slot of ageCandidates) {
      const age = Math.floor((now - Date.parse(slot.updated)) / DAY_MS);
      const result = apply ? (archived.includes(slot.id) ? " => archive" : " => echec") : "";
      lines.push(`  - ${slot.id} (maj ${slot.updated.slice(0, 10)}, ${age} jours)${result}`);
    }
    if (ageCandidates.length === 0) lines.push(`  aucun actif plus vieux que ${days} jour(s)`);
    else if (!apply) lines.push(`  ${ageCandidates.length} slot(s) a archiver (dry-run)`);
    else lines.push(`  ${archived.length} slot(s) archive(s) — aucun fichier supprime (GC: archiver, pas detruire)`);
    for (const slot of decayCandidates) {
      const result = apply ? (archived.includes(slot.id) ? " => archive" : " => echec") : "";
      lines.push(`  - decay ${slot.id} (derniere touche ${new Date(touchOf(slot)).toISOString().slice(0, 10)})${result}`);
    }
    if (decayCandidates.length > 0 && !apply) {
      lines.push(`  ${decayCandidates.length} slot(s) sans touche depuis ${decay} jour(s) a archiver (dry-run)`);
    }
    for (const file of retentionFiles) {
      const result = apply ? (moved.includes(file.name) ? " => deplace" : " => echec") : "";
      lines.push(`  - retention slots/archive/${file.name} (${file.ageDays} jours)${result}`);
    }
    if (retentionFiles.length > 0 && !apply) {
      lines.push(`  ${retentionFiles.length} archive(s) hors retention ${retention} jour(s) a deplacer (dry-run)`);
    }
    return lines.join("\n");
  });
}

export function memoryCommand(argv: string[], parsed: Parsed): void {
  const sub = argv[0] ?? "status";
  switch (sub) {
    case "status":
      memoryStatus(parsed);
      return;
    case "clean":
      memoryClean(parsed);
      return;
    case "prune":
      memoryPrune(parsed);
      return;
    default:
      process.stderr.write(`novahiz memory: unknown subcommand "${sub}" (status | clean | prune)\n`);
      process.exitCode = 1;
  }
}
