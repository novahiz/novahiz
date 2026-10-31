/**
 * `novahiz backup`, `novahiz evolution`, `novahiz manifest`.
 *
 * These are the three verbs of the safety net. None of them decides anything on
 * its own: they snapshot, record, and compare. The moment a system starts
 * rewriting itself, these are the commands that let a human see what it did and
 * put it back.
 */
import { type Parsed, asString, confirm, flagOn, numberFlag, print, splitList } from "./context.ts";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type BackupKind,
  backupHealth,
  createBackup,
  isBackupKind,
  listBackups,
  restoreBackup,
  verifyBackup,
} from "../backup.ts";
import { appendEvolution, evolutionHealth, readEvolution, verifyEvolution } from "../evolution.ts";
import { diffManifest, manifestHealth, readManifest, writeManifest } from "../manifest.ts";
import { NovahizHome, packageRoot } from "../spec.ts";
import { resolve } from "node:path";

function usageBackup(): void {
  process.stderr.write(
    [
      "usage:",
      "  novahiz backup create [--kind native|auto-improve|pre-restore] [--note <text>]",
      "  novahiz backup list [--kind <kind>]",
      "  novahiz backup verify [--id <id>]",
      "  novahiz backup restore --id <id> [--yes] [--prune] [--rebuild] [--dry-run]",
      "",
    ].join("\n")
  );
}

function parseKind(value: string | boolean | undefined): BackupKind | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return isBackupKind(value) ? value : null;
}

export function commandBackup(parsed: Parsed): void {
  const sub = parsed.positionals[1] ?? "list";
  const home = NovahizHome();

  if (sub === "create") {
    const requested = asString(parsed.flags.kind) || "auto-improve";
    if (!isBackupKind(requested)) {
      print({ error: `unknown kind "${requested}" (native, auto-improve, pre-restore)` });
      process.exitCode = 2;
      return;
    }
    const meta = createBackup(home, {
      kind: requested,
      note: asString(parsed.flags.note) || undefined,
    });
    print({ created: meta, health: backupHealth(home) });
    return;
  }

  if (sub === "list") {
    const kind = parseKind(parsed.flags.kind);
    const all = listBackups(home);
    const backups = kind ? all.filter((meta) => meta.kind === kind) : all;
    print({ home, count: backups.length, backups });
    return;
  }

  if (sub === "verify") {
    const id = asString(parsed.flags.id);
    const targets = id ? listBackups(home).filter((meta) => meta.id === id) : listBackups(home);
    if (id && targets.length === 0) {
      print({ error: `unknown backup: ${id}` });
      process.exitCode = 1;
      return;
    }
    const results = targets.map((meta) => verifyBackup(home, meta.id));
    const failed = results.filter((result) => !result.ok).length;
    print({ home, checked: results.length, failed, results });
    if (failed > 0) process.exitCode = 1;
    return;
  }

  if (sub === "restore") {
    const id = asString(parsed.flags.id);
    if (!id) {
      usageBackup();
      process.exitCode = 2;
      return;
    }
    const dryRun = flagOn(parsed, "dry-run");
    if (!dryRun && !flagOn(parsed, "yes") && !confirm(`Restaurer ${id} par-dessus ${home} ?`)) {
      print({ restored: false, reason: "declined (pass --yes to run non-interactively)" });
      return;
    }
    const result = restoreBackup(home, id, { dryRun, prune: flagOn(parsed, "prune") });
    // `dist/` is never snapshotted because it is rebuilt. When it exists, the
    // restored sources and the emitted build disagree until it is rebuilt, so
    // the restore says so; `--rebuild` does it with the local compiler, no shell.
    let rebuild: { ran: boolean; ok: boolean; detail: string } | null = null;
    if (result.ok && !dryRun && flagOn(parsed, "rebuild")) {
      const tsc = join(home, "node_modules", "typescript", "bin", "tsc");
      if (!existsSync(tsc)) {
        rebuild = { ran: false, ok: false, detail: "typescript absent de node_modules : rebuild impossible" };
      } else {
        const run = spawnSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
          cwd: home,
          encoding: "utf8",
          timeout: 300_000,
          windowsHide: true,
        });
        rebuild = {
          ran: true,
          ok: run.status === 0,
          detail: run.status === 0 ? "dist reconstruit" : String(run.stderr ?? "").slice(-400),
        };
      }
    }
    print({ ...result, rebuild });
    if (!result.ok || (rebuild && rebuild.ran && !rebuild.ok)) process.exitCode = 1;
    return;
  }

  usageBackup();
  process.exitCode = 2;
}

function usageEvolution(): void {
  process.stderr.write(
    [
      "usage:",
      "  novahiz evolution list [--limit <n>] [--kind <kind>]",
      "  novahiz evolution append --kind <k> --target <t> --reason <sentence>",
      "                           [--provenance native|learned|user] [--verdict proposed|applied|verified|rolled-back|rejected]",
      "                           [--before <value>] [--after <value>] [--evidence id1,id2] [--rollback-to <id>] [--note <text>]",
      "  novahiz evolution verify",
      "",
    ].join("\n")
  );
}

export function commandEvolution(parsed: Parsed): void {
  const sub = parsed.positionals[1] ?? "list";
  const home = NovahizHome();

  if (sub === "append") {
    try {
      const entry = appendEvolution(home, {
        kind: asString(parsed.flags.kind),
        target: asString(parsed.flags.target),
        reason: asString(parsed.flags.reason),
        provenance: (asString(parsed.flags.provenance) || "user") as "native" | "learned" | "user",
        verdict: (asString(parsed.flags.verdict) || "applied") as
          | "proposed"
          | "applied"
          | "verified"
          | "rolled-back"
          | "rejected",
        before: asString(parsed.flags.before) || null,
        after: asString(parsed.flags.after) || null,
        evidence: splitList(parsed.flags.evidence),
        rollbackTo: asString(parsed.flags["rollback-to"]) || null,
        note: asString(parsed.flags.note),
      });
      print({ appended: entry });
    } catch (error) {
      print({ error: (error as Error).message });
      process.exitCode = 2;
    }
    return;
  }

  if (sub === "list") {
    const kind = asString(parsed.flags.kind);
    const limit = numberFlag(parsed, "limit", { min: 1, integer: true }) ?? 20;
    const { entries, problems } = readEvolution(home);
    const filtered = kind ? entries.filter((entry) => entry.kind === kind) : entries;
    print({
      home,
      count: filtered.length,
      problems,
      entries: filtered.slice(-limit).reverse(),
    });
    return;
  }

  if (sub === "verify") {
    const verdict = verifyEvolution(home);
    print({ home, ...verdict });
    if (!verdict.ok) process.exitCode = 1;
    return;
  }

  usageEvolution();
  process.exitCode = 2;
}

export function commandManifest(parsed: Parsed): void {
  const sub = parsed.positionals[1] ?? "diff";
  const home = NovahizHome();

  if (sub === "sync") {
    const origin = asString(parsed.flags.origin);
    if (origin && origin !== "baseline" && origin !== "package") {
      print({ error: `unknown origin "${origin}" (baseline, package)` });
      process.exitCode = 2;
      return;
    }
    const from = asString(parsed.flags.from);
    if (origin === "package") {
      // Recording "native" digests from the tree you are standing in is a
      // promise you cannot keep: on a source checkout the package IS the home,
      // and the manifest would call today's edits the shipped bytes.
      const pkgRoot = packageRoot();
      const source = from || pkgRoot;
      if (!source) {
        print({ error: "manifest sync --origin package : aucun paquet identifiable (--from <dir> pour le nommer)" });
        process.exitCode = 2;
        return;
      }
      if (resolve(source) === resolve(home)) {
        print({
          error:
            `manifest sync --origin package refuse ${source} : c'est la maison elle-meme. ` +
            `Sur un checkout source, le paquet et l'arbre de travail sont identiques ; ` +
            `utiliser --origin baseline (etat honnete) ou --from <chemin du paquet installe>.`,
        });
        process.exitCode = 2;
        return;
      }
      const manifest = writeManifest(home, { origin: "package", sourceRoot: source });
      print({
        home,
        source,
        manifest: {
          version: manifest.version,
          origin: manifest.origin,
          createdAt: manifest.createdAt,
          files: Object.keys(manifest.files).length,
        },
      });
      return;
    }
    const manifest = writeManifest(home, { origin: origin === "baseline" ? "baseline" : undefined });
    print({
      home,
      manifest: { version: manifest.version, origin: manifest.origin, createdAt: manifest.createdAt, files: Object.keys(manifest.files).length },
    });
    return;
  }

  if (sub === "diff" || sub === "status") {
    const diff = diffManifest(home);
    print({ home, manifest: readManifest(home) ? { present: true } : { present: false }, diff, health: manifestHealth(home) });
    if (!diff.present) process.exitCode = 1;
    return;
  }

  process.stderr.write(
    ["usage:", "  novahiz manifest sync [--origin baseline|package] [--from <dir>]", "  novahiz manifest diff", ""].join("\n")
  );
  process.exitCode = 2;
}
