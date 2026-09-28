import type { Plugin } from "@opencode-ai/plugin";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

// Inlined from src/prompt-rewriter.ts — the installed plugin lives in
// ~/.config/opencode/plugins/ and cannot resolve ../../src/*.
type RewriteResult = { original: string; rewritten: string; sourceLanguage: string; wasRewritten: boolean };

function fold(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function rx(words: string, flags: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, flags);
}

function marker(words: string): RegExp {
  return rx(words, "iu");
}

function word(words: string): RegExp {
  return rx(words, "giu");
}

const DETECT_MIN_SCORE = 3;
const LANG_ORDER = ["fr", "es", "de", "pt"];

const LANG_PATTERNS: Record<string, Array<[RegExp, number]>> = {
  fr: [
    [marker("corriger|corrige"), 3], [marker("ajouter|ajoute|ajoutez"), 3],
    [marker("supprimer|supprime|supprimez"), 3], [marker("creer|creez|creation"), 3],
    [marker("developper|developpe"), 3], [marker("implementer|implemente"), 3],
    [marker("refactoriser|refactorise"), 3], [marker("configurer"), 3],
    [marker("installer"), 3], [marker("ameliorer|amelioration"), 3],
    [marker("optimiser"), 3], [marker("verifier|verifie"), 3],
    [marker("expliquer|explique"), 3], [marker("pourquoi"), 3],
    [marker("comment faire"), 3],
    [marker("dans"), 2], [marker("avec"), 2], [marker("pour"), 2], [marker("vous"), 2],
    [marker("nous"), 2], [marker("votre|notre"), 2], [marker("fonction|fonctions"), 2],
    [marker("classe|classes"), 2], [marker("fichier|fichiers"), 2],
    [marker("probleme|problemes"), 2], [marker("erreur|erreurs"), 2],
    [marker("serveur"), 2], [marker("donnees"), 2], [marker("utilisateur|utilisateurs"), 2],
    [marker("ecran"), 2], [marker("bouton"), 2], [marker("formulaire"), 2],
    [marker("securite"), 2], [marker("reseau"), 2], [marker("requete"), 2],
    [marker("besoin"), 2], [marker("faites|fait"), 2],
    [marker("le"), 1], [marker("la"), 1], [marker("les"), 1], [marker("des"), 1],
    [marker("du"), 1], [marker("de"), 1], [marker("un"), 1], [marker("une"), 1],
    [marker("est"), 1], [marker("ne"), 1], [marker("pas"), 1],
  ],
  es: [
    [marker("hacer"), 3], [marker("crear|cree"), 3], [marker("anadir"), 3],
    [marker("borrar"), 3], [marker("arreglar"), 3], [marker("corregir"), 3],
    [marker("explicar"), 3], [marker("necesito"), 3], [marker("quiero"), 3],
    [marker("tengo"), 3], [marker("base de datos"), 3], [marker("inicio de sesion"), 3],
    [marker("para"), 2], [marker("con"), 2], [marker("pero"), 2], [marker("muy"), 2],
    [marker("tambien"), 2], [marker("pagina|paginas"), 2], [marker("servidor"), 2],
    [marker("usuario|usuarios"), 2], [marker("archivo|archivos"), 2], [marker("codigo"), 2],
    [marker("pantalla"), 2], [marker("mensaje"), 2], [marker("conexion"), 2],
    [marker("datos"), 2], [marker("diseno"), 2], [marker("aplicacion"), 2],
    [marker("de"), 1], [marker("la"), 1], [marker("el"), 1], [marker("los"), 1],
    [marker("las"), 1], [marker("un"), 1], [marker("una"), 1], [marker("es"), 1],
    [marker("en"), 1], [marker("por"), 1], [marker("que"), 1], [marker("se"), 1],
    [marker("al"), 1], [marker("lo"), 1],
  ],
  de: [
    [marker("bitte"), 3], [marker("machen"), 3], [marker("erstellen|erstelle"), 3],
    [marker("hinzufugen"), 3], [marker("loschen"), 3], [marker("beheben|behebt"), 3],
    [marker("debuggen"), 3], [marker("testen"), 3], [marker("erklaren|erklare"), 3],
    [marker("warum"), 3], [marker("nicht"), 3], [marker("muss"), 3], [marker("soll"), 3],
    [marker("funktion|funktionen"), 2], [marker("klasse"), 2], [marker("datei|dateien"), 2],
    [marker("fehler"), 2], [marker("seite|seiten"), 2], [marker("datenbank"), 2],
    [marker("anwendung|anwendungen"), 2], [marker("benutzer"), 2], [marker("anmelden"), 2],
    [marker("einloggen"), 2], [marker("variablen"), 2], [marker("speichern"), 2],
    [marker("anzeigen"), 2], [marker("verbessern"), 2], [marker("optimieren"), 2],
    [marker("implementieren"), 2], [marker("schreiben"), 2], [marker("suchen"), 2],
    [marker("starten"), 2],
    [marker("der"), 1], [marker("die"), 1], [marker("das"), 1], [marker("den"), 1],
    [marker("dem"), 1], [marker("ein"), 1], [marker("eine"), 1], [marker("ist"), 1],
    [marker("mit"), 1], [marker("fur"), 1], [marker("und"), 1], [marker("auf"), 1],
    [marker("zu"), 1],
  ],
  pt: [
    [marker("criar|crie"), 3], [marker("fazer"), 3], [marker("adicionar"), 3],
    [marker("corrigir"), 3], [marker("preciso"), 3], [marker("quero"), 3],
    [marker("banco de dados"), 3],
    [marker("pagina|paginas"), 2], [marker("usuario|usuarios"), 2],
    [marker("arquivo|arquivos"), 2], [marker("codigo"), 2], [marker("mensagem"), 2],
    [marker("tela"), 2], [marker("configurar"), 2], [marker("instalar"), 2],
    [marker("melhorar"), 2], [marker("conectar"), 2], [marker("senha"), 2],
    [marker("rede"), 2], [marker("funcao"), 2], [marker("nao"), 2], [marker("tambem"), 2],
    [marker("uma"), 1], [marker("um"), 1], [marker("para"), 1], [marker("com"), 1],
    [marker("que"), 1], [marker("na"), 1], [marker("os"), 1], [marker("as"), 1],
    [marker("ao"), 1], [marker("mais"), 1],
  ],
};

function detectLanguage(prompt: string): string {
  if (/[\u0600-\u06FF]/.test(prompt)) return "ar";
  const folded = fold(prompt);
  let bestLang = "en";
  let bestScore = 0;
  let bestStrong = false;
  for (const lang of LANG_ORDER) {
    let score = 0;
    let strong = false;
    for (const [pattern, weight] of LANG_PATTERNS[lang]) {
      if (pattern.test(folded)) {
        score += weight;
        if (weight >= 3) strong = true;
      }
    }
    if (score < DETECT_MIN_SCORE) continue;
    const wins =
      bestScore === 0 ? true : strong !== bestStrong ? strong : score > bestScore;
    if (wins) {
      bestLang = lang;
      bestScore = score;
      bestStrong = strong;
    }
  }
  return bestLang;
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

const FR_EN: Array<[RegExp, string]> = [
  [word("base de donnees|base de données"), "database"],
  [word("page d'accueil|page daccueil|page d accueil"), "homepage"],
  [word("mot de passe"), "password"],
  [word("site web"), "website"],
  [word("mise a jour|mise à jour"), "update"],
  [word("tableau de bord"), "dashboard"],
  [word("code source"), "source code"],
  [word("en temps reel|en temps réel"), "realtime"],
  [word("formulaire de contact"), "contact form"],
  [word("point d'entree|point d entree|point d'entrée"), "entry point"],
  [word("se deconnecter|se déconnecter"), "logout"],
  [word("se connecter"), "login"],
  [word("corriger|corrige"), "fix"], [word("ajouter|ajoute|ajoutez"), "add"],
  [word("supprimer|supprime|supprimez|effacer|enlever"), "remove"],
  [word("creer|créer|creez|créez"), "create"], [word("developper|développer"), "develop"],
  [word("implementer|implémenter"), "implement"], [word("refactoriser|refactorer"), "refactor"],
  [word("configurer"), "configure"], [word("installer"), "install"], [word("migrer"), "migrate"],
  [word("ameliorer|améliorer"), "improve"], [word("amelioration|amélioration"), "improvement"],
  [word("optimiser"), "optimize"], [word("verifier|vérifier|verifie"), "verify"],
  [word("expliquer|explique"), "explain"], [word("afficher|affiche|montrer|montre"), "display"],
  [word("masquer|cacher"), "hide"], [word("activer"), "enable"],
  [word("desactiver|désactiver"), "disable"], [word("ecrire|écrire"), "write"],
  [word("sauvegarder|enregistrer"), "save"], [word("utiliser|utilise"), "use"],
  [word("remplacer"), "replace"], [word("simplifier"), "simplify"],
  [word("nettoyer"), "clean up"], [word("tester|teste|testez"), "test"],
  [word("deboguer|déboguer"), "debug"], [word("compiler"), "compile"],
  [word("deployer|déployer"), "deploy"], [word("rechercher|chercher"), "search"],
  [word("telecharger|télécharger"), "download"], [word("envoyer"), "send"],
  [word("ouvrir"), "open"], [word("fermer"), "close"],
  [word("fonction|fonctions"), "function"], [word("classe|classes"), "class"],
  [word("methode|méthode"), "method"], [word("fichier|fichiers"), "file"],
  [word("probleme|problème|problemes"), "issue"], [word("erreur|erreurs"), "error"],
  [word("serveur|serveurs"), "server"], [word("donnees|données"), "data"],
  [word("ecran|écran"), "screen"], [word("bouton|boutons"), "button"],
  [word("formulaire|formulaires"), "form"], [word("champ|champs"), "field"],
  [word("lien|liens"), "link"], [word("modele|modèle"), "model"],
  [word("schema|schéma"), "schema"], [word("reseau|réseau"), "network"],
  [word("securite|sécurité"), "security"], [word("utilisateur|utilisateurs"), "user"],
  [word("requete|requête"), "request"], [word("reponse|réponse"), "response"],
  [word("performances"), "performance"], [word("tableau"), "table"],
  [word("liste"), "list"], [word("boucle"), "loop"], [word("authentification"), "auth"],
  [word("inscription"), "register"], [word("connexion"), "login"],
  [word("dans"), "in"], [word("avec"), "with"], [word("pour"), "for"], [word("sur"), "on"],
  [word("sans"), "without"], [word("aussi"), "also"], [word("mais"), "but"],
  [word("pas"), "not"], [word("plus"), "more"], [word("tres|très"), "very"],
  [word("comment"), "how to"], [word("pourquoi"), "why"], [word("besoin"), "need"],
];

function translateTerms(prompt: string, lang: string): string {
  const map = lang === "ar" ? AR_EN : lang === "fr" ? FR_EN : null;
  if (!map) return prompt;
  let result = prompt;
  for (const [pattern, replacement] of map) result = result.replace(pattern, replacement);
  return result;
}

function optimizeEnglish(prompt: string): string {
  return prompt.trim()
    .replace(/^I\s+want\s+to\s+/i, "").replace(/^I\s+need\s+to\s+/i, "")
    .replace(/^Can\s+you\s+/i, "").replace(/^Could\s+you\s+/i, "").replace(/^Please\s+/i, "")
    .replace(/^I\s+would\s+like\s+to\s+/i, "").replace(/^It\s+would\s+be\s+great\s+if\s+you\s+could\s+/i, "")
    .replace(/[.!?]+$/, "").trim();
}

function rewritePrompt(prompt: string): RewriteResult {
  const sourceLanguage = detectLanguage(prompt);
  const rewritten = optimizeEnglish(translateTerms(prompt, sourceLanguage));
  return { original: prompt, rewritten, sourceLanguage, wasRewritten: rewritten !== prompt };
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
// P0-B: gate.enabled=false is no longer honored — a writable config must not
// silently disable enforcement (same rule as the CLI and the MCP tool).
// Only the env escape turns the gate off; gate.mode stays owned by the CLI.
const DISABLED = ["off", "0", "false", "no", "disabled"].includes(ESCAPE);
const GATE_TOOLS = new Set(
  (Array.isArray(GATE.tools) && GATE.tools.length > 0
    ? GATE.tools
    // MINEUR#8: cron tools that carry/execute shell commands are gated too —
    // cron_add_command_task was a bash-gate bypass. Keep in sync with
    // DEFAULT_CONFIG.gate.tools (src/spec.ts) and novahiz.config.json.
    : ["edit", "write", "patch", "apply_patch", "bash", "shell", "cron_add_command_task", "cron_update_command_task", "cron_update_task", "cron_run_task_now"]
  ).map((tool) => tool.toLowerCase())
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

// Inlined from src/gate-repair.ts — the installed plugin lives in
// ~/.config/opencode/plugins/ and cannot resolve ../../src/*.
type GateFailure = {
  tool: string;
  missingSkills: string[];
  reasons: string[];
  error: string | null;
};

function parseGateFailure(stdout: string): GateFailure | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const asStringArray = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  const tool = typeof record.tool === "string" && record.tool.length > 0 ? record.tool : "tool";
  return {
    tool,
    missingSkills: asStringArray(record.missingSkills),
    reasons: asStringArray(record.reasons),
    error: typeof record.error === "string" ? record.error : null
  };
}

function buildRepairDirective(failure: GateFailure, attempt: number): string {
  const head = `Novahiz gate blocked ${failure.tool}.`;
  const missing = failure.missingSkills;

  if (missing.length === 0) {
    const detail = failure.error ?? failure.reasons.join("; ") ?? "no reason reported";
    return `${head}\nBlocked by rule, not by a missing skill: ${detail}\nResolve the listed rule, then retry once. Never bypass the gate.`;
  }

  if (attempt <= 1) {
    const steps = missing.map((skill, index) => `  ${index + 1}. skill({name:"${skill}"})`).join("\n");
    return [
      `${head} Missing skills: ${missing.join(", ")}.`,
      "AUTO-REPAIR — execute now, do not ask the user, do not stop:",
      steps,
      `  ${missing.length + 1}. Retry this exact ${failure.tool} call once, then continue the user's task where it left off.`,
      "Never bypass the gate: no NOVAHIZ_GATE, no alternate tool, no shell write, no editing around the block."
    ].join("\n");
  }

  return [
    `${head} AUTO-REPAIR FAILED on attempt ${attempt}: still missing ${missing.join(", ")} after skill() loads.`,
    "The loads did not register — diagnose instead of retrying:",
    "  1. Confirm the skill is installed and the index matches (`novahiz doctor`).",
    "  2. Realign the index (`novahiz sync`), then load the named skills again.",
    "If the skill genuinely does not exist, report that honestly to the user and stop. Never bypass the gate."
  ].join("\n");
}

export const NovahizPlugin: Plugin = async ({ client }) => {
  const loadedBySession = new Map<string, Set<string>>();
  const categoriesBySession = new Map<string, string[]>();
  const enforcementBySession = new Map<string, string>();
  const lastSeenBySession = new Map<string, number>();
  // P0-B: reason of the last failed classify per session — gate tool calls are
  // refused while set, instead of running with empty categories (fail-open).
  const classifyFailedBySession = new Map<string, string>();
  // Auto-repair: denial count per `session|tool|missing set`. A first denial
  // carries the repair protocol; an identical repeat escalates to diagnosis
  // instead of looping. Cleared on a successful call of the same tool.
  const repairAttemptsBySession = new Map<string, number>();
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
    classifyFailedBySession.delete(sessionID);
    // Auto-repair keys are prefixed with the session ID — drop them too.
    for (const key of repairAttemptsBySession.keys()) {
      if (key.startsWith(`${sessionID}|`)) repairAttemptsBySession.delete(key);
    }
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

  if (GATE.enabled === false)
    await log("warn", "gate.enabled=false in config is ignored; enforcement stays active. Use NOVAHIZ_GATE=off to disable the gate.");
  if (DISABLED) await log("info", "Gate disabled via environment escape");

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

        // P0-B: the prompt travels on stdin. On argv it allowed option
        // injection (--home), broke past the Windows 32k limit, and was
        // readable in the process list.
        const result = run(["classify", "--stdin"], classifyText);
        if (result.status !== 0) {
          classifyFailedBySession.set(input.sessionID, `classify exit ${result.status}`);
          await log("warn", `Classify failed (exit ${result.status}), gate tool calls refused for this session: ${result.stderr.trim().slice(0, 200)}`);
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
          classifyFailedBySession.set(input.sessionID, "classify returned invalid JSON");
          await log("warn", "Classify returned invalid JSON, gate tool calls refused for this session");
          return;
        }
        // M5: the `as` cast is compile-time only — validate the shape at runtime
        // so a malformed classify response cannot silently disable enforcement.
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.categories)) {
          classifyFailedBySession.set(input.sessionID, "classify returned an unexpected structure");
          await log("warn", "Classify returned unexpected structure, gate tool calls refused for this session");
          return;
        }
        classifyFailedBySession.delete(input.sessionID);
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
        if (rewrite.sourceLanguage !== "en") {
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
        lines.push("The gate is content-aware: novahiz-humanizer, ui-slop-remover and ui-craft-rules are required only on frontend design tasks (R13), and impeccable on the same design selectors (R14).");
        lines.push("Config edited = opencode restart required (config read at import).");
        lines.push("Memory lives in project-memory/ under the project root (cwd): index.json + fixed-size slots (8000 chars / 200 lines) with compact → archive → new-slot rotation. Use the MCP memory_* tools to read and append.");
        enforcementBySession.set(input.sessionID, lines.join("\n"));
      } catch (error) {
        classifyFailedBySession.set(input.sessionID, "chat.message hook error");
        await log("warn", `chat.message hook failed, gate tool calls refused for this session: ${String(error).slice(0, 200)}`);
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
        const tool = input.tool.toLowerCase();
        const gated = !DISABLED && GATE_TOOLS.has(tool);
        // P0-B: an invalid session ID must not bypass the gate. Gate tools and
        // skill loads are refused; tools that need no enforcement still pass.
        if (!isValidSessionId(input.sessionID)) {
          if (gated || (!DISABLED && tool === "skill")) {
            throw new Error(
              `Novahiz gate blocked ${input.tool}: invalid session ID — loaded skills cannot be tracked. Fix the session or set NOVAHIZ_GATE=off to disable.`
            );
          }
          return;
        }
        touch(input.sessionID);
        if (!loadedBySession.has(input.sessionID)) loadedBySession.set(input.sessionID, new Set());
        const loaded = loadedBySession.get(input.sessionID)!;

        if (tool === "skill") {
          const args = output.args as { name?: unknown; skill?: unknown } | undefined;
          const raw = args?.name ?? args?.skill;
          if (raw !== undefined && raw !== null && typeof raw !== "string") {
            throw new Error("Novahiz gate blocked the skill load: the skill name must be a string.");
          }
          const name = typeof raw === "string" ? raw.trim() : "";
          // P0-B: no commas or spaces — the gate re-splits --loaded on commas,
          // so a loose name could inject extra "loaded" skills.
          if (name.length > 0 && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) {
            throw new Error(`Novahiz gate blocked the skill load: invalid skill name "${name.slice(0, 64)}".`);
          }
          if (name.length > 0) {
            // P0-B: record only after session-load validated the name against
            // the installed index — an unverified name never counts as loaded.
            // H3 stays: failures are surfaced in the log instead of vanishing.
            const loadResult = run(["session-load", "--session", input.sessionID, "--skill", name]);
            if (loadResult.status !== 0) {
              await log("warn", `session-load failed for skill ${name}, not recorded: ${(loadResult.stderr || loadResult.stdout || "").trim().slice(0, 200)}`);
            } else {
              loaded.add(name);
            }
          }
          return;
        }

        if (!gated) return;
        // P0-B: a failed classify would empty the session categories and
        // neutralize the prompt-scoped rules — refuse instead of failing open.
        const classifyFailure = classifyFailedBySession.get(input.sessionID);
        if (classifyFailure) {
          throw new Error(
            `Novahiz gate blocked ${input.tool}: prompt classification failed (${classifyFailure}). Fix the install (run "novahiz sync", check catalog/) and send a new message, or set NOVAHIZ_GATE=off to disable.`
          );
        }

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
          // Auto-repair: a structured denial becomes an executable directive
          // (load the named skills, retry the same call, resume the task).
          // Counting identical denials turns a failed repair into a diagnosis
          // instead of an infinite retry loop. The denial itself still stands
          // until the gate CLI sees the skills — nothing is granted here.
          const failure = parseGateFailure(result.stdout);
          if (failure) {
            const key = `${input.sessionID}|${failure.tool}|${[...failure.missingSkills].sort().join(",")}`;
            const attempt = (repairAttemptsBySession.get(key) ?? 0) + 1;
            repairAttemptsBySession.set(key, attempt);
            throw new Error(buildRepairDirective(failure, attempt));
          }
          throw new Error(`Novahiz gate blocked ${input.tool}.\n${result.stdout}`);
        }
        if (result.status !== 0) {
          throw new Error(
            `Novahiz gate unavailable (exit ${result.status}). Fix the install (run sync, check catalog/) or set the escape variable to disable.\n${result.stderr}`
          );
        }
        // The call is allowed: the repair converged — drop this session's
        // denial counters so the next task starts a fresh cycle.
        const allowedPrefix = `${input.sessionID}|${input.tool.toLowerCase()}|`;
        for (const key of repairAttemptsBySession.keys()) {
          if (key.startsWith(allowedPrefix)) repairAttemptsBySession.delete(key);
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
