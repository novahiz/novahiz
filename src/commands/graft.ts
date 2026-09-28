/**
 * `novahiz graft` — version-control the SQLite ledger via graft.
 *
 * Subcommands: init, log, diff, status, restore, export, commit
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { NovahizHome } from "../spec.ts";
import {
  isGraftAvailable,
  isGraftInitialized,
  initGraft,
  commitGraft,
  getGraftLog,
  getGraftDiff,
  getGraftStatus,
  restoreGraft,
  exportGraft,
} from "../graft.ts";

const HELP = `novahiz graft — version-control the SQLite ledger

Usage:
  novahiz graft init             Initialize graft repository
  novahiz graft log [N]          Show last N commits (default: 20)
  novahiz graft diff             Diff current ledger vs last commit
  novahiz graft status           Show graft status
  novahiz graft restore <hash> [--force]  Restore ledger to a revision (--force required; a backup is written first)
  novahiz graft export <hash> <path> [--force]  Export snapshot as .sqlite (path must stay in the workspace; --force to overwrite)
  novahiz graft commit -m MSG   Manual commit with message
  novahiz graft help             Show this help
`;

function fail(msg: string): void {
  console.error(`error: ${msg}`);
  process.exitCode = 1;
}

export function graftCommand(argv: string[]): void {
  const sub = argv[0] ?? "help";

  if (sub === "help" || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return;
  }

  if (!isGraftAvailable()) {
    fail("graft CLI not found on PATH. Install: npm install -g @eidos.space/graft");
  }

  switch (sub) {
    case "init": {
      const result = initGraft();
      if (result.success) {
        console.log(`ok: ${result.message}`);
      } else {
        fail(result.message);
      }
      break;
    }

    case "log": {
      if (!isGraftInitialized()) {
        fail("graft not initialized. Run: novahiz graft init");
      }
      const limit = parseInt(argv[1] ?? "20", 10) || 20;
      const entries = getGraftLog(limit);
      if (entries.length === 0) {
        console.log("no commits yet");
        return;
      }
      for (const e of entries) {
        console.log(`\x1b[33m${e.hash}\x1b[0m ${e.date}`);
        console.log(`  ${e.message}`);
      }
      break;
    }

    case "diff": {
      if (!isGraftInitialized()) {
        fail("graft not initialized. Run: novahiz graft init");
      }
      const diff = getGraftDiff();
      console.log(diff);
      break;
    }

    case "status": {
      if (!isGraftInitialized()) {
        fail("graft not initialized. Run: novahiz graft init");
      }
      const status = getGraftStatus();
      console.log(status);
      break;
    }

    case "restore": {
      if (!isGraftInitialized()) {
        fail("graft not initialized. Run: novahiz graft init");
      }
      const force = argv.slice(1).includes("--force");
      const rev = argv.slice(1).find((a) => a !== "--force");
      if (!rev) {
        fail("usage: novahiz graft restore <revision> [--force]");
        return;
      }
      const result = restoreGraft(rev, { force });
      if (result.success) {
        console.log(`ok: ${result.message}`);
      } else {
        fail(result.message);
      }
      break;
    }

    case "export": {
      if (!isGraftInitialized()) {
        fail("graft not initialized. Run: novahiz graft init");
      }
      const rest = argv.slice(1).filter((a) => a !== "--force");
      const force = argv.slice(1).includes("--force");
      const rev = rest[0];
      const outPath = rest[1];
      if (!rev || !outPath) {
        fail("usage: novahiz graft export <revision> <output-path> [--force]");
        return;
      }
      const result = exportGraft(rev, outPath, { force });
      if (result.success) {
        console.log(`ok: ${result.message}`);
      } else {
        fail(result.message);
      }
      break;
    }

    case "commit": {
      if (!isGraftInitialized()) {
        fail("graft not initialized. Run: novahiz graft init");
      }
      // Parse -m flag
      let msg = "";
      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === "-m" && argv[i + 1]) {
          msg = argv[i + 1];
          break;
        }
      }
      if (!msg) {
        fail("usage: novahiz graft commit -m <message>");
      }
      const result = commitGraft(msg);
      if (result) {
        console.log(`[${result.hash}] ${result.message}`);
      } else {
        console.log("nothing to commit");
      }
      break;
    }

    default:
      fail(`unknown subcommand: ${sub}. Use 'novahiz graft help'`);
  }
}
