#!/usr/bin/env node
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { dirname, resolve, sep } from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { classify, annotateRoadmap } from "../../src/classify.ts";
import { loadSpec } from "../../src/spec.ts";
import { loadCatalog, loadInstalledSkills } from "../../src/catalog.ts";
import { rankSkills } from "../../src/relevance.ts";
import { openDb } from "../../src/db.ts";
import { capture, diffSnapshots, listSnapshots, loadManifest, matchingIds, restoreSnapshot, snapStatus } from "../../src/snap.ts";
import { graphFileApi, graphFind, graphFindAll, graphFreshness, graphRepoMap, graphTrace } from "../../src/graph/query.ts";
import { enabledProviders } from "../../src/providers.ts";
import { dependencyReport } from "../../src/deps.ts";
import { attachScreen, createScreen, createSection, createSections, initWireframes, listScreens, markStatus, planSections, rebuildIndex as rebuildWireframeIndex, reviewScreen } from "../../src/wireframe.ts";
import { activeTask, addTodos, amendTodo, blockTodo, buildWorkPackets, closeStepsFor, closeTask, completeTodo, createTask, dropTask, dropTodo, getTask, getTodo, insertTodo, ledgerSummary, listTodos, openTodoIds, parseReviewDiff, planHistory, recordTodoDone, reorderTodos, resume, reviewDue, reviewTask, revisionSignals, startTodo } from "../../src/ledger.ts";
import { DEFAULT_LIMIT_CHARS, DEFAULT_LIMIT_LINES, archiveSlot, ensureMemoryRoot, getSlot, listSlots, parseSlotInput, rebuildFts, rebuildIndex, recordSlotVerification, resolveMemoryDir, searchSlots, touchSlotRead, updateSlot, writeEntry } from "../../src/memory.ts";
import { listEvidence, projectKey, runVerification } from "../../src/evidence.ts";
import { activeSessionsOnProject, defaultSessionForProject, worktreeHint } from "../../src/sessions.ts";
import { buildSkillpack } from "../../src/skillpack.ts";
import { claimPaths, listClaims, releasePaths } from "../../src/claims.ts";
import { recordSessionLink } from "../../src/lineage.ts";
import { createBackup, listBackups, restoreBackup, verifyBackup } from "../../src/backup.ts";
import { applyProposal, detect, listProposals, readProposal, sampleDb, setProposalStatus, writeProposal } from "../../src/improve.ts";
import { applyRepair, repair } from "../../src/repair.ts";
import { autoImproveState } from "../../src/autoimprove.ts";

// --- P1 degradation gracieuse: la memoire ne bloque jamais l'agent ---------
// Le schema annonce la racine projet ou le dossier memoire (canonique
// prioritaire, ancien layout legacy accepte) — la resolution vit dans le coeur
// (resolveMemoryDir, src/memory.ts) pour rester testable. Quand root pointe
// HORS workspace, l'appel n'echoue pas: il degrade vers la memoire du
// workspace (jamais d'ecriture hors workspace) et l'info part en reponse via
// decorate(). Retourne le DOSSIER MEMOIRE resolu, jamais le projet tel quel.
let degradedRoot = null;
let lastDrain = null;

function safeMemoryRoot(raw) {
  try {
    return resolveMemoryDir(raw, process.cwd()).dir;
  } catch (error) {
    if (error?.code !== "E_ROOT") throw error;
    const fallback = resolveMemoryDir(undefined, process.cwd()).dir;
    degradedRoot = { root: fallback, reason: String(error?.message ?? error) };
    return fallback;
  }
}

// File .pending: quand le verrou racine est encore pris apres l'attente longue
// du coeur (10s), l'ecriture est METTEE EN FILE au lieu d'echouer; chaque
// appel memory_* rejoue la file avant sa propre execution. Zero perte, zero
// E_LOCK visible pour l'agent.
const PENDING_DIR = ".pending";

function pendingDir(root) {
  return resolve(root, PENDING_DIR);
}

function enqueuePending(root, name, args) {
  const dir = pendingDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2, 8)}.json`);
  writeFileSync(file, JSON.stringify({ name, args, root, ts: Date.now() }), "utf8");
  return file;
}

let draining = false;

function drainPending(root) {
  if (draining) return { replayed: 0, failed: 0 };
  const dir = pendingDir(root);
  if (!existsSync(dir)) return { replayed: 0, failed: 0 };
  draining = true;
  let replayed = 0;
  let failed = 0;
  try {
    const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
    for (const file of files) {
      const path = resolve(dir, file);
      let entry;
      try {
        entry = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        // Entree illisible: retiree (aucune boucle possible), comptee en echec.
        try { unlinkSync(path); } catch { /* deja partie */ }
        failed += 1;
        continue;
      }
      // Retirer AVANT application: un crash pendant le replay ne rejoue pas
      // en boucle; l'operation est soit appliquee, soit perdue en .failed
      // consultable — jamais appliquee deux fois par accident.
      try { unlinkSync(path); } catch { continue; }
      try {
        callTool(entry.name, entry.args);
        replayed += 1;
      } catch (error) {
        if (error?.code === "E_LOCK") {
          // Verrou toujours pris: on remet l'entree et on arrete le drain.
          try { writeFileSync(path, JSON.stringify(entry), "utf8"); } catch { /* EPERM: perdue, tracee ci-dessous */ }
          break;
        }
        // Echec de l'operation rejouee (slot parti, contenu invalide...):
        // conserve sous failed-*.json pour audit, jamais rejoue en boucle.
        try {
          writeFileSync(resolve(dir, `failed-${file}`), JSON.stringify({ ...entry, error: String(error?.message ?? error) }), "utf8");
        } catch { /* EPERM: tracee en memoire only */ }
        failed += 1;
      }
    }
  } finally {
    draining = false;
  }
  return { replayed, failed };
}

// Attache aux reponses memoire les drapeaux P1: degraded (fallback root) et
// le bilan de drain. Les cles sont omises quand rien a signaler (JSON sans
// champs parasites).
function decorate(result) {
  const info = degradedRoot;
  const drain = lastDrain;
  degradedRoot = null;
  lastDrain = null;
  if (!info && !drain) return result;
  try {
    const text = result?.content?.[0]?.text;
    if (typeof text !== "string") return result;
    const payload = JSON.parse(text);
    if (info) {
      payload.degraded = true;
      payload.degradeReason = info.reason;
      if (payload.root === undefined) payload.root = info.root;
    }
    if (drain && (drain.replayed > 0 || drain.failed > 0)) {
      payload.pendingReplayed = drain.replayed;
      payload.pendingFailed = drain.failed;
    }
    return { ...result, content: [{ ...result.content[0], text: JSON.stringify(payload) }] };
  } catch {
    return result;
  }
}

const SUPPORTED_PROTOCOLS = ["2024-11-05", "2025-06-18"];
const DEFAULT_PROTOCOL = "2024-11-05";
let SERVER_VERSION = "0.0.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  SERVER_VERSION = pkg.version ?? "0.0.0";
} catch { /* keep default */ }
const SERVER_INFO = { name: "novahiz-core", version: SERVER_VERSION };

/*
 * NX-39: one source of truth for the task actions.
 *
 * The schema enum, the tool description and the handler's accept-list used to
 * be three separate literals, and the description had already lost `history`
 * while the enum kept it. They now derive from this list: an action added here
 * is declared everywhere, and the test suite compares the three.
 */
export const TASK_ACTIONS = [
  "new",
  "plan",
  "todo",
  "start",
  "done",
  "block",
  "close",
  "review",
  "amend",
  "insert",
  "drop",
  "reorder",
  "signals",
  "status",
  "resume",
  "current",
  "history",
  "link"
];

export const TASK_TOOL = {
  name: "novahiz_task",
  description: `Drive the durable execution ledger and keep its plan alive. Create a task, add long detailed todos, then start, complete or block them. Revise the plan between steps with review, amend, insert, drop and reorder. An edit or verify todo cannot be completed without proof (free text, or evidence:<id> from novahiz_verify). A task no longer closes itself: close it explicitly once every todo is settled. Actions: ${TASK_ACTIONS.join(", ")}.`,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: TASK_ACTIONS,
        description: "What to do with the ledger."
      },
      title: { type: "string", description: "Task title for action new." },
      category: { type: "string", description: "Category id the task belongs to (action new). Closing the task then requires that category's non-optional roadmap steps to be recorded with novahiz_step." },
      id: { type: "string", description: "Task id (new) or todo/task id (start, done, block, drop)." },
      task: { type: "string", description: "Task id. Defaults to the active task." },
      session: { type: "string", description: "Session id used to scope the active task." },
      projectRoot: { type: "string", description: "Project directory a new task belongs to (action new). Omitted = unscoped legacy task." },
      child: { type: "string", description: "Child session id for action link: records that this session delegated to it, so the gate treats both as one body of work." },
      label: { type: "string", description: "Todo label for action todo." },
      kind: { type: "string", enum: ["read", "edit", "verify", "delegate"], description: "Todo kind." },
      acceptance: { type: "string", description: "Acceptance criterion for the todo." },
      owner: { type: "string", description: "Comma-separated file globs this todo owns." },
      size: { type: "string", enum: ["XS", "S", "M", "L", "XL"], description: "Contract size of the todo." },
      proof: { type: "string", description: "Proof for action done or close. Required for edit and verify todos: the command you ran and its result, or evidence:<id> from novahiz_verify." },
      reason: { type: "string", description: "Reason for action block." },
      limit: { type: "number", description: "Maximum rows for action history (default 50, max 500)." },
      maxIterations: { type: "number", description: "Iteration budget for the todo (default 12)." },
      dependsOn: { type: "array", items: { type: "string" }, description: "Todo ids this todo depends on." },
      position: { type: "string", description: "Insert position for action insert: start, end, or a sequence number." },
      order: { type: "array", items: { type: "string" }, description: "Todo ids in the new order for action reorder." },
      changes: {
        type: "object",
        description: "Plan diff for action review: { additions, amendments, removals, order }."
      },
      todos: {
        type: "array",
        items: { type: "object" },
        description: "Array of todo inputs for action plan."
      }
    },
    required: ["action"]
  }
};

const TOOLS = [
  {
    name: "novahiz_classify",
    description: "Classify a prompt into Novahiz categories and return the skills those categories require.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The user prompt to classify." },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Files the task touches. Path signals (css, migrations, tests, docs) make the classification deterministic on the actual work, not only on the phrasing."
        }
      },
      required: ["prompt"]
    }
  },
  {
    name: "novahiz_list_skills",
    description: "List installed and catalogued skills, optionally filtered by category.",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string", description: "Optional category id." } }
    }
  },
  {
    name: "novahiz_catalog",
    description: "Rank catalogued skills by deterministic lexical relevance to a query.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the task is about." },
        limit: { type: "number", description: "Maximum results (default 10)." }
      },
      required: ["query"]
    }
  },
  {
    name: "novahiz_roadmap",
    description: "Return the execution roadmap for a category or the category a query classifies into.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category id." },
        query: { type: "string", description: "A prompt to classify." }
      }
    }
  },
  {
    name: "novahiz_providers",
    description: "List the MCP providers registered in Novahiz, optionally for a category or a prompt.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category id." },
        query: { type: "string", description: "A prompt to classify." }
      }
    }
  },
  {
    name: "novahiz_deps",
    description: "Report dependency health: toolchain (node, npm, npx, uv, python), provider prerequisites, local MCP entrypoints and npm home health.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "novahiz_step",
    description:
      "Record that a roadmap step of the current pipeline is done, so a restart or a new session resumes at the right step instead of replaying the whole roadmap. Scope defaults to the current project; pass session to scope it to one agent session. Call it right after finishing a step, with the step id printed by novahiz_roadmap. Without done, it lists what is already recorded.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session to scope the progress to. Omitted = the current project." },
        done: { type: "string", description: "Roadmap step id to mark done, as printed by novahiz_roadmap (plan, clarify, task, analyse, implement, converge…)." },
        drop: { type: "string", description: "Roadmap step id to mark not applicable, with a reason. A dropped step no longer blocks close. Use it when a roadmap step does not fit the work (wireframe for a pure code change)." },
        reason: { type: "string", description: "Why the step is dropped. Required with drop." }
      }
    }
  },
  {
    name: "novahiz_skillpack",
    description:
      "Compact map of a category's skills: one line of purpose plus headings and bullet rules per skill, capped. Read it before loading a dozen SKILL.md files. It does not replace skill(): the gate still requires the real load. Returns what is already loaded for this session and what remains.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Category id, e.g. design-ui or debug." },
        skills: { type: "array", items: { type: "string" }, description: "Explicit skill ids instead of a category." },
        maxChars: { type: "number", description: "Character budget for the whole pack (default 12000)." },
        session: { type: "string", description: "Session used to report what is already loaded." }
      }
    }
  },
  TASK_TOOL,
  {
    name: "novahiz_verify",
    description:
      "Run a verification command declared by the project in .novahiz/verify.json and record what actually happened (exit code, output tail, duration, hash). Use it to back a proof instead of asserting a result. Only names declared in that file can run: this is not a general shell.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Declared command name, e.g. tests or typecheck." },
        session: { type: "string", description: "Session id stored with the evidence." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds (default 120000, max 600000)." },
        expect: { type: "string", description: "Optional substring the output must contain for ok=true." },
        projectRoot: { type: "string", description: "Project directory holding .novahiz/verify.json. Defaults to the server cwd." }
      },
      required: ["name"]
    }
  },
  {
    name: "novahiz_evidence",
    description:
      "List the verification records stored for this workspace: name, command, exit code, hash and when it ran.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum rows (default 20, max 200)." },
        session: { type: "string", description: "Only this session's evidence." }
      }
    }
  },
  {
    name: "novahiz_claim",
    description:
      "Reserve file paths for this session before editing them, so a concurrent session cannot silently write the same files. The gate refuses an edit on a path another live session holds. Actions: claim, release, list.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["claim", "release", "list"], description: "What to do with the claims." },
        session: { type: "string", description: "Session id owning the claim (required for claim and release)." },
        paths: { type: "array", items: { type: "string" }, description: "Files to claim or release." },
        ttlMinutes: { type: "number", description: "Claim lifetime in minutes (default 30, max 240)." },
        reason: { type: "string", description: "Why this session holds these paths." }
      },
      required: ["action"]
    }
  },
  {
    name: "novahiz_backup",
    description:
      "Versioned snapshots of the Novahiz home, verified by SHA-256. create takes a snapshot (kind native = baseline before any self-improvement, never pruned; auto-improve = newest two kept; pre-restore = automatic before a restore). verify re-hashes every stored file. restore refuses to write when the snapshot fails its own verification, snapshots the current state first, and needs confirm equal to the backup id. It also reports needsRebuild: dist/ is rebuilt, never snapshotted.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "verify", "restore"], description: "What to do." },
        kind: { type: "string", enum: ["native", "auto-improve", "pre-restore"], description: "Snapshot kind (create, or filter for list)." },
        id: { type: "string", description: "Snapshot id (verify, restore)." },
        note: { type: "string", description: "Why this snapshot exists (create)." },
        confirm: { type: "string", description: "Restore only: must equal id, after reading what the snapshot holds." },
        prune: { type: "boolean", description: "Restore only: also delete system files the snapshot does not hold. Destructive, off by default." }
      },
      required: ["action"]
    }
  },
  {
    name: "novahiz_improve",
    description:
      "Self-observation, not self-modification. scan reads the ledger and writes proposals for three measurable things: sessions stuck in the fallback category (3+), a required skill loaded 3+ times that produced no edit and no proof, and the same verification failing 3+ times. apply accepts exactly one mechanical kind (unused-skill -> advisory) and needs confirm equal to the proposal id; it snapshots, patches, re-reads the disk, replays the recorded prompts through the classifier and the gate, and rolls back on any drift. reopen reverses a dismissal. NOVAHIZ_AUTOIMPROVE=off disables scan and apply.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["scan", "list", "show", "dismiss", "apply", "reopen"], description: "What to do." },
        dry: { type: "boolean", description: "scan: return candidates without writing proposals." },
        status: { type: "string", enum: ["proposed", "applied", "dismissed", "rejected"], description: "list: filter by status." },
        id: { type: "string", description: "Proposal id (show, dismiss, apply)." },
        reason: { type: "string", description: "dismiss: why it is not acted on." },
        confirm: { type: "string", description: "apply only: must equal id, after reading the proposal." }
      },
      required: ["action"]
    }
  },
  {
    name: "novahiz_repair",
    description:
      "Automatic repair on a closed whitelist: skills index (rebuilt), missing native baseline (created), missing manifest (only when no snapshot can contradict it). Ledger integrity is reported, never fixed in place. Every fix is re-checked afterwards. report by default; apply:true fixes what the whitelist names. Never touches catalog/, src/, rules, the gate or the classifier.",
    inputSchema: {
      type: "object",
      properties: {
        apply: { type: "boolean", description: "Apply the whitelisted fixes instead of reporting only." },
        id: { type: "string", description: "Fix a single check by id: skills-index, ledger-integrity, backup-missing, manifest-missing." }
      }
    }
  },
  {
    name: "novahiz_dispatch",
    description: "Turn the active task's pending todos into work packets for subagents, each with an objective, owned files, exit criteria and budget. Reports file-ownership conflicts.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Task id. Defaults to the active task." },
        session: { type: "string", description: "Session id used to scope the active task." }
      }
    }
  },
  {
    name: "memory_write",
    description: "Append a dated entry into project-memory under project-memory/slots. Picks the related active slot by title, tags or token overlap; rotates (compact, archive, new slot) when full (8000 chars / 200 lines). Pass verify to attach the name of a .novahiz/verify.json command that proves the entry.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short entry title." },
        content: { type: "string", description: "Markdown body for Détails." },
        description: { type: "string", description: "Slot description when creating." },
        tags: { type: "array", items: { type: "string" } },
        verify: { type: "string", description: "Name of a command declared in .novahiz/verify.json that proves this entry. memory_verify replays it and records the verdict." },
        slotId: { type: "string", description: "Force a target slot id instead of relatedness." },
        root: { type: "string", description: "Project root or memory dir (default cwd): resolved to <root>/project-memory; a legacy layout (index.json + slots/) is accepted as-is; outside the workspace -> degrades to the workspace memory (degraded: true on the response)." }
      },
      required: ["title", "content"]
    }
  },
  {
    name: "memory_update",
    description: "Update an existing slot: replace or append its Détails, or rewrite its Résumé (bounded to 1000 chars). Archived slots are refused.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Slot id to update, e.g. slot-001." },
        mode: { type: "string", enum: ["replace", "append", "summary"], description: "replace/append edit Détails, summary rewrites Résumé." },
        content: { type: "string", description: "Markdown body for Détails (replace/append)." },
        summary: { type: "string", description: "New Résumé (mode=summary only)." },
        root: { type: "string", description: "Project root or memory dir (default cwd): resolved to <root>/project-memory; a legacy layout (index.json + slots/) is accepted as-is; outside the workspace -> degrades to the workspace memory (degraded: true on the response)." }
      },
      required: ["id", "mode"]
    }
  },
  {
    name: "memory_verify",
    description:
      "Replay the verification command declared by a memory slot (or by every slot that declares one) and record the verdict with its date. The command must be named in the project's .novahiz/verify.json.",
    inputSchema: {
      type: "object",
      properties: {
        slot: { type: "string", description: "Slot id to verify (default: every active slot declaring verify)." },
        apply: { type: "boolean", description: "Record last_verified / last_verdict in the slot (default false: read-only report)." },
        root: { type: "string", description: "Project root or memory dir (default cwd)." }
      }
    }
  },
  {
    name: "memory_archive",
    description: "Mark a slot as archived (idempotent, no data deletion): archived slots are skipped by routing and search unless includeArchived.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Slot id to archive, e.g. slot-001." },
        root: { type: "string", description: "Project root or memory dir (default cwd): resolved to <root>/project-memory; a legacy layout (index.json + slots/) is accepted as-is; outside the workspace -> degrades to the workspace memory (degraded: true on the response)." }
      },
      required: ["id"]
    }
  },
  {
    name: "memory_list",
    description: "List project-memory slots from index.json (active and archived) with optional status/tag/limit filters and summary previews.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Project root or memory dir (default cwd): resolved to <root>/project-memory; a legacy layout (index.json + slots/) is accepted as-is; outside the workspace -> degrades to the workspace memory (degraded: true on the response)." },
        status: { type: "string", enum: ["active", "archived", "all"], description: "Filter by slot status (default all)." },
        tag: { type: "string", description: "Keep slots carrying this tag (case-insensitive)." },
        limit: { type: "number", description: "Return at most this many slots (default: no limit)." },
        preview: { type: "boolean", description: "Add a short Résumé preview to each slot." }
      }
    }
  },
  {
    name: "memory_get",
    description: "Read one project-memory slot: full body by default, or only meta / only Résumé via section. Traces last_read on the slot (best-effort) — the decay data source for `novahiz memory prune --decay`.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Slot id, e.g. slot-001." },
        root: { type: "string", description: "Project root or memory dir (default cwd): resolved to <root>/project-memory; a legacy layout (index.json + slots/) is accepted as-is; outside the workspace -> degrades to the workspace memory (degraded: true on the response)." },
        section: { type: "string", enum: ["full", "meta", "summary"], description: "Part to return: full (default), meta, or summary (Résumé only)." }
      },
      required: ["id"]
    }
  },
  {
    name: "memory_search",
    description: "Search project-memory slots by relevance: candidates from the SQLite FTS5 index (novahiz.sqlite, derived, engine: 'fts') with automatic fallback to a fold + IDF file scan (engine: 'files'); returns scored results with confidence and snippet.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text query to rank slots against." },
        root: { type: "string", description: "Project root or memory dir (default cwd): resolved to <root>/project-memory; a legacy layout (index.json + slots/) is accepted as-is; outside the workspace -> degrades to the workspace memory (degraded: true on the response)." },
        limit: { type: "number", description: "Maximum results (default 5, max 20)." },
        includeArchived: { type: "boolean", description: "Also search archived slots (default false)." }
      },
      required: ["query"]
    }
  },
  {
    name: "memory_init",
    description: "Create project-memory/ (index.json + slots/) under the project root if missing.",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Project root or memory dir (default cwd): resolved to <root>/project-memory; a legacy layout (index.json + slots/) is accepted as-is; outside the workspace -> degrades to the workspace memory (degraded: true on the response)." }
      }
    }
  },
  {
    name: "memory_rebuild",
    description: "Rebuild project-memory/index.json from slot markdown files, then regenerate the derived SQLite FTS5 index (fts.synced on the response; markdown stays the source of truth).",
    inputSchema: {
      type: "object",
      properties: {
        root: { type: "string", description: "Project root or memory dir (default cwd): resolved to <root>/project-memory; a legacy layout (index.json + slots/) is accepted as-is; outside the workspace -> degrades to the workspace memory (degraded: true on the response)." }
      }
    }
  },
  {
    name: "snap_log",
    description: "List the ledger's snapshots, newest first (id, date, operation, detail, size). Pass id — exact or unique prefix — to read a single manifest instead.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum snapshots to return (default 20, max 50)." },
        id: { type: "string", description: "Snapshot id or unique prefix: return that manifest instead of the list." }
      }
    }
  },
  {
    name: "snap_status",
    description: "Report the snapshot store: location, count, newest snapshot, total size, retention, and captures still waiting for a transaction to close.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "snap_diff",
    description: "Compare a snapshot with another snapshot or with the live ledger, row by row. Read-only: writes nothing, snapshots nothing.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Snapshot id or unique prefix." },
        to: { type: "string", description: "Second snapshot id/prefix, or 'current' (default) for the live ledger." }
      },
      required: ["from"]
    }
  },
  {
    name: "snap_restore",
    description: "Put the ledger back to a snapshot. Rewrites rows inside one transaction — the database file is never replaced, so an open connection keeps working — writes a safety backup first, then snapshots the restored state. REFUSES unless force is true.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Snapshot id or unique prefix to restore." },
        force: { type: "boolean", description: "Must be true. Anything else refuses and changes nothing." }
      },
      required: ["id"]
    }
  },
  {
    name: "graph_find",
    description: "Locate symbol declarations by name in the auto-indexed workspace: exact match first, then case-insensitive, then substring — each hit carries file, span, enclosing scope and whitespace-collapsed signature. Replaces graft_find_code.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Symbol name, full or partial." },
        kind: { type: "string", description: "Comma-separated kinds filter: function, method, class, interface, type, enum, const, namespace, heading." },
        file: { type: "string", description: "Restrict to paths containing this fragment." },
        limit: { type: "number", description: "Maximum hits (default 20, max 200)." },
        root: { type: "string", description: "Workspace root (default: process cwd)." }
      },
      required: ["query"]
    }
  },
  {
    name: "graph_find_all",
    description: "Every masked occurrence of an identifier across the workspace — strings, comments, template text and regex literals excluded — grep-like: per-file counts and line numbers loaded from the content-addressed objects. Replaces graft_find_all.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Exact identifier, case-sensitive." },
        file: { type: "string", description: "Restrict to paths containing this fragment." },
        root: { type: "string", description: "Workspace root (default: process cwd)." }
      },
      required: ["query"]
    }
  },
  {
    name: "graph_trace",
    description: "Call-graph blast radius from one symbol: callers and/or callees over N hops, direct edges carrying their confidence (local/import/unique/method, uncertain flagged), module-level call sites listed separately, ambiguous names returned as candidates instead of a guess. Replaces graft_trace_calls.",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol name to start from." },
        file: { type: "string", description: "Path fragment narrowing an ambiguous name (first declaration by line wins)." },
        direction: { type: "string", enum: ["callers", "callees", "both"], description: "Default both." },
        depth: { type: "number", description: "Hop count 0-5 (default 1)." },
        limit: { type: "number", description: "Maximum hits per direction (default 20, max 200)." },
        root: { type: "string", description: "Workspace root (default: process cwd)." }
      },
      required: ["symbol"]
    }
  },
  {
    name: "graph_file_api",
    description: "Signatures-only view of one file: every definition with span and enclosing scope, plus exports and raw import specifiers resolved against the workspace. Replaces graft_file_api.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Workspace path or a unique fragment of it." },
        root: { type: "string", description: "Workspace root (default: process cwd)." }
      },
      required: ["file"]
    }
  },
  {
    name: "graph_repo_map",
    description: "Aggregated tree of the workspace: directories and files with symbol and line counts — aggregates stay complete below the depth cut — optionally scoped to a prefix, with workspace-level call statistics. Replaces graft_repo_map.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Subtree prefix, e.g. src." },
        depth: { type: "number", description: "Tree levels 1-6 (default 3)." },
        root: { type: "string", description: "Workspace root (default: process cwd)." }
      }
    }
  },
  {
    name: "graph_freshness",
    description: "Drift check: does the stored graph match the workspace? Stat-only by default - reports added/changed/removed files and never writes. Pass rebuild:true to run the incremental reindex first, then report. Replaces graft_check_freshness.",
    inputSchema: {
      type: "object",
      properties: {
        rebuild: { type: "boolean", description: "Reindex incrementally before reporting (default false)." },
        root: { type: "string", description: "Workspace root (default: process cwd)." }
      }
    }
  },
  {
    name: "novahiz_wireframe",
    description: "Wireframe-first design pipeline. Creates and maintains the project's wireframes/ folder: one subfolder per screen (screen.md + sections/NN-name.md annotated intent/behavior/constraints), a regenerated INDEX.md at the root, and an 'attach' action returning the full wireframe content as the attachment block to paste into the impeccable shape prompt. 'plan' tells whether a screen needs several sections and why; 'sections' creates them in bulk (one index rebuild for the whole batch); 'review' reports important sections that were forgotten and is enforced by 'mark' approval.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["init", "screen", "sections", "section", "plan", "review", "index", "attach", "mark", "status"],
          description: "init: create wireframes/ + INDEX.md (idempotent). screen: create a screen subfolder; the result carries needsSections=true and a plan when it was created without sections. sections: create MANY sections for an existing screen in a single call (fast: one INDEX rebuild instead of one per section, and existing names are skipped, never overwritten). section: append one section. plan: classify the screen (list/form/detail/settings/default) and return whether it needs several sections, which ones, and the reasons. review: report important sections that are missing from a screen, plus the questions that must be answered before approval. index: rebuild INDEX.md from disk. attach: return the full wireframe (screen + all sections) as the prompt attachment block for impeccable shape. mark: set lifecycle status (draft/approved/stale); approval of a screen is REFUSED while review reports gaps. status: list screens and their sections."
        },
        project: { type: "string", description: "Project root where wireframes/ lives (default: process cwd)." },
        name: { type: "string", description: "screen/section display name (actions screen, section, plan)." },
        objective: { type: "string", description: "Screen objective (actions screen, plan; optional)." },
        sections: { type: "array", items: { type: "string" }, description: "Ordered section names (action screen), or the batch of section names to create (action sections)." },
        screen: { type: "string", description: "Screen slug (actions sections, section, attach, mark, review, status)." },
        section: { type: "string", description: "Section id, e.g. 01-hero (action mark, optional: marks the screen)." },
        status: { type: "string", enum: ["draft", "approved", "stale"], description: "New lifecycle status (action mark)." }
      },
      required: ["action"]
    }
  }
];

export function negotiateProtocol(requested) {
  if (SUPPORTED_PROTOCOLS.includes(requested)) return requested;
  return SUPPORTED_PROTOCOLS[SUPPORTED_PROTOCOLS.length - 1];
}

function toolResult(value, isError = false) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: "text", text }], isError };
}

function normalizeTodo(item) {
  if (!item || typeof item !== "object") return { label: String(item ?? "") };
  const ownerValue = item.owner;
  const owner = Array.isArray(ownerValue)
    ? ownerValue.map(String).join(",")
    : ownerValue
      ? String(ownerValue)
      : undefined;
  return {
    label: String(item.label ?? item.title ?? ""),
    kind: item.kind ? String(item.kind) : undefined,
    acceptance: item.acceptance ? String(item.acceptance) : undefined,
    owner,
    size: item.size ? String(item.size) : undefined,
    dependsOn: Array.isArray(item.dependsOn)
      ? item.dependsOn.map(String)
      : Array.isArray(item.depends_on)
        ? item.depends_on.map(String)
        : undefined,
    maxIterations: Number.isFinite(item.maxIterations)
      ? Number(item.maxIterations)
      : Number.isFinite(item.max_iterations)
        ? Number(item.max_iterations)
        : undefined
  };
}

/**
 * Resolve a snapshot id the way the CLI does: an exact id, or any prefix that
 * names exactly one snapshot. "Not found" and "ambiguous" are different
 * answers, and both are bad parameters for the caller, so each throws with
 * its own message instead of collapsing into a generic failure.
 */
function resolveSnapId(prefix) {
  const raw = String(prefix ?? "").trim();
  const matches = matchingIds(raw);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`Invalid params: snapshot introuvable: ${raw}`);
  const shown = matches.slice(0, 5).join(", ");
  const extra = matches.length > 5 ? " ..." : "";
  // Thrown messages are sanitized to printable ASCII before they reach the
  // client (control characters and escape sequences must not survive), so they
  // are written without accents instead of being mangled on the way out.
  throw new Error(`Invalid params: prefixe ambigu: ${raw} correspond a ${matches.length} snapshots (${shown}${extra})`);
}

function callTool(name, args) {
  // Protocol violations throw: handle() maps "Unknown tool:" to -32601 and
  // "Invalid params:" to -32602. Only execution failures return isError results.
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("Invalid params: tool name must be a non-empty string");
  }
  if (args !== null && args !== undefined && (typeof args !== "object" || Array.isArray(args))) {
    throw new Error("Invalid params: arguments must be an object");
  }
  // H-MCP: input size limits to prevent DoS via large payloads
  const MAX_PROMPT_LEN = 100000;
  const MAX_CONTENT_LEN = 1000000;
  const spec = loadSpec();
  // P1: rejoue la file .pending avant chaque acces memoire mutant. Un replay
  // reapelle callTool — le garde module `draining` empeche la recursion.
  if (
    (name === "memory_write" || name === "memory_update" || name === "memory_archive" || name === "memory_init") &&
    args
  ) {
    try {
      lastDrain = drainPending(safeMemoryRoot(args.root));
    } catch {
      // Le drain ne bloque jamais l'operation courante.
    }
  }
  if (name === "novahiz_classify") {
    const prompt = String(args?.prompt ?? "");
    if (prompt.length > MAX_PROMPT_LEN) {
      throw new Error(`Invalid params: prompt exceeds ${MAX_PROMPT_LEN} characters`);
    }
    return toolResult({
      prompt,
      ...classify(spec, prompt, {
        files: Array.isArray(args?.files) ? args.files.map(String) : undefined
      })
    });
  }
  if (name === "novahiz_list_skills") {
    const index = loadInstalledSkills(spec);
    const category = args?.category ? String(args.category) : null;
    const fromCategories = category
      ? new Set((spec.categories.find((entry) => entry.id === category)?.defaultSkills ?? []))
      : null;
    const entries = [...index.skills]
      .sort()
      .filter((id) => {
        if (!category) return true;
        if (fromCategories.has(id)) return true;
        return (spec.overrides.skills?.[id]?.categories ?? []).includes(category);
      });
    return toolResult({ count: entries.length, indexAvailable: index.available, skills: entries });
  }
  if (name === "novahiz_catalog") {
    const query = String(args?.query ?? "");
    // M-MCP: bound limit to prevent excessive results
    const MAX_CATALOG_LIMIT = 50;
    const limit = Math.min(Number.isFinite(args?.limit) ? Number(args.limit) : 10, MAX_CATALOG_LIMIT);
    const catalog = loadCatalog(spec);
    return toolResult({ query, total: catalog.length, results: rankSkills(catalog, query, limit) });
  }
  if (name === "novahiz_roadmap") {
    const categoryId = args?.category ? String(args.category) : null;
    let category = categoryId ? spec.categories.find((entry) => entry.id === categoryId) : undefined;
    if (!category && typeof args?.query === "string") {
      const primary = classify(spec, args.query).primary;
      category = spec.categories.find((entry) => entry.id === primary);
    }
    return toolResult({ category: category?.id ?? null, roadmap: annotateRoadmap(category?.roadmap) });
  }
  if (name === "novahiz_providers") {
    const enabled = new Set(enabledProviders(spec).map((provider) => provider.id));
    const categoryId = args?.category ? String(args.category) : null;
    let list = spec.providers;
    if (categoryId) {
      list = list.filter((provider) => (provider.categories ?? []).includes(categoryId));
    } else if (typeof args?.query === "string") {
      const ids = new Set(classify(spec, args.query).providers);
      list = list.filter((provider) => ids.has(provider.id));
    }
    return toolResult({
      count: list.length,
      providers: list.map((provider) => ({
        id: provider.id,
        label: provider.label,
        kind: provider.kind,
        transport: provider.transport ?? null,
        purpose: provider.purpose ?? "",
        categories: provider.categories ?? [],
        source: provider.source ?? "",
        enabled: enabled.has(provider.id)
      }))
    });
  }
  if (name === "novahiz_deps") {
    return toolResult({ node: process.version, platform: process.platform, ...dependencyReport(spec, spec.root) });
  }
  if (name === "novahiz_step") {
    // The agent does not know its OpenCode session id, so defaulting to the
    // literal "default" mixed every session of every project into one row set.
    // Scope to the project instead: roadmap progress survives a restart and
    // never leaks into another project.
    const done = args?.done ? String(args.done) : "";
    const dropped = args?.drop ? String(args.drop) : "";
    const reason = args?.reason ? String(args.reason).trim() : "";
    // WS3: the step id follows the roadmap naming pattern (plan, write,
    // impeccable-critique) — reject anything else before it reaches the database.
    for (const id of [done, dropped]) {
      if (id.length > 0 && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) {
        throw new Error(`Invalid params: step id must match [A-Za-z0-9][A-Za-z0-9._-]{0,127} (got "${id}")`);
      }
    }
    if (dropped.length > 0 && reason.length === 0) {
      throw new Error("Invalid params: drop requires a reason, so the ledger can explain why the step does not apply");
    }
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      // Prefer the session the gate observed for this project; fall back to the
      // project scope so progress still survives a restart without a session.
      const session =
        (args?.session ? String(args.session) : null) ??
        defaultSessionForProject(db, { projectRoot: process.cwd() }).session ??
        `project:${projectKey(process.cwd())}`;
      if (done.length > 0 || dropped.length > 0) {
        const ts = new Date().toISOString();
        const stepId = done.length > 0 ? done : dropped;
        const stepStatus = done.length > 0 ? "done" : "dropped";
        /*
         * Record under every scope a close may consult. The task's own session
         * and the literal "default" scope used by closeTask are both written,
         * because the gate's session and the task's session can differ after a
         * restart or a compaction. Without this the close refused a step that
         * had been recorded, which is exactly what happened in the admin
         * messages session.
         */
        const scopes = new Set([session, "default"]);
        const current = activeTask(db, session);
        if (current?.session_id) scopes.add(current.session_id);
        for (const scope of scopes) {
          db.prepare(
            "INSERT OR IGNORE INTO sessions (id, categories, required_skills, updated_at) VALUES (?, '[]', '[]', ?)"
          ).run(scope, ts);
          db.prepare(
            "INSERT INTO roadmap_progress (session_id, step_id, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(session_id, step_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at"
          ).run(scope, stepId, stepStatus, new Date().toISOString());
        }
      }
      const steps = db.prepare("SELECT step_id, status, updated_at FROM roadmap_progress WHERE session_id = ? ORDER BY updated_at").all(session);
      return toolResult({ session, steps });
    } finally {
      db.close();
    }
  }
  if (name === "novahiz_skillpack") {
    const pack = buildSkillpack(spec, {
      category: args?.category ? String(args.category) : undefined,
      skills: Array.isArray(args?.skills) ? args.skills.map(String) : undefined,
      maxChars: Number.isFinite(args?.maxChars) ? Number(args.maxChars) : undefined
    });
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    let loaded = [];
    try {
      const session =
        (args?.session ? String(args.session) : null) ??
        defaultSessionForProject(db, { projectRoot: process.cwd() }).session;
      if (session) {
        loaded = (db.prepare("SELECT skill FROM skill_invocations WHERE session_id = ? ORDER BY skill").all(session) ?? []).map(
          (row) => String(row.skill)
        );
      }
    } finally {
      db.close();
    }
    return toolResult({
      ...pack,
      loaded,
      missingToLoad: pack.skills.map((skill) => skill.id).filter((id) => !loaded.includes(id))
    });
  }
  if (name === "novahiz_task") {
    const action = String(args?.action ?? "status");
    // M-MCP: validate action before opening DB — avoids opening/closing on invalid input
    const VALID_ACTIONS = TASK_ACTIONS;
    if (!VALID_ACTIONS.includes(action)) {
      throw new Error(`Invalid params: unknown task action '${action}'`);
    }
    const session = args?.session ? String(args.session) : undefined;
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      if (action === "link") {
        // NX-43: the adapter records the delegation the moment it sees it.
        // Refusing an empty parent is deliberate: a link invented from a
        // missing id would silently exempt the wrong session later.
        const parent = session ?? "";
        const child = args?.child ? String(args.child) : "";
        if (parent.length === 0) return toolResult("link requires a session (the parent)", true);
        if (child.length === 0) return toolResult("link requires child", true);
        return toolResult(recordSessionLink(db, { child, parent }));
      }
      if (action === "new") {
        // F: projectRoot scopes the new task to a project when the caller knows
        // it; omitted = unscoped legacy task (no path filtering).
        return toolResult((() => {
          const projectRootArg = args?.projectRoot ? String(args.projectRoot) : null;
          const projectRoot = projectRootArg ?? process.cwd();
          const fromProject = session ? null : defaultSessionForProject(db, { projectRoot }).session ?? null;
          const resolved = session ?? fromProject ?? undefined;
          const task = createTask(db, { title: String(args?.title ?? ""), id: args?.id ? String(args.id) : undefined, sessionId: resolved, projectRoot: projectRootArg ?? undefined, category: args?.category ? String(args.category) : undefined });
          const others = activeSessionsOnProject(db, { projectRoot, excludeSession: resolved ?? null });
          /*
           * NX-16 / NX-17: the payload used to spread the raw task row, so the
           * caller could not tell which session the steps would be recorded
           * under, nor whether the project root was given or defaulted. Both
           * are now explicit, with where each value came from.
           */
          return {
            ...task,
            session: resolved ?? null,
            sessionSource: session ? "argument" : fromProject ? "default-for-project" : "none",
            projectRoot,
            projectRootSource: projectRootArg ? "argument" : "cwd",
            otherSessions: others,
            worktreeHint: worktreeHint(others, resolved ?? "this session")
          };
        })());
      }
      if (action === "plan") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const items = Array.isArray(args?.todos) ? args.todos.map(normalizeTodo) : [];
        return toolResult(addTodos(db, taskId, items));
      }
      if (action === "todo") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const [todo] = addTodos(db, taskId, [normalizeTodo(args)]);
        return toolResult(todo);
      }
      if (action === "start") {
        const id = String(args?.id ?? "");
        const target = getTodo(db, id);
        if (target) {
          const due = reviewDue(db, target.task_id, spec.config.ledger?.review);
          if (due.due) return toolResult({ error: due.reason, task: target.task_id }, true);
        }
        return toolResult(startTodo(db, id));
      }
      if (action === "done") {
        const id = String(args?.id ?? "");
        const target = getTodo(db, id);
        if (!target) {
          // Un id inconnu n'est pas « aucune tâche active » : l'agent a besoin
          // des ids valides pour se corriger en un appel.
          const task = activeTask(db, session);
          const valid = task ? listTodos(db, task.id).map((todo) => todo.id) : [];
          return toolResult(
            { error: `unknown todo: ${id}`, validTodos: valid, task: task?.id ?? null },
            true,
          );
        }
        // H1: completeTodo + recordTodoDone must be atomic. Use a SAVEPOINT
        // so the nested capture inside completeTodo doesn't break the outer
        // transaction boundary.
        db.exec("SAVEPOINT done_sp");
        try {
          const todo = completeTodo(db, id, args?.proof ? String(args.proof) : "");
          recordTodoDone(db, todo.task_id);
          db.exec("RELEASE done_sp");
          // completeTodo's snapshot was refused while the savepoint was open;
          // the transaction is over, record the completed todo now.
          capture(db, "todo-completed", id);
          return toolResult(todo);
        } catch (error) {
          db.exec("ROLLBACK TO done_sp");
          db.exec("RELEASE done_sp");
          throw error;
        }
      }
      if (action === "block") return toolResult(blockTodo(db, String(args?.id ?? ""), args?.reason ? String(args.reason) : ""));
      if (action === "close") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const current = getTask(db, taskId);
        let required;
        if (current?.category) {
          const category = spec.categories.find((entry) => entry.id === current.category);
          const steps = closeStepsFor(
            (category?.roadmap?.steps ?? [])
              .filter((step) => step.optional !== true && (step.requireSkills ?? []).length > 0)
              .map((step) => step.id),
            spec.config.ledger?.close
          );
          const scopes = [];
          if (current.project_root) scopes.push(`project:${projectKey(current.project_root)}`);
          if (current.session_id) scopes.push(current.session_id);
          if (session) scopes.push(String(session));
          scopes.push("default");
          required = { steps, scopes };
        }
        return toolResult(closeTask(db, taskId, args?.proof ? String(args.proof) : "", required));
      }
      if (action === "history") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        return toolResult({
          task: taskId,
          history: planHistory(db, taskId, Number.isFinite(args?.limit) ? Number(args.limit) : undefined)
        });
      }
      if (action === "review") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        try {
          // parseReviewDiff accepts an object or a JSON string, keeps only the
          // known keys and drops the rest — raw input is never spread into SQL.
          const diff = parseReviewDiff(args?.changes);
          if (diff.additions) diff.additions = diff.additions.map((item) => normalizeTodo(item));
          return toolResult(reviewTask(db, { taskId, ...diff }));
        } catch (error) {
          return toolResult(`review failed: ${error instanceof Error ? error.message : String(error)}`, true);
        }
      }
      if (action === "amend") {
        const patch = {
          label: args?.label ? String(args.label) : undefined,
          kind: args?.kind ? String(args.kind) : undefined,
          acceptance: args?.acceptance !== undefined ? (args.acceptance === null ? null : String(args.acceptance)) : undefined,
          owner: args?.owner !== undefined ? (args.owner === null ? null : String(args.owner)) : undefined,
          size: args?.size !== undefined ? (args.size === null ? null : String(args.size)) : undefined,
          maxIterations: Number.isFinite(args?.maxIterations) ? Number(args.maxIterations) : undefined
        };
        return toolResult(amendTodo(db, String(args?.id ?? ""), patch));
      }
      if (action === "insert") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const raw = args?.position;
        const position = raw === undefined || raw === "" ? "end" : /^\d+$/.test(String(raw)) ? Number(raw) : String(raw);
        return toolResult(insertTodo(db, taskId, normalizeTodo(args), position));
      }
        if (action === "drop") {
          const dropId = String(args?.id ?? "");
          const reason = args?.reason ? String(args.reason) : "";
          if (getTask(db, dropId)) return toolResult({ task: dropTask(db, dropId, reason) });
          if (getTodo(db, dropId)) return toolResult({ todo: dropTodo(db, dropId, reason) });
          throw new Error(`unknown id: ${dropId} (expected a task id or todo id)`);
        }
        if (action === "reorder") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        const order = Array.isArray(args?.order) ? args.order.map(String) : [];
        // H-MCP: validate IDs are non-empty strings
        for (const id of order) {
          if (typeof id !== "string" || id.length === 0 || id.length > 128) {
            throw new Error("Invalid params: reorder order contains invalid ID");
          }
        }
        return toolResult(reorderTodos(db, taskId, order));
      }
      if (action === "signals") {
        const taskId = args?.task ? String(args.task) : activeTask(db, session)?.id;
        if (!taskId) return toolResult("no active task", true);
        return toolResult(revisionSignals(db, taskId));
      }
      if (action === "status" || action === "resume" || action === "current") {
        const explicit = args?.task ? getTask(db, String(args.task)) : null;
        const state = explicit
          ? (() => {
              const todos = listTodos(db, explicit.id);
              return {
                task: explicit,
                todos,
                current: todos.find((todo) => todo.status === "in_progress") ?? todos.find((todo) => todo.status === "pending") ?? null
              };
            })()
          : resume(db, session);
        const review = state.task ? reviewDue(db, state.task.id) : null;
        const signals = state.task ? revisionSignals(db, state.task.id) : [];
        const openTodos = state.task ? openTodoIds(db, state.task.id) : [];
        return toolResult({
          /*
           * NX-21: `status`, `resume` and `current` are three names for one
           * question, and they already shared this branch. The payload now
           * echoes which alias was asked and which scope answered, so a caller
           * never has to guess whether it read the explicit session or the
           * default one.
           */
          action,
          session: session ?? null,
          scope: session ?? "default",
          task: state.task,
          current: state.current,
          todos: state.todos,
          summary: ledgerSummary(state),
          review,
          signals,
          openTodos,
          readyToClose: Boolean(state.task && state.task.status === "active" && openTodos.length === 0)
        });
      }
    } finally {
      db.close();
    }
  }
  if (name === "novahiz_verify") {
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      const projectRoot = resolve(args?.projectRoot ? String(args.projectRoot) : process.cwd());
      const resolvedSession =
        (args?.session ? String(args.session) : null) ??
        defaultSessionForProject(db, { projectRoot }).session ??
        undefined;
      const outcome = runVerification(db, {
        projectRoot,
        name: String(args?.name ?? ""),
        session: resolvedSession,
        timeoutMs: Number.isFinite(args?.timeoutMs) ? Number(args.timeoutMs) : undefined,
        expect: args?.expect ? String(args.expect) : undefined
      });
      return toolResult(outcome, !outcome.ok);
    } finally {
      db.close();
    }
  }
  if (name === "novahiz_evidence") {
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      return toolResult({
        evidence: listEvidence(db, {
          limit: Number.isFinite(args?.limit) ? Number(args.limit) : undefined,
          session: args?.session ? String(args.session) : undefined,
          projectRoot: args?.projectRoot ? String(args.projectRoot) : process.cwd()
        })
      });
    } finally {
      db.close();
    }
  }
  if (name === "novahiz_claim") {
    const action = String(args?.action ?? "list");
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      if (action === "claim") {
        const paths = Array.isArray(args?.paths) ? args.paths.map(String) : [];
        const projectRoot = args?.projectRoot ? String(args.projectRoot) : process.cwd();
        const resolvedSession =
          (args?.session ? String(args.session) : null) ??
          defaultSessionForProject(db, { projectRoot }).session;
        if (!resolvedSession) {
          throw new Error(
            "Invalid params: no session id given and none could be resolved for this project. Pass session explicitly."
          );
        }
        return toolResult(
          claimPaths(db, {
            session: resolvedSession,
            paths,
            ttlMinutes: Number.isFinite(args?.ttlMinutes) ? Number(args.ttlMinutes) : undefined,
            reason: args?.reason ? String(args.reason) : undefined,
            projectRoot
          }),
          false
        );
      }
      if (action === "release") {
        return toolResult(
          releasePaths(db, {
            session: String(args?.session ?? ""),
            paths: Array.isArray(args?.paths) ? args.paths.map(String) : undefined
          })
        );
      }
      if (action === "list") {
        return toolResult({ claims: listClaims(db, { projectRoot: args?.projectRoot ? String(args.projectRoot) : process.cwd() }) });
      }
      throw new Error(`Invalid params: unknown claim action '${action}'`);
    } finally {
      db.close();
    }
  }
  if (name === "novahiz_dispatch") {
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      const taskId = args?.task ? String(args.task) : activeTask(db, args?.session ? String(args.session) : undefined)?.id;
      if (!taskId) return toolResult("no active task", true);
      const packets = buildWorkPackets(db, taskId);
      const byFile = new Map();
      for (const packet of packets) {
        for (const file of packet.files) {
          if (!byFile.has(file)) byFile.set(file, []);
          byFile.get(file).push(packet.todo);
        }
      }
      const conflicts = [...byFile.entries()]
        .filter(([, todos]) => todos.length > 1)
        .map(([file, todos]) => ({ file, todos }));
      return toolResult({ task: taskId, packets, conflicts });
    } finally {
      db.close();
    }
  }
  if (name === "memory_verify") {
    const dir = safeMemoryRoot(args?.root ? String(args.root) : undefined);
    const index = listSlots(dir);
    const slotFilter = args?.slot ? String(args.slot) : null;
    const targets = index.slots.filter(
      (slot) => slot.status === "active" && Boolean(slot.verify) && (!slotFilter || slot.id === slotFilter)
    );
    if (slotFilter && targets.length === 0) {
      throw new Error(`memory slot ${slotFilter} declares no verify command (or is not active)`);
    }
    const projectRoot = dirname(dir);
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    const results = [];
    try {
      for (const slot of targets) {
        const outcome = runVerification(db, { projectRoot, name: String(slot.verify) });
        const missing =
          typeof outcome.error === "string" &&
          (outcome.error.startsWith("no verify config") || outcome.error.startsWith("unknown verification"));
        const verdict = outcome.ok ? "ok" : missing ? "unknown" : "failed";
        let recorded = false;
        if (args?.apply === true) {
          recordSlotVerification(slot.id, { root: dir, verdict });
          recorded = true;
        }
        results.push({
          slot: slot.id,
          verify: slot.verify,
          verdict,
          ok: outcome.ok,
          exitCode: outcome.exitCode,
          durationMs: outcome.durationMs,
          evidenceId: outcome.evidenceId,
          ...(outcome.error ? { error: String(outcome.error).slice(0, 200) } : {}),
          recorded
        });
      }
    } finally {
      db.close();
    }
    return toolResult({ root: dir, projectRoot, checked: results.length, results }, results.some((row) => row.verdict === "failed"));
  }
  if (name === "memory_write") {
    if (args?.content !== undefined && typeof args.content === "string" && args.content.length > MAX_CONTENT_LEN) {
      throw new Error(`Invalid params: content exceeds ${MAX_CONTENT_LEN} characters`);
    }
    const input = parseSlotInput(args ?? {});
    // Resolution INCONDITIONNELLE: root absent -> <workspace>/project-memory,
    // root projet -> project-memory dedans, legacy accepte, hors workspace
    // E_ROOT (resolveMemoryDir, src/memory.ts). Le root echoe est toujours
    // le DOSSIER MEMOIRE reellement utilise.
    input.root = safeMemoryRoot(input.root);
    const result = writeEntry(input);
    return toolResult({
      root: input.root,
      slot: result.slot,
      rotated: result.rotated,
      compacted: result.compacted,
      // S5: undefined => cle absente du JSON (jamais de champ null parasite).
      archivedTo: result.archivedTo,
      created: result.created,
      confidence: result.confidence,
      duplicate: result.duplicate === true,
      healed: result.index.healed === true,
      limits: { limit_chars: DEFAULT_LIMIT_CHARS, limit_lines: DEFAULT_LIMIT_LINES },
      indexUpdated: result.index.updated
    });
  }
  if (name === "memory_update") {
    const id = String(args?.id ?? "");
    if (id.length === 0) throw new Error("Invalid params: id must be a non-empty string");
    const mode = String(args?.mode ?? "");
    if (mode !== "replace" && mode !== "append" && mode !== "summary") {
      throw new Error("Invalid params: mode must be one of replace|append|summary");
    }
    const root = safeMemoryRoot(args?.root);
    const result = updateSlot({
      id,
      root,
      mode,
      content: typeof args?.content === "string" ? args.content : undefined,
      summary: typeof args?.summary === "string" ? args.summary : undefined
    });
    return toolResult({
      root,
      slot: result.slot,
      mode: result.mode,
      updated: true,
      compacted: result.compacted,
      archivedTo: result.archivedTo,
      healed: result.index.healed === true
    });
  }
  if (name === "memory_archive") {
    const id = String(args?.id ?? "");
    if (id.length === 0) throw new Error("Invalid params: id must be a non-empty string");
    const root = safeMemoryRoot(args?.root);
    const result = archiveSlot(id, root);
    return toolResult({
      root,
      slot: result.slot,
      archived: true,
      changed: result.changed,
      healed: result.index.healed === true
    });
  }
  if (name === "memory_list") {
    const root = safeMemoryRoot(args?.root);
    const index = listSlots(root);
    const status = args?.status === "active" || args?.status === "archived" ? args.status : "all";
    const tagFilter =
      typeof args?.tag === "string" && args.tag.trim().length > 0 ? args.tag.trim() : null;
    const limit = Number.isFinite(args?.limit) && args.limit > 0 ? Math.trunc(args.limit) : 0;
    const preview = args?.preview === true;
    let matched = index.slots;
    if (status !== "all") matched = matched.filter((slot) => slot.status === status);
    if (tagFilter !== null) {
      const wanted = tagFilter.toLowerCase();
      matched = matched.filter((slot) => slot.tags.some((value) => value.toLowerCase() === wanted));
    }
    const total = matched.length;
    if (limit > 0) matched = matched.slice(0, limit);
    const slots = preview
      ? matched.map((slot) => {
          let summary = "";
          try {
            summary = getSlot(slot.id, root).body.summary;
          } catch {
            // Slot sans fichier lisible: preview vide — l'erreur bruyante
            // reste accessible via memory_get sur le meme id.
          }
          return { ...slot, preview: summary.length > 160 ? `${summary.slice(0, 157)}...` : summary };
        })
      : matched;
    return toolResult({
      root,
      count: slots.length,
      total,
      active: index.slots.filter((slot) => slot.status === "active").length,
      archived: index.slots.filter((slot) => slot.status === "archived").length,
      healed: index.healed === true,
      filter: { status, tag: tagFilter, limit: limit > 0 ? limit : null, preview },
      slots
    });
  }
  if (name === "memory_get") {
    const id = String(args?.id ?? "");
    if (id.length === 0) throw new Error("Invalid params: id must be a non-empty string");
    const root = safeMemoryRoot(args?.root);
    const section =
      args?.section === undefined || args?.section === null ? "full" : String(args.section);
    if (section !== "full" && section !== "meta" && section !== "summary") {
      throw new Error("Invalid params: section must be one of full|meta|summary");
    }
    const file = getSlot(id, root);
    // P5 decay: consultation explicite tracee (best-effort, jamais bloquante).
    touchSlotRead(root, id);
    if (section === "meta") return toolResult({ root, meta: file.meta });
    if (section === "summary") return toolResult({ root, meta: file.meta, summary: file.body.summary });
    return toolResult({ root, ...file });
  }
  if (name === "memory_search") {
    const query = typeof args?.query === "string" ? args.query : "";
    if (query.trim().length === 0) {
      throw new Error("Invalid params: query must be a non-empty string");
    }
    const root = safeMemoryRoot(args?.root);
    const limit = Number.isFinite(args?.limit)
      ? Math.min(Math.max(1, Math.trunc(args.limit)), 20)
      : 5;
    const result = searchSlots(root, query, {
      limit,
      includeArchived: args?.includeArchived === true,
      // P4: retrieval via l'index SQLite de la memoire; searchSlots retombe
      // sur les fichiers des que l'index est indisponible.
      fts: { dbPath: resolve(spec.root, spec.config.dbPath) }
    });
    return toolResult({
      root: result.root,
      query: result.query,
      searched: result.searched,
      engine: result.engine ?? "files",
      count: result.hits.length,
      results: result.hits.map((hit) => ({
        id: hit.meta.id,
        title: hit.meta.title,
        status: hit.meta.status,
        tags: hit.meta.tags,
        file: hit.meta.file,
        score: hit.score,
        confidence: hit.confidence,
        matched: hit.matched,
        snippet: hit.snippet
      }))
    });
  }
  if (name === "memory_init") {
    const root = safeMemoryRoot(args?.root);
    const index = ensureMemoryRoot(root);
    return toolResult({
      root,
      created: true,
      healed: index.healed === true,
      slots: index.slots.length,
      indexUpdated: index.updated
    });
  }
  if (name === "memory_rebuild") {
    const root = safeMemoryRoot(args?.root);
    const index = rebuildIndex(root);
    // P4: l'index SQLite derive est rebati depuis le markdown (source de verite).
    const fts = rebuildFts(resolve(spec.root, spec.config.dbPath), root);
    return toolResult({
      root,
      count: index.slots.length,
      indexUpdated: index.updated,
      fts: fts
        ? { synced: true, slots: fts.slots }
        : { synced: false, reason: "index SQLite indisponible (repli fichiers)" }
    });
  }
  if (name === "snap_log") {
    const wanted = typeof args?.id === "string" && args.id.trim().length > 0 ? args.id.trim() : null;
    if (wanted) {
      const manifest = loadManifest(resolveSnapId(wanted));
      if (!manifest) throw new Error(`Invalid params: manifeste illisible: ${wanted}`);
      return toolResult(manifest);
    }
    // M-MCP: bounded like the other list tools — a log listing must not
    // serialize the whole store at once.
    const limit = Number.isFinite(args?.limit) ? Math.min(Math.max(1, Math.trunc(args.limit)), 50) : 20;
    const items = listSnapshots(limit);
    const status = snapStatus();
    return toolResult({
      count: status.count,
      retention: status.retention,
      returned: items.length,
      snapshots: items.map((manifest) => ({
        id: manifest.id,
        parent: manifest.parent,
        createdAt: manifest.createdAt,
        operation: manifest.operation,
        detail: manifest.detail,
        sourceBytes: manifest.sourceBytes,
        objectBytes: manifest.objectBytes
      }))
    });
  }
  if (name === "snap_status") {
    return toolResult(snapStatus());
  }
  if (name === "snap_diff") {
    if (typeof args?.from !== "string" || args.from.trim().length === 0) {
      throw new Error("Invalid params: from must be a snapshot id or prefix");
    }
    const from = resolveSnapId(args.from);
    const rawTo = typeof args?.to === "string" && args.to.trim().length > 0 ? args.to.trim() : "current";
    const to = rawTo === "current" ? null : resolveSnapId(rawTo);
    const diff = diffSnapshots(from, to, to === null ? resolve(spec.root, spec.config.dbPath) : undefined);
    return toolResult(diff);
  }
  if (name === "snap_restore") {
    if (typeof args?.id !== "string" || args.id.trim().length === 0) {
      throw new Error("Invalid params: id must be a snapshot id or prefix");
    }
    const id = resolveSnapId(args.id);
    if (args.force !== true) {
      // Safety guard: restore rewrites every row, so it takes an explicit
      // `force: true`. A truthy string or a missing field is not consent.
      return toolResult(
        {
          success: false,
          refused: true,
          id,
          message: "restore refusé sans force:true ; une copie de sauvegarde sera écrite d'abord, puis relancez avec force:true"
        },
        true
      );
    }
    const db = openDb(resolve(spec.root, spec.config.dbPath));
    try {
      const result = restoreSnapshot(db, id, { force: true });
      if (!result.success) return toolResult(result, true);
      // Every ledger write leaves a restore point — including this one, so a
      // restore can itself be undone.
      const snapshot = capture(db, "restored", id);
      return toolResult({ ...result, snapshot: snapshot ? snapshot.id : null });
    } finally {
      db.close();
    }
  }
  if (name.startsWith("graph_")) {
    const root = typeof args?.root === "string" && args.root.length > 0 ? args.root : process.cwd();
    const str = (value) => (value !== undefined && value !== null ? String(value) : undefined);
    if (name === "graph_find") {
      return toolResult(graphFind(root, {
        query: String(args?.query ?? ""),
        kind: str(args?.kind),
        file: str(args?.file),
        limit: Number.isFinite(args?.limit) ? Number(args.limit) : undefined
      }));
    }
    if (name === "graph_find_all") {
      return toolResult(graphFindAll(root, {
        query: String(args?.query ?? ""),
        file: str(args?.file)
      }));
    }
    if (name === "graph_trace") {
      const direction = args?.direction === "callers" || args?.direction === "callees" ? args.direction : "both";
      return toolResult(graphTrace(root, {
        symbol: String(args?.symbol ?? ""),
        file: str(args?.file),
        direction,
        depth: Number.isFinite(args?.depth) ? Number(args.depth) : undefined,
        limit: Number.isFinite(args?.limit) ? Number(args.limit) : undefined
      }));
    }
    if (name === "graph_file_api") {
      return toolResult(graphFileApi(root, { file: String(args?.file ?? "") }));
    }
    if (name === "graph_repo_map") {
      return toolResult(graphRepoMap(root, {
        path: str(args?.path),
        depth: Number.isFinite(args?.depth) ? Number(args.depth) : undefined
      }));
    }
    if (name === "graph_freshness") {
      return toolResult(graphFreshness(root, { rebuild: args?.rebuild === true }));
    }
  }
  if (name === "novahiz_backup") {
      const action = String(args?.action ?? "list");
      const home = spec.root;
      if (action === "create") {
        const kind = args?.kind ? String(args.kind) : "auto-improve";
        if (!["native", "auto-improve", "pre-restore"].includes(kind)) {
          return toolResult({ error: `unknown kind ${kind} (native, auto-improve, pre-restore)` }, true);
        }
        return toolResult({ created: createBackup(home, { kind, note: args?.note ? String(args.note) : undefined }) });
      }
      if (action === "list") {
        const all = listBackups(home);
        const kind = args?.kind ? String(args.kind) : null;
        const backups = kind ? all.filter((meta) => meta.kind === kind) : all;
        return toolResult({ count: backups.length, backups });
      }
      if (action === "verify") {
        const id = args?.id ? String(args.id) : null;
        const targets = id ? listBackups(home).filter((meta) => meta.id === id) : listBackups(home);
        if (id && targets.length === 0) return toolResult({ error: `unknown backup: ${id}` }, true);
        const results = targets.map((meta) => verifyBackup(home, meta.id));
        const failed = results.filter((result) => !result.ok).length;
        return toolResult({ checked: results.length, failed, results }, failed > 0);
      }
      if (action === "restore") {
        const id = args?.id ? String(args.id) : "";
        if (!id) return toolResult({ error: "restore needs an id" }, true);
        // Restoring rewrites the system home: the caller must name the snapshot
        // it means to put back, not just "restore".
        if (String(args?.confirm ?? "") !== id) {
          return toolResult({ error: "restore requires confirm equal to the backup id" }, true);
        }
        const result = restoreBackup(home, id, { prune: args?.prune === true });
        return toolResult(result, !result.ok);
      }
      return toolResult({ error: `unknown backup action: ${action} (create, list, verify, restore)` }, true);
    }
    if (name === "novahiz_improve") {
      const action = String(args?.action ?? "list");
      const home = spec.root;
      const gate = autoImproveState();
      if (!gate.enabled && (action === "scan" || action === "apply")) {
        return toolResult({ disabled: true, reason: gate.reason, action });
      }
      if (action === "scan") {
        const db = openDb(resolve(spec.root, spec.config.dbPath));
        try {
          const drafts = detect(sampleDb(db), spec);
          if (args?.dry === true) return toolResult({ dry: true, candidates: drafts });
          const proposals = drafts.map((draft) => {
            const { proposal, created } = writeProposal(home, draft);
            return { id: proposal.id, kind: proposal.kind, target: proposal.target, created };
          });
          return toolResult({ count: proposals.length, proposals });
        } finally {
          db.close();
        }
      }
      if (action === "list") {
        const status = args?.status ? String(args.status) : null;
        const all = listProposals(home);
        const filtered = status ? all.filter((proposal) => proposal.status === status) : all;
        return toolResult({ count: filtered.length, proposals: filtered });
      }
      if (action === "show") {
        const proposal = readProposal(home, String(args?.id ?? ""));
        return proposal ? toolResult(proposal) : toolResult({ error: `unknown proposal: ${args?.id ?? ""}` }, true);
      }
      if (action === "dismiss") {
        const updated = setProposalStatus(home, String(args?.id ?? ""), "dismissed", args?.reason ? String(args.reason) : "");
        return updated ? toolResult({ dismissed: updated.id, note: updated.note }) : toolResult({ error: "unknown proposal" }, true);
      }
      if (action === "reopen") {
        const updated = setProposalStatus(home, String(args?.id ?? ""), "proposed", args?.reason ? String(args.reason) : "");
        return updated ? toolResult({ reopened: updated.id, status: updated.status }) : toolResult({ error: "unknown proposal" }, true);
      }
      if (action === "apply") {
        const id = String(args?.id ?? "");
        if (String(args?.confirm ?? "") !== id) {
          return toolResult({ error: "apply requires confirm equal to the proposal id, after reading it" }, true);
        }
        const result = applyProposal(home, id);
        return toolResult(result, !result.ok);
      }
      return toolResult({ error: `unknown improve action: ${action} (scan, list, show, dismiss, apply)` }, true);
    }
    if (name === "novahiz_repair") {
      const id = args?.id ? String(args.id) : null;
      if (id) {
        const outcome = applyRepair(spec.root, id);
        return toolResult(outcome, !outcome.ok);
      }
      const report = repair(spec.root, { apply: args?.apply === true });
      const problems = report.checks.filter((check) => check.problem !== null);
      return toolResult({
        healthy: report.checks.length - problems.length,
        problems,
        outcomes: report.outcomes
      });
    }
  if (name === "novahiz_wireframe") {
    const project = typeof args?.project === "string" && args.project.length > 0 ? args.project : process.cwd();
    const action = String(args?.action ?? "");
    const str = (value) => (typeof value === "string" && value.length > 0 ? value : undefined);
    if (action === "init") return toolResult(initWireframes(project));
    if (action === "screen") {
      const screenName = str(args?.name);
      if (!screenName) throw new Error("novahiz_wireframe screen: 'name' requis");
      const sections = Array.isArray(args?.sections) ? args.sections.map(String) : [];
      // createScreen reconstruit deja l'index en interne.
      return toolResult(createScreen(project, { name: screenName, objective: str(args?.objective), sections }));
    }
    if (action === "section") {
      const screen = str(args?.screen);
      const sectionName = str(args?.name);
      if (!screen || !sectionName) throw new Error("novahiz_wireframe section: 'screen' et 'name' requis");
      return toolResult(createSection(project, screen, sectionName));
    }
    if (action === "sections") {
      // Creation en lot: un seul appel, une seule reconstruction d'index.
      const screen = str(args?.screen);
      const names = Array.isArray(args?.sections) ? args.sections.map(String) : [];
      if (!screen) throw new Error("novahiz_wireframe sections: 'screen' requis");
      if (names.length === 0) throw new Error("novahiz_wireframe sections: 'sections' doit contenir au moins un nom");
      const created = createSections(project, screen, names);
      // On rend aussi le verdict de revue: c'est la reponse immediate a
      // "est-ce que j'ai maintenant tout ce qu'il faut ?".
      return toolResult({ ...created, review: reviewScreen(project, screen) });
    }
    if (action === "plan") {
      // Decision mono/multi: rien n'est ecrit, l'agent confirme ensuite.
      const screenName = str(args?.name);
      if (!screenName) throw new Error("novahiz_wireframe plan: 'name' requis");
      return toolResult(planSections(screenName, str(args?.objective)));
    }
    if (action === "review") {
      const screen = str(args?.screen);
      if (!screen) throw new Error("novahiz_wireframe review: 'screen' requis");
      return toolResult(reviewScreen(project, screen));
    }
    if (action === "index") return toolResult({ index: rebuildWireframeIndex(project) });
    if (action === "attach") {
      const screen = str(args?.screen);
      if (!screen) throw new Error("novahiz_wireframe attach: 'screen' requis");
      const attached = attachScreen(project, screen);
      // promptBlock en premier: c'est lui qui est colle dans le prompt de shape.
      return toolResult({
        screen: attached.screen,
        promptBlock: attached.promptBlock,
        files: attached.files.map((file) => file.path)
      });
    }
    if (action === "mark") {
      const screen = str(args?.screen);
      const status = str(args?.status);
      if (!screen || !status) throw new Error("novahiz_wireframe mark: 'screen' et 'status' requis");
      return toolResult(markStatus(project, screen, status, str(args?.section)));
    }
    if (action === "status") {
      const screens = listScreens(project);
      const single = str(args?.screen);
      return toolResult(single ? (screens.find((entry) => entry.slug === single) ?? { screen: single, found: false }) : { screens });
    }
    throw new Error(`novahiz_wireframe: action inconnue '${action}' (init|screen|sections|section|plan|review|index|attach|mark|status)`);
  }
  throw new Error(`Unknown tool: ${name}`);
}

function handle(message) {
  const id = message?.id;
  const method = message?.method;
  const params = message?.params ?? {};
  const hasId = id !== undefined && id !== null;
  if (!hasId) return null;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: negotiateProtocol(params.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
      }
    };
  }
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    // P1: chaque appel repart d'un etat propre — les drapeaux de decoration
    // valent pour un seul appel (les replays imbriques ne les volent pas).
    degradedRoot = null;
    lastDrain = null;
    try {
      return { jsonrpc: "2.0", id, result: decorate(callTool(params.name, params.arguments ?? {})) };
    } catch (error) {
      // Printable ASCII only: strips control chars and non-Latin scripts that
      // could smuggle terminal escapes. Also strip Windows paths (C:\...) to
      // avoid leaking filesystem structure in error messages.
      const raw = String(error?.message ?? error);
      const msg = raw.replace(/[^\x20-\x7E]/g, "").replace(/[A-Z]:\\[^\s]*/g, "[path]").slice(0, 300);
      // Protocol violations use JSON-RPC error codes, not isError results:
      // -32601 unknown tool, -32602 invalid params. Only execution failures
      // surface as isError tool results.
      if (raw.startsWith("Unknown tool:")) {
        return { jsonrpc: "2.0", id, error: { code: -32601, message: msg } };
      }
      if (raw.startsWith("Invalid params:")) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: msg } };
      }
      // --- P1: aucune exception ne doit bloquer une session memoire ---------
      if (String(params?.name ?? "").startsWith("memory_")) {
        const code = error?.code;
        if (code === "E_LOCK") {
          // Verrou encore pris apres l'attente longue du coeur (10s): mise en
          // file .pending (rejouee au prochain appel) plutot qu'un echec
          // visible. Si la file elle-meme echoue (EPERM), on chute en
          // degraded/failed — honnête: l'operation n'est PAS appliquee.
          let root = null;
          try {
            root = safeMemoryRoot(params?.arguments?.root);
          } catch {
            // Racine inutilisable: chute degraded ci-dessous.
          }
          if (root) {
            let queued = false;
            try {
              enqueuePending(root, params.name, { ...(params.arguments ?? {}), root });
              queued = true;
            } catch {
              // EPERM sur .pending: chute degraded ci-dessous.
            }
            if (queued) {
              return {
                jsonrpc: "2.0",
                id,
                result: decorate(
                  toolResult({
                    root,
                    pending: true,
                    degraded: true,
                    queuedAt: new Date().toISOString(),
                    notice: "memoire occupe: operation mise en file .pending, rejouee au prochain appel memory_*"
                  })
                )
              };
            }
          }
        }
        if (code !== "E_SLOT" && code !== "E_CONTENT") {
          // Erreur OS inattendue (EPERM, ENOTDIR, EACCES...) ou E_LOCK non
          // enfilable: degradation gracieuse — la reponse porte l'erreur au
          // lieu de casser l'agent. E_SLOT/E_CONTENT restent des echecs clairs
          // (isError): ce sont des erreurs de parametrage, pas d'infrastructure.
          let fallback = null;
          try {
            fallback = safeMemoryRoot(undefined);
          } catch {
            // <cwd>/project-memory: ne peut pas echouer en pratique.
          }
          return {
            jsonrpc: "2.0",
            id,
            result: decorate(
              toolResult({
                ...(fallback ? { root: fallback } : {}),
                degraded: true,
                failed: true,
                error: msg
              })
            )
          };
        }
      }
      // Une erreur d'usage n'est pas un bug du serveur : la préfixer
      // « internal error » brouille la distinction et pousse à chercher au
      // mauvais endroit. On ne garde le préfixe que pour l'inattendu.
      const usagePrefixes = [
        "unknown todo",
        "unknown task",
        "unknown id",
        "Invalid params",
        "todo ",
        "task ",
        "review failed",
        "no active task",
        "memory "
      ];
      const isUsage = usagePrefixes.some((prefix) => msg.startsWith(prefix));
      return { jsonrpc: "2.0", id, result: toolResult(isUsage ? msg : `internal error: ${msg}`, true) };
    }
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
})();
if (isMain) {
  // S-AUTO: mode one-shot pour le plugin opencode — `index.mjs --call <tool>`
  // lit les arguments JSON sur stdin (jamais sur argv: limite 32k sous
  // Windows et la liste des processus est visible), route par le meme
  // handle() que le transport stdio, imprime la reponse JSON-RPC sur stdout
  // puis sort. 0 = resultat valide, 1 = erreur de protocole ou isError.
  if (process.argv[2] === "--call") {
    const name = String(process.argv[3] ?? "");
    let args = {};
    let parseError = null;
    try {
      const raw = process.stdin.isTTY ? "" : readFileSync(0, "utf8").trim();
      if (raw.length > 0) args = JSON.parse(raw);
    } catch (error) {
      parseError = String(error?.message ?? error);
    }
    const response = parseError
      ? { jsonrpc: "2.0", id: 1, error: { code: -32700, message: `Parse error: ${parseError}` } }
      : handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    process.stdout.write(`${JSON.stringify(response)}\n`);
    const ok = Boolean(response?.result) && response.result.isError !== true;
    process.exit(ok ? 0 : 1);
  }
  const reader = createInterface({ input: process.stdin });
  // If the parent (opencode) dies or closes the pipe, stdout.write throws —
  // exit gracefully instead of crashing with an unhandled exception.
  const safeWrite = (text) => {
    try {
      process.stdout.write(text);
    } catch (err) {
      if (err?.code === "EPIPE") process.exit(0);
      throw err;
    }
  };
  reader.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      safeWrite(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
      return;
    }
    const response = handle(message);
    if (response) safeWrite(`${JSON.stringify(response)}\n`);
  });
  reader.on("close", () => process.exit(0));
}
