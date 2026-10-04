// P6: benchmark de la memoire novahiz — ecriture sequentielle, recherche
// plein texte en VARIANTS avant/apres (fold sans cache = l'ancien chemin,
// fold + cache mtime P4, fts + cache P4 via l'index SQLite), et ecriture sous
// concurrence multi-processus (meme racine, meme index). Pas un test: se lance
// a la demande —
//   node --experimental-strip-types tests/bench-memory.ts [--writes 200]
//        [--queries 500] [--procs 4] [--per 25] [--themes 50]
// Fichier hors *.test.ts: npm test ne le decouvre pas (bench = mesure manuelle,
// jamais une gate de temps machine dans la suite). Verifie au passage les
// invariants P1: zero perte (tous les marqueurs presents) et zero echec
// d'enfants (aucun E_LOCK) sous concurrence — exit 1 sinon.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSlots, searchSlots, setSlotTextCacheEnabled, writeEntry } from "../src/memory.ts";

type Args = { writes: number; queries: number; procs: number; per: number; themes: number };

function parseArgs(argv: string[]): Args {
  const value = (name: string, fallback: number): number => {
    const index = argv.indexOf(`--${name}`);
    const parsed = index >= 0 ? Number.parseInt(argv[index + 1] ?? "", 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    writes: value("writes", 200),
    queries: value("queries", 500),
    procs: value("procs", 4),
    per: value("per", 25),
    themes: value("themes", 50)
  };
}

const nowMs = (): number => Number(process.hrtime.bigint() / 1000n) / 1000;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const round = (value: number): number => Math.round(value * 100) / 100;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = mkdtempSync(join(tmpdir(), "novahiz-bench-"));
  const themes = args.themes;
  const report: Record<string, unknown> = {
    env: { node: process.version, platform: process.platform },
    args,
    checks: { zeroLoss: false, childrenExitZero: false, noThrow: true }
  };
  let failed = false;
  try {
    // --- Phase 1: ecriture sequentielle (routage + append + verrou) --------
    const writeLat: number[] = [];
    const writeStart = nowMs();
    for (let i = 0; i < args.writes; i += 1) {
      const opStart = nowMs();
      // Titre = UN SEUL token concatene (benchtheme0..benchtheme49): aucun
      // token partage entre themes => le routage ne fusionne pas, ~1 slot/theme.
      writeEntry({
        root,
        title: `benchtheme${i % themes}`,
        content: `mesure P6 numero ${i} — bloc de charge synthetique ${"x".repeat(200)} fin ${i}`
      });
      writeLat.push(nowMs() - opStart);
    }
    const writeTotalMs = nowMs() - writeStart;
    const sortedWrite = [...writeLat].sort((a, b) => a - b);
    const index = listSlots(root);
    report.write = {
      ops: args.writes,
      slots: index.slots.length,
      totalMs: round(writeTotalMs),
      opsPerSec: round((args.writes / writeTotalMs) * 1000),
      avgMs: round(writeLat.reduce((sum, value) => sum + value, 0) / writeLat.length),
      p50Ms: round(percentile(sortedWrite, 50)),
      p95Ms: round(percentile(sortedWrite, 95)),
      maxMs: round(sortedWrite[sortedWrite.length - 1])
    };

    // --- Phase 2: recherche — variants avant/apres -------------------------
    // Meme corpus, memes requetes: seul le chemin mesuré change. Une passe de
    // prechauffage NON mesure (cache OS, remplissage du cache mtime, premiere
    // synchro FTS de la variante indexee) puis N requetes chronometrees.
    const ftsDb = join(root, "bench.sqlite");
    const variants: Record<string, Record<string, unknown>> = {};
    const measureVariant = (name: string, cache: boolean, fts?: { dbPath: string }): void => {
      setSlotTextCacheEnabled(cache);
      const options = fts ? { limit: 5, fts } : { limit: 5 };
      const warmStart = nowMs();
      searchSlots(root, "benchtheme0 mesure warmup", options);
      const warmupMs = round(nowMs() - warmStart);
      const lat: number[] = [];
      let hitsSum = 0;
      let enginesFts = 0;
      const start = nowMs();
      for (let i = 0; i < args.queries; i += 1) {
        const opStart = nowMs();
        // `numero ${i % writes}`: la requete vise des donnees ecrites (le
        // chemin index est ainsi mesure sur le cas nominal; le repli sur les
        // donnees absentes est couvert par tests/memory-fts.test.ts).
        const result = searchSlots(root, `benchtheme${i % themes} mesure numero ${i % args.writes}`, options);
        lat.push(nowMs() - opStart);
        hitsSum += result.hits.length;
        if (result.engine === "fts") enginesFts += 1;
      }
      const totalMs = nowMs() - start;
      const sorted = [...lat].sort((a, b) => a - b);
      variants[name] = {
        ops: args.queries,
        totalMs: round(totalMs),
        opsPerSec: round((args.queries / totalMs) * 1000),
        avgMs: round(lat.reduce((sum, value) => sum + value, 0) / lat.length),
        p50Ms: round(percentile(sorted, 50)),
        p95Ms: round(percentile(sorted, 95)),
        maxMs: round(sorted[sorted.length - 1]),
        avgHits: round(hitsSum / args.queries),
        warmupMs,
        cache,
        enginesFts
      };
    };
    // Ordre: l'index d'abord (sa synchro tombe dans son warmup mesure), les
    // lectures fichiers ensuite — meme cache OS chaud pour toutes.
    measureVariant("fts+cache", true, { dbPath: ftsDb });
    measureVariant("fold+cache", true);
    measureVariant("fold", false); // avant P4: readFileSync a chaque requete
    setSlotTextCacheEnabled(true);
    // Garde-fou: une variante a 0 hit signifierait un recall casse.
    const hitsPositive =
      (variants["fold"].avgHits as number) > 0 &&
      (variants["fold+cache"].avgHits as number) > 0 &&
      (variants["fts+cache"].avgHits as number) > 0;
    if (!hitsPositive) failed = true;
    report.search = { slots: index.slots.length, variants, hitsPositive };

    // --- Phase 3: concurrence multi-processus (N sessions, meme racine) ----
    const srcUrl = new URL("../src/memory.ts", import.meta.url).href;
    // Script dans root: le rmSync final nettoie aussi ce fichier temporaire.
    const childScript = join(root, "bench-child.mjs");
    writeFileSync(
      childScript,
      [
        `import { writeEntry } from ${JSON.stringify(srcUrl)};`,
        "const [root, tag, count] = process.argv.slice(2);",
        "for (let i = 0; i < Number(count); i += 1) {",
        "  writeEntry({",
        "    root,",
        "    title: `bench concurrence`,",
        "    content: `bench-marker-${tag}-${i} charge concurrente unique ${'y'.repeat(160)}`",
        "  });",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );
    const concStart = nowMs();
    const children = Array.from({ length: args.procs }, (_, p) =>
      spawn(
        process.execPath,
        ["--experimental-strip-types", childScript, root, `p${p}`, String(args.per)],
        { stdio: ["ignore", "ignore", "pipe"] }
      )
    );
    const exits = await Promise.all(
      children.map(
        (child) =>
          new Promise<{ code: number | null; stderr: string }>((resolveExit) => {
            let stderr = "";
            child.stderr?.on("data", (chunk: Buffer) => {
              stderr += chunk.toString();
            });
            child.on("exit", (code) => resolveExit({ code, stderr }));
            child.on("error", (error) => resolveExit({ code: -1, stderr: String(error) }));
          })
      )
    );
    const concTotalMs = nowMs() - concStart;
    const childrenExitZero = exits.every((exit) => exit.code === 0);
    report.concurrency = {
      procs: args.procs,
      perProc: args.per,
      ops: args.procs * args.per,
      totalMs: round(concTotalMs),
      opsPerSec: round((args.procs * args.per / concTotalMs) * 1000),
      childrenExitZero,
      failures: exits.filter((exit) => exit.code !== 0).map((exit) => exit.stderr.slice(0, 300))
    };

    // Verification zero perte: lecture RECURSIVE de slots/ — la compaction
    // depose ses copies pleines dans slots/archive/ (hors portee d'un readdir
    // non recursif: faux manquant constate le 2026-10-04 sur ce bench).
    const walkMd = (dir: string): string[] => {
      const out: string[] = [];
      if (!existsSync(dir)) return out;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkMd(full));
        else if (entry.name.endsWith(".md")) out.push(full);
      }
      return out;
    };
    const slotsDir = join(root, "slots");
    const blob = walkMd(slotsDir)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const missing: string[] = [];
    for (let p = 0; p < args.procs; p += 1) {
      for (let i = 0; i < args.per; i += 1) {
        if (!blob.includes(`bench-marker-p${p}-${i}`)) missing.push(`bench-marker-p${p}-${i}`);
      }
    }
    report.checks = {
      zeroLoss: missing.length === 0,
      missing: missing.slice(0, 10),
      missingCount: missing.length,
      childrenExitZero,
      noThrow: true
    };
    failed = missing.length > 0 || !childrenExitZero;
  } catch (error) {
    report.checks = { ...(report.checks as Record<string, unknown>), noThrow: false };
    report.error = error instanceof Error ? error.message : String(error);
    failed = true;
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Handle Windows: le dossier peut rester attache un instant, non bloquant.
    }
  }

  const write = report.write as Record<string, number> | undefined;
  const search = report.search as
    | { slots?: number; variants?: Record<string, Record<string, number>>; hitsPositive?: boolean }
    | undefined;
  const conc = report.concurrency as Record<string, unknown> | undefined;
  const checks = report.checks as Record<string, unknown>;
  process.stdout.write("novahiz bench-memory (P6)\n");
  if (write) {
    process.stdout.write(
      `  ecriture:  ${write.ops} ops en ${write.totalMs} ms — ${write.opsPerSec} ops/s (avg ${write.avgMs} ms, p95 ${write.p95Ms} ms, max ${write.maxMs} ms, ${write.slots} slots)\n`
    );
  }
  if (search?.variants) {
    process.stdout.write(`  recherche avant/apres (${search.slots} slots, memes requetes):\n`);
    for (const name of ["fold", "fold+cache", "fts+cache"]) {
      const variant = search.variants[name];
      if (!variant) continue;
      const engine = name.startsWith("fts") ? `, engine fts: ${variant.enginesFts}/${variant.ops}` : "";
      process.stdout.write(
        `    ${name.padEnd(10)} ${variant.opsPerSec} ops/s (avg ${variant.avgMs} ms, p95 ${variant.p95Ms} ms, ${variant.avgHits} hits/req, warmup ${variant.warmupMs} ms${engine})\n`
      );
    }
    const fold = search.variants["fold"];
    const fts = search.variants["fts+cache"];
    if (fold && fts && fts.avgMs > 0) {
      process.stdout.write(
        `    gain fold -> fts+cache: x${round(fold.avgMs / fts.avgMs)} (avg), fold -> fold+cache: x${round(fold.avgMs / Math.max(search.variants["fold+cache"]?.avgMs ?? 1, 0.0001))} (avg)\n`
      );
    }
  }
  if (conc) {
    process.stdout.write(
      `  concurrence: ${conc.procs} x ${conc.perProc} ecritures en ${conc.totalMs} ms — ${conc.opsPerSec} ops/s (enfants OK: ${String(conc.childrenExitZero)})\n`
    );
  }
  process.stdout.write(
    `  invariants: zero perte=${String(checks.zeroLoss)} — zero echec enfant=${String(checks.childrenExitZero)} — sans throw=${String(checks.noThrow)}\n`
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = failed ? 1 : 0;
}

await main();
