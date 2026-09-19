import type { Plugin } from "@opencode-ai/plugin";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Inlined from src/prompt-rewriter.ts to avoid broken relative path in installed plugin
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

const HOME =
  process.env.SKILLEFORCE_HOME && process.env.SKILLEFORCE_HOME.length > 0
    ? process.env.SKILLEFORCE_HOME
    : process.env.NOVAHIZ_HOME && process.env.NOVAHIZ_HOME.length > 0
      ? process.env.NOVAHIZ_HOME
      : join(homedir(), ".config", "skillenforce");
const CLI = join(HOME, "src", "cli.ts");
const NODE =
  process.env.SKILLEFORCE_NODE && process.env.SKILLEFORCE_NODE.length > 0 ? process.env.SKILLEFORCE_NODE : "node";

type GateConfig = { enabled?: boolean; mode?: string; envEscape?: string; tools?: string[] };
type SkillenforceConfig = { gate?: GateConfig };

function readConfig(): SkillenforceConfig {
  for (const name of ["skillenforce.config.json", "skillenforce.config.example.json"]) {
    try {
      return JSON.parse(readFileSync(join(HOME, name), "utf8")) as SkillenforceConfig;
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
// Primary name first, legacy NOVAHIZ_GATE as backward-compatible fallback.
const ESCAPE = (process.env.SKILLEFORCE_GATE ?? process.env.NOVAHIZ_GATE ?? "").toLowerCase();
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
  if (timedOut) return { status: 1, stdout: "", stderr: "skillenforce timed out" };
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

export const SkillenforcePlugin: Plugin = async ({ client }) => {
  const loadedBySession = new Map<string, Set<string>>();
  const categoriesBySession = new Map<string, string[]>();
  const enforcementBySession = new Map<string, string>();
  const lastSeenBySession = new Map<string, number>();
  const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

  const log = async (level: "info" | "warn", message: string): Promise<void> => {
    try {
      await client.app.log({ body: { service: "skillenforce", level, message } });
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
      if (DISABLED) return;
      try {
        const config = input as { mcp?: Record<string, unknown> };
        if (!config.mcp) config.mcp = {};
        if (!config.mcp.skillenforce) {
          config.mcp.skillenforce = {
            type: "local",
            command: [NODE, join(HOME, "mcp", "skillenforce-tools", "index.mjs")],
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
      if (type !== "session.deleted") return;
      const properties = (event as { properties?: { info?: { id?: string }; sessionID?: string } }).properties ?? {};
      const sessionID = properties.info?.id ?? properties.sessionID;
      if (sessionID) forget(sessionID);
    },

    "chat.message": async (input, output) => {
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
          "[Skillenforce enforcement]",
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
        lines.push("The gate is content-aware: humanizer for prose, impeccable for style.");
        lines.push("Config edited = opencode restart required (config read at import).");
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
              throw new Error(`Skillenforce gate blocked ${input.tool}: could not serialize tool args (${String(error)}).`);
            }
          })()
        );

        // H2: fail-closed — an unavailable gate denies the tool call instead of
        // silently bypassing enforcement. SKILLEFORCE_GATE=off remains the escape hatch.
        if (result.spawnError) {
          await log("warn", `Gate unavailable, denying the tool call: ${result.spawnError}`);
          throw new Error(
            `Skillenforce gate blocked ${input.tool}: gate unavailable (${result.spawnError}). Fix the install (run sync, check catalog/) or set SKILLEFORCE_GATE=off to disable.`
          );
        }
        if (result.status === 2) {
          throw new Error(`Skillenforce gate blocked ${input.tool}.\n${result.stdout}`);
        }
        if (result.status !== 0) {
          throw new Error(
            `Skillenforce gate unavailable (exit ${result.status}). Fix the install (run sync, check catalog/) or set the escape variable to disable.\n${result.stderr}`
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Skillenforce gate")) throw error;
        // H2: fail-closed — unknown gate errors deny, they never bypass.
        await log("warn", `Gate error, denying the tool call as precaution: ${String(error)}`);
        throw new Error(`Skillenforce gate blocked ${input.tool}: internal gate error. Set SKILLEFORCE_GATE=off to disable.`);
      }
    }
  };
};
