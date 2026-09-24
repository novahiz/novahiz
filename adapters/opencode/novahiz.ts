import type { Plugin } from "@opencode-ai/plugin";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

// Inlined from src/prompt-rewriter.ts — the installed plugin lives in
// ~/.config/opencode/plugins/ and cannot resolve ../../src/*.
type RewriteResult = { original: string; rewritten: string; sourceLanguage: string; wasRewritten: boolean };

function detectLanguage(prompt: string): string {
  if (/[\u0600-\u06FF]/.test(prompt)) return "ar";
  return "en";
}

const AR_EN: Array<[RegExp, string]> = [
  [/اصلاح|اصلح/g, "fix"], [/انشاء|اصنع/g, "create"], [/اضافة|اضف/g, "add"],
  [/حذف|احذف/g, "remove"], [/تعديل|عدّل/g, "modify"], [/هاكود|اكتشف/g, "debug"],
  [/اختبار|اختبر/g, "test"], [/ترحيل|هجر/g, "migrate"], [/اضبط|ضبط/g, "configure"],
  [/تحسين|حسّن/g, "optimize"], [/تبسيط|بسّط/g, "simplify"], [/تنظيف|نظّف/g, "clean up"],
  [/تنفيذ|طبّق/g, "implement"], [/استخدام|استخدم/g, "use"], [/استبدال|بدّل/g, "replace"],
  [/كتابة|اكتب/g, "write"], [/قراءة|اقرأ/g, "read"], [/حفظ|احفظ/g, "save"],
  [/عرض|اعرض/g, "display"], [/اخفاء|اخفي/g, "hide"], [/تفعيل|فعّل/g, "enable"],
  [/تعطيل|عطّل/g, "disable"], [/دالة/g, "function"], [/فئة/g, "class"],
  [/طريقة/g, "method"], [/متغير/g, "variable"], [/ملف/g, "file"], [/شفرة/g, "code"],
  [/مشكلة/g, "issue"], [/حل/g, "solution"], [/كيف/g, "how to"], [/لماذا/g, "why"],
  [/أي/g, "which"], [/افعل/g, "do"], [/في/g, "in"], [/من/g, "from"], [/على/g, "on"],
  [/صفحة/g, "page"], [/هبوط/g, "landing"], [/متجاوبة/g, "responsive"],
  [/تصميم/g, "design"], [/واجهة/g, "interface"], [/زر/g, "button"], [/قائمة/g, "menu"],
  [/شريط/g, "bar"], [/نافذة/g, "window"], [/شكل/g, "form"],
  [/الخادم|السيرفر/g, "server"], [/قاعدة البيانات/g, "database"],
  [/صفحة الهبوط/g, "landing page"], [/المصادقة/g, "auth"],
  [/تسجيل الدخول/g, "login"], [/خطأ/g, "bug"], [/اداء/g, "performance"], [/امان/g, "security"],
];

function rewritePrompt(prompt: string): RewriteResult {
  const sourceLanguage = detectLanguage(prompt);
  if (sourceLanguage === "en") {
    let r = prompt.trim().replace(/^I\s+want\s+to\s+/i, "").replace(/^I\s+need\s+to\s+/i, "")
      .replace(/^Can\s+you\s+/i, "").replace(/^Could\s+you\s+/i, "").replace(/^Please\s+/i, "")
      .replace(/^I\s+would\s+like\s+to\s+/i, "").replace(/^It\s+would\s+be\s+great\s+if\s+you\s+could\s+/i, "")
      .replace(/[.!?]+$/, "").trim();
    return { original: prompt, rewritten: r, sourceLanguage, wasRewritten: r !== prompt };
  }
  let result = prompt;
  for (const [pattern, replacement] of AR_EN) result = result.replace(pattern, replacement);
  let r = result.trim().replace(/^I\s+want\s+to\s+/i, "").replace(/^I\s+need\s+to\s+/i, "")
    .replace(/^Can\s+you\s+/i, "").replace(/^Could\s+you\s+/i, "").replace(/^Please\s+/i, "")
    .replace(/^I\s+would\s+like\s+to\s+/i, "").replace(/^It\s+would\s+be\s+great\s+if\s+you\s+could\s+/i, "")
    .replace(/[.!?]+$/, "").trim();
  return { original: prompt, rewritten: r, sourceLanguage, wasRewritten: true };
}

// Inlined from src/autodocs.ts — same reason as prompt-rewriter: relative
// imports to ../../src break once the plugin is copied into opencode's plugins/.
const NOVAHIZ_DIR = ".novahiz";
const STATE_NAME = "state.json";
const CONFIG_NAME = "config.json";

type AutoDocsState = {
  dirty: boolean;
  pending: string[];
  lastSync: string | null;
  sessions: number;
};

const EMPTY_STATE: AutoDocsState = { dirty: false, pending: [], lastSync: null, sessions: 0 };
const MAJOR_DIRS = /^(src|lib|app|routes|pages|api|server|internal|pkg|cmd)\//;
const MAJOR_FILES = new Set([
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "composer.json",
  "Gemfile"
]);
const MAJOR_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".php",
  ".rb",
  ".java",
  ".kt",
  ".swift",
  ".dart",
  ".sql"
]);
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "project-memory",
  "novahiz-docs",
  ".novahiz",
  "dist",
  "build",
  "coverage",
  ".next"
]);

function projectDir(cwd: string): string {
  return join(cwd, NOVAHIZ_DIR);
}

function configPath(cwd: string): string {
  return join(projectDir(cwd), CONFIG_NAME);
}

function statePath(cwd: string): string {
  return join(projectDir(cwd), STATE_NAME);
}

function ensureNovahizDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function autoDocsEnabled(cwd: string): boolean {
  const escape = (process.env.NOVAHIZ_AUTODOCS ?? "").toLowerCase();
  if (["off", "0", "false", "no", "disabled"].includes(escape)) return false;
  try {
    const parsed = JSON.parse(readFileSync(configPath(cwd), "utf8")) as { autoDocs?: unknown };
    return parsed !== null && typeof parsed === "object" && parsed.autoDocs === true;
  } catch {
    return false;
  }
}

function readState(cwd: string): AutoDocsState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(cwd), "utf8")) as Partial<AutoDocsState>;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_STATE };
    return {
      dirty: parsed.dirty === true,
      pending: Array.isArray(parsed.pending)
        ? parsed.pending.filter((entry): entry is string => typeof entry === "string").slice(0, 64)
        : [],
      lastSync: typeof parsed.lastSync === "string" ? parsed.lastSync : null,
      sessions: typeof parsed.sessions === "number" && Number.isFinite(parsed.sessions) ? parsed.sessions : 0
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

function writeState(cwd: string, state: AutoDocsState): void {
  ensureNovahizDir(projectDir(cwd));
  writeFileSync(statePath(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function isMajorPath(filePath: string): boolean {
  const path = normalizePath(filePath);
  const parts = path.split("/");
  if (parts.some((part) => SKIP_DIRS.has(part))) return false;
  const base = parts[parts.length - 1] ?? "";
  if (MAJOR_FILES.has(base)) return true;
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : "";
  if (MAJOR_EXT.has(ext)) return true;
  return MAJOR_DIRS.test(path);
}

function markDirty(cwd: string, filePath: string): AutoDocsState {
  const path = normalizePath(filePath);
  const state = readState(cwd);
  const pending = state.pending.includes(path) ? state.pending : [...state.pending, path].slice(-64);
  const next: AutoDocsState = {
    ...state,
    dirty: true,
    pending,
    sessions: state.sessions + 1
  };
  writeState(cwd, next);
  return next;
}

function ensureProjectMemory(cwd: string): boolean {
  try {
    const root = join(cwd, "project-memory");
    const slots = join(root, "slots");
    const index = join(root, "index.json");
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    if (!existsSync(slots)) mkdirSync(slots, { recursive: true });
    if (!existsSync(index)) {
      const empty = { version: 1, updated: new Date().toISOString(), slots: [] };
      writeFileSync(index, `${JSON.stringify(empty, null, 2)}\n`, "utf8");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const HOME =
  process.env.NOVAHIZ_HOME && process.env.NOVAHIZ_HOME.length > 0
    ? process.env.NOVAHIZ_HOME
    : join(homedir(), ".config", "novahiz");
const CLI = join(HOME, "src", "cli.ts");
const NODE =
  process.env.NOVAHIZ_NODE && process.env.NOVAHIZ_NODE.length > 0 ? process.env.NOVAHIZ_NODE : "node";

type GateConfig = { enabled?: boolean; mode?: string; envEscape?: string; tools?: string[] };
type NovahizConfig = { gate?: GateConfig };

function readConfig(): NovahizConfig {
  for (const name of ["novahiz.config.json", "novahiz.config.example.json"]) {
    try {
      return JSON.parse(readFileSync(join(HOME, name), "utf8")) as NovahizConfig;
    } catch {
      continue;
    }
  }
  return {};
}

const CONFIG = readConfig();
const GATE = CONFIG.gate ?? {};
// H1: envEscape is NOT configurable — a writable config must not be able to
// redirect the kill-switch to an unrelated variable (e.g. CI=false).
// Single escape hatch name after brand rename.
const ESCAPE = (process.env.NOVAHIZ_GATE ?? "").toLowerCase();
// gate.enabled=false disables the plugin the same way the CLI gate does (see src/commands/gate.ts).
// gate.mode (block/warn/audit) stays owned by the CLI: the plugin only forwards the gate exit code.
const DISABLED =
  ["off", "0", "false", "no", "disabled"].includes(ESCAPE) || GATE.enabled === false;
const GATE_TOOLS = new Set(
  (Array.isArray(GATE.tools) && GATE.tools.length > 0 ? GATE.tools : ["edit", "write", "patch", "apply_patch", "bash", "shell"]).map((tool) => tool.toLowerCase())
);

type RunResult = { status: number; stdout: string; stderr: string; spawnError?: string };

// C1: timeout prevents a hung CLI from freezing the whole OpenCode process.
// C2: maxBuffer caps output; oversized output is treated as a gate failure,
// never as truncated-then-allowed.
const RUN_TIMEOUT_MS = 10_000;
const RUN_MAX_BUFFER = 1_048_576;

function run(args: string[], input?: string): RunResult {
  // C1: On Windows, SIGTERM is emulated via process.kill() which sends
  //TerminateProcess + exit code 1, causing the CLI to report status 1 instead
  //of being properly terminated. Use SIGKILL on Windows (unavoidable but at
  //least doesn't pretend graceful shutdown is possible).
  const isWin = process.platform === "win32";
  const result = spawnSync(NODE, [CLI, ...args], {
    encoding: "utf8",
    input,
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: RUN_MAX_BUFFER,
    killSignal: isWin ? "SIGKILL" : "SIGTERM"
  });
  if (result.error) return { status: 1, stdout: "", stderr: "", spawnError: result.error.message };
  // On Windows, timeout-killed processes always exit with status 1 (TerminateProcess).
  // The `signal` property is set when the process was killed by a signal.
  const timedOut = result.status === 1 && !result.stdout?.trim() && Boolean(result.signal);
  if (timedOut) return { status: 1, stdout: "", stderr: "Novahiz timed out" };
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    const record = part as { type?: string; text?: string };
    if (record && record.type === "text" && typeof record.text === "string") chunks.push(record.text);
  }
  return chunks.join("\n").trim();
}

// H2: Session IDs must be non-empty strings. This guards against undefined/null
// being passed to spawnSync env, which would throw on Windows.
function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0;
}

export const NovahizPlugin: Plugin = async ({ client }) => {
  const loadedBySession = new Map<string, Set<string>>();
  const categoriesBySession = new Map<string, string[]>();
  const enforcementBySession = new Map<string, string>();
  const lastSeenBySession = new Map<string, number>();
  const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

  const log = async (level: "info" | "warn", message: string): Promise<void> => {
    try {
      await client.app.log({ body: { service: "Novahiz", level, message } });
    } catch {
      return;
    }
  };

  const forget = (sessionID: string): void => {
    loadedBySession.delete(sessionID);
    categoriesBySession.delete(sessionID);
    enforcementBySession.delete(sessionID);
    lastSeenBySession.delete(sessionID);
  };

  // Sessions only vanish from memory on session.deleted, which may never arrive.
  // Prune entries idle for longer than SESSION_TTL_MS on every access.
  const touch = (sessionID: string): void => {
    lastSeenBySession.set(sessionID, Date.now());
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, seen] of lastSeenBySession) {
      if (seen < cutoff) forget(id);
    }
  };

  if (DISABLED)
    await log("info", GATE.enabled === false ? "Gate disabled via config (gate.enabled=false)" : "Gate disabled via environment escape");

  return {
    config: async (input) => {
      ensureProjectMemory(process.cwd());
      if (DISABLED) return;
      try {
        const config = input as { mcp?: Record<string, unknown> };
        if (!config.mcp) config.mcp = {};
        if (!config.mcp.novahiz) {
          config.mcp.novahiz = {
            type: "local",
            command: [NODE, join(HOME, "mcp", "novahiz-tools", "index.mjs")],
            enabled: true
          };
        }
        const providers = run(["providers", "--mcp-json"]);
        if (providers.status === 0 && providers.stdout.trim().length > 0) {
          try {
            const entries = JSON.parse(providers.stdout) as Record<string, unknown>;
            for (const [id, entry] of Object.entries(entries)) {
              if (!config.mcp[id]) config.mcp[id] = entry;
            }
          } catch {
            await log("warn", "Providers returned invalid JSON, MCP auto-register skipped");
          }
        } else if (providers.status !== 0) {
          await log("warn", `Providers command failed (exit ${providers.status}), MCP auto-register skipped`);
        }
      } catch (error) {
        await log("warn", `Config hook failed: ${String(error).slice(0, 200)}`);
        return;
      }
    },

    event: async ({ event }) => {
      const type = (event as { type?: string }).type ?? "";
      if (type === "session.idle") {
        // Fail-open: never block idle; skip when disabled or nothing pending.
        try {
          const cwd = process.cwd();
          if (autoDocsEnabled(cwd)) {
            const state = readState(cwd);
            if (state.dirty || state.pending.length > 0) {
              const child = spawn(NODE, [CLI, "autodocs", "--flush"], {
                cwd,
                stdio: "ignore",
                timeout: RUN_TIMEOUT_MS,
                windowsHide: true
              });
              child.on("error", () => undefined);
              child.unref();
            }
          }
        } catch {
          // fail-open
        }
        return;
      }
      if (type !== "session.deleted") return;
      const properties = (event as { properties?: { info?: { id?: string }; sessionID?: string } }).properties ?? {};
      const sessionID = properties.info?.id ?? properties.sessionID;
      if (sessionID) forget(sessionID);
    },

    "chat.message": async (input, output) => {
      ensureProjectMemory(process.cwd());
      if (DISABLED) return;
      try {
        if (!isValidSessionId(input.sessionID)) return;
        touch(input.sessionID);
        const text = textFromParts(output.parts);
        if (text.length === 0) return;

        // Prompt rewriter: translate non-English prompts to optimized English
        // before classification. Responses always match the user's language.
        const rewrite = rewritePrompt(text);
        const classifyText = rewrite.rewritten;
        if (rewrite.wasRewritten) {
          await log("info", `Prompt rewritten: ${rewrite.sourceLanguage} → English ("${classifyText.slice(0, 80)}")`);
        }

        const result = run(["classify", classifyText]);
        if (result.status !== 0) {
          await log("warn", `Classify failed (exit ${result.status}), no enforcement injected: ${result.stderr.trim().slice(0, 200)}`);
          return;
        }
        let parsed: {
          categories?: { id: string }[];
          primary?: string | null;
          requiredSkills?: string[];
          enforcedSkills?: string[];
          providers?: string[];
          roadmaps?: { id: string; steps: { label: string; kind: string; requireSkills?: string[] }[] }[];
        };
        try {
          parsed = JSON.parse(result.stdout) as typeof parsed;
        } catch {
          await log("warn", "Classify returned invalid JSON, no enforcement injected");
          return;
        }
        // M5: the `as` cast is compile-time only — validate the shape at runtime
        // so a malformed classify response cannot silently disable enforcement.
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.categories)) {
          await log("warn", "Classify returned unexpected structure, no enforcement injected");
          return;
        }
        const categories = (parsed.categories ?? []).map((entry) => entry.id);
        categoriesBySession.set(input.sessionID, categories);
        const primary = parsed.primary ?? categories[0] ?? null;
        const enforced = parsed.enforcedSkills ?? [];
        const required = parsed.requiredSkills ?? [];
        const suggested = required.filter((skill) => !enforced.includes(skill));
        const roadmap = (parsed.roadmaps ?? [])[0];
        const providers = parsed.providers ?? [];
        const lines = [
          "[Novahiz enforcement]",
          `Categories detected: ${categories.join(", ") || "none"}${primary ? ` (primary: ${primary})` : ""}`
        ];
        if (rewrite.wasRewritten) {
          lines.push(`User language: ${rewrite.sourceLanguage} — respond in this language, not English.`);
        }
        if (roadmap) {
          lines.push(`Roadmap ${roadmap.id}:`);
          roadmap.steps.forEach((step, index) => {
            const skills = step.requireSkills?.length ? ` (${step.requireSkills.join(", ")})` : "";
            lines.push(`  ${index + 1}. [${step.kind}] ${step.label}${skills}`);
          });
        }
        if (enforced.length > 0) lines.push(`Required skills (roadmap): ${enforced.join(", ")}`);
        if (suggested.length > 0) lines.push(`Suggested skills: ${suggested.join(", ")}`);
        if (providers.length > 0) lines.push(`Tools for this task: ${providers.join(", ")}`);
        const ledger = run(["task", "current", "--session", input.sessionID]);
        if (ledger.status === 0 && ledger.stdout.trim().length > 0) {
          try {
            const state = JSON.parse(ledger.stdout) as { task?: unknown; summary?: string[] };
            if (state.task && Array.isArray(state.summary) && state.summary.length > 0) lines.push(...state.summary);
          } catch {
            await log("warn", "Ledger state is invalid JSON, enforcement injected without the task summary");
          }
        }
        lines.push("The gate blocks edit/write/patch/apply_patch/bash/shell until the required skills are loaded via skill({name:\"...\"}).");
        lines.push("The gate is content-aware: novahiz-humanizer, ui-slop-remover and ui-craft-rules are required only on frontend design tasks (R13).");
        lines.push("Config edited = opencode restart required (config read at import).");
        lines.push("Memory lives in project-memory/ under the project root (cwd): index.json + fixed-size slots (8000 chars / 200 lines) with compact → archive → new-slot rotation. Use the MCP memory_* tools to read and append.");
        enforcementBySession.set(input.sessionID, lines.join("\n"));
      } catch (error) {
        await log("warn", `chat.message hook failed, no enforcement injected: ${String(error).slice(0, 200)}`);
        return;
      }
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (DISABLED) return;
      try {
        const sessionID = input.sessionID;
        if (!sessionID) return;
        const block = enforcementBySession.get(sessionID);
        if (block) output.system.push(block);
      } catch (error) {
        await log("warn", `system.transform hook failed: ${String(error).slice(0, 200)}`);
      }
    },

    "tool.execute.before": async (input, output) => {
      try {
        // H-Plugin: validate session ID before using it — prevents undefined/null
        // from being passed to spawnSync env (throws on Windows).
        if (!isValidSessionId(input.sessionID)) return;
        touch(input.sessionID);
        if (!loadedBySession.has(input.sessionID)) loadedBySession.set(input.sessionID, new Set());
        const loaded = loadedBySession.get(input.sessionID)!;

        if (input.tool.toLowerCase() === "skill") {
          const args = output.args as { name?: string; skill?: string } | undefined;
          const name = args?.name ?? args?.skill;
          if (name) {
            loaded.add(String(name));
            // H3: surface session-load failures — otherwise the gate blocks later
            // with no trace of why the skill was never recorded.
            const loadResult = run(["session-load", "--session", input.sessionID, "--skill", String(name)]);
            if (loadResult.status !== 0) {
              await log("warn", `session-load failed for skill ${name}: ${(loadResult.stderr || "").trim().slice(0, 200)}`);
            }
          }
          return;
        }

        if (DISABLED || !GATE_TOOLS.has(input.tool.toLowerCase())) return;

        const categories = categoriesBySession.get(input.sessionID) ?? [];
        const result = run(
          [
            "gate",
            "--tool",
            input.tool,
            "--args-stdin",
            "--categories",
            categories.join(","),
            "--loaded",
            [...loaded].join(","),
            "--session",
            input.sessionID
          ],
          (() => {
            try {
              return JSON.stringify(output.args ?? {});
            } catch (error) {
              throw new Error(`Novahiz gate blocked ${input.tool}: could not serialize tool args (${String(error)}).`);
            }
          })()
        );

        // H2: fail-closed — an unavailable gate denies the tool call instead of
        // silently bypassing enforcement. NOVAHIZ_GATE=off remains the escape hatch.
        if (result.spawnError) {
          await log("warn", `Gate unavailable, denying the tool call: ${result.spawnError}`);
          throw new Error(
            `Novahiz gate blocked ${input.tool}: gate unavailable (${result.spawnError}). Fix the install (run sync, check catalog/) or set NOVAHIZ_GATE=off to disable.`
          );
        }
        if (result.status === 2) {
          throw new Error(`Novahiz gate blocked ${input.tool}.\n${result.stdout}`);
        }
        if (result.status !== 0) {
          throw new Error(
            `Novahiz gate unavailable (exit ${result.status}). Fix the install (run sync, check catalog/) or set the escape variable to disable.\n${result.stderr}`
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Novahiz gate")) throw error;
        // H2: fail-closed — unknown gate errors deny, they never bypass.
        await log("warn", `Gate error, denying the tool call as precaution: ${String(error)}`);
        throw new Error(`Novahiz gate blocked ${input.tool}: internal gate error. Set NOVAHIZ_GATE=off to disable.`);
      }
    },

    "tool.execute.after": async (input) => {
      // Fail-open: mark major paths only; never break the tool result.
      try {
        const tool = input.tool.toLowerCase();
        if (!["edit", "write", "patch", "apply_patch"].includes(tool)) return;
        const args = (input.args ?? {}) as Record<string, unknown>;
        const raw =
          (typeof args.filePath === "string" && args.filePath) ||
          (typeof args.file_path === "string" && args.file_path) ||
          (typeof args.path === "string" && args.path) ||
          "";
        if (!raw) return;
        const cwd = process.cwd();
        const abs = resolve(cwd, raw);
        const rel = relative(cwd, abs).replace(/\\/g, "/");
        if (!rel || rel.startsWith("..")) return;
        if (!isMajorPath(rel)) return;
        markDirty(cwd, rel);
      } catch {
        // fail-open
      }
    }
  };
};
