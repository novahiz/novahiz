import type { Cleanup, Context, Plugin } from "@opencode/plugin/promise/plugin";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

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
  // Audit 2026-09-25 (TOCTOU): temp file + rename — a crash mid-write can no
  // longer truncate the state another reader is consuming.
  const target = statePath(cwd);
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, target);
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
const MCP = join(HOME, "mcp", "novahiz-tools", "index.mjs");
const NODE =
  process.env.NOVAHIZ_NODE && process.env.NOVAHIZ_NODE.length > 0 ? process.env.NOVAHIZ_NODE : "node";

type GateConfig = { enabled?: boolean; mode?: string; envEscape?: string; tools?: string[] };

// S-AUTO: forme brute du bloc memory.auto lue dans novahiz.config.json.
type MemoryAutoWriteConfig = {
  todoDone: boolean;
  review: boolean;
  taskEnd: boolean;
  compaction: boolean;
  spec: boolean;
};
type MemoryAutoReadConfig = {
  k: number;
  minScore: number;
  antiRepetition: boolean;
  postCompaction: boolean;
  // P3: plafond d'injection par session en tokens (~4 chars/token), heritage
  // sessions precedentes + resumes de pertinence compris. Defaut 1500.
  budgetTokens: number;
};
// V-AUTO: consultation automatique du vault second-memory (vault Obsidian
// officiel du systeme, cree a l'installation). every = cadence en occurrences
// de prompt (1 = chaque prompt, defaut 3 = "de temps en temps"), budgetTokens
// = plafond d'injection du bloc vault (~4 chars/token). Miroir de
// MemoryAutoVaultConfig dans src/spec.ts.
type MemoryAutoVaultConfig = {
  enabled: boolean;
  k: number;
  minScore: number;
  every: number;
  budgetTokens: number;
};
type MemoryAutoConfig = {
  enabled: boolean;
  write: MemoryAutoWriteConfig;
  read: MemoryAutoReadConfig;
  vault: MemoryAutoVaultConfig;
};
type NovahizConfig = { gate?: GateConfig; memory?: unknown };

/**
 * S-AUTO: resout le bloc memory.auto avec kill-switch d'environnement
 * NOVAHIZ_MEM_AUTO. Exporte tel quel pour les tests (pure function).
 *
 * - env NOVAHIZ_MEM_AUTO dans le vocabulaire off/0/false/no/disabled → null
 *   (meme vocabulaire que NOVAHIZ_GATE; la config ne peut pas le requalifier).
 * - memory.auto.enabled === false → null (desactivation explicite).
 * - sinon defauts full-on: T1-T5 tous actifs, lecture k=3 minScore=0.25
 *   anti-repetition + re-injection post-compaction + budget 1500 tokens —
 *   miroir de DEFAULT_CONFIG.memory.auto (src/spec.ts); le plugin installe
 *   ne peut pas resoudre ../../src/*, donc les defauts sont enonces ici aussi.
 * - toute valeur absente ou hors bornes retombe sur le defaut: une config
 *   corrompue ne desactive ni ne rend bruyant l'auto par accident.
 */
export function resolveMemoryAuto(raw: unknown, envValue: string | undefined): MemoryAutoConfig | null {
  if (["off", "0", "false", "no", "disabled"].includes(String(envValue ?? "").trim().toLowerCase())) return null;
  const memory = raw && typeof raw === "object" ? (raw as { auto?: unknown }).auto : undefined;
  const auto = memory && typeof memory === "object" ? (memory as Record<string, unknown>) : {};
  if (auto.enabled === false) return null;
  const writeRaw = auto.write && typeof auto.write === "object" ? (auto.write as Record<string, unknown>) : {};
  const readRaw = auto.read && typeof auto.read === "object" ? (auto.read as Record<string, unknown>) : {};
  const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
  const write: MemoryAutoWriteConfig = {
    todoDone: bool(writeRaw.todoDone, true),
    review: bool(writeRaw.review, true),
    taskEnd: bool(writeRaw.taskEnd, true),
    compaction: bool(writeRaw.compaction, true),
    spec: bool(writeRaw.spec, true)
  };
  const inRange = (value: unknown, min: number, max: number): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
  const read: MemoryAutoReadConfig = {
    k: inRange(readRaw.k, 1, 20) ? Math.trunc(readRaw.k) : 3,
    minScore: inRange(readRaw.minScore, 0, 1) ? readRaw.minScore : 0.25,
    antiRepetition: bool(readRaw.antiRepetition, true),
    postCompaction: bool(readRaw.postCompaction, true),
    budgetTokens: inRange(readRaw.budgetTokens, 100, 4000) ? Math.trunc(readRaw.budgetTokens) : 1500
  };
  // V-AUTO: vault second-memory — defauts full-on aussi (actif partout par
  // defaut, comme write/read), kill-switch partage NOVAHIZ_MEM_AUTO + reset
  // local memory.auto.vault.enabled=false. Miroir de src/spec.ts.
  const vaultRaw = auto.vault && typeof auto.vault === "object" ? (auto.vault as Record<string, unknown>) : {};
  const vault: MemoryAutoVaultConfig = {
    enabled: bool(vaultRaw.enabled, true),
    k: inRange(vaultRaw.k, 1, 10) ? Math.trunc(vaultRaw.k) : 3,
    minScore: inRange(vaultRaw.minScore, 0, 1) ? vaultRaw.minScore : 0.25,
    every: inRange(vaultRaw.every, 1, 100) ? Math.trunc(vaultRaw.every) : 3,
    budgetTokens: inRange(vaultRaw.budgetTokens, 100, 2000) ? Math.trunc(vaultRaw.budgetTokens) : 600
  };
  return { enabled: true, write, read, vault };
}

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
    // MINEUR#8 + 0.3.6 hardening: every clepsydre tool that carries, creates,
    // or executes shell commands is gated — clepsydre_add_shell_task was a
    // bash-gate bypass, and clepsydre_add_task / clepsydre_add_http_task each
    // accept a `command` field. clepsydre_remove_task mutates persisted state
    // and clepsydre_run_task_now executes immediately.
    // Audit 2026-09-25 (P1): snap_restore rolls back arbitrary files and
    // clepsydre_enable_task re-arms a disabled task — both gated too.
    // Keep in sync with DEFAULT_CONFIG.gate.tools (src/spec.ts), install/lib.mjs,
    // novahiz.config.example.json, the live novahiz.config.json, and
    // docs/CONFIGURATION.md.
    : ["edit", "write", "patch", "apply_patch", "bash", "shell", "snap_restore", "clepsydre_add_task", "clepsydre_add_shell_task", "clepsydre_add_http_task", "clepsydre_add_prompt_task", "clepsydre_update_task", "clepsydre_remove_task", "clepsydre_run_task_now", "clepsydre_enable_task"]
  ).map((tool) => tool.toLowerCase())
);

// S-AUTO: memoire automatique lue une fois a l'import, comme le gate.
// null = auto coupee (kill-switch NOVAHIZ_MEM_AUTO ou memory.auto.enabled=false).
const MEMORY_AUTO = resolveMemoryAuto(CONFIG.memory, process.env.NOVAHIZ_MEM_AUTO);

type RunResult = { status: number; stdout: string; stderr: string; spawnError?: string };

// C1: timeout bounds a hung CLI without freezing OpenCode. Raised 10 s -> 30 s
// (audit 2026-09-25, MEDIUM): gate/CLI runs legitimately exceeded 10 s on
// 23-24/09 and the cap turned them into spurious fail-closed refusals.
// Audit 2026-09-25 (finding 5): the runner is now async — spawnSync held the
// whole event loop for up to RUN_TIMEOUT_MS (frozen UI, serialized hooks).
// C2: maxBuffer caps output; oversized output is treated as a gate failure,
// never as truncated-then-allowed.
const RUN_TIMEOUT_MS = 30_000;
const RUN_MAX_BUFFER = 1_048_576;
// Audit 2026-09-25 (P2): catalog MCP servers were registered without a timeout
// — cold starts (argus, clepsydre) then died at the harness default mid-connect.
// The plugin API takes the structured form, not a plain number (opencode config).
const MCP_TIMEOUT = { startup: 120_000, catalog: 120_000, execution: 120_000 } as const;

function spawnNode(argv: string[], input?: string): Promise<RunResult> {
  return new Promise((resolveRun) => {
    // C1: On Windows, SIGTERM is emulated via process.kill() which sends
    // TerminateProcess + exit code 1, causing the CLI to report status 1 instead
    // of being properly terminated. Use SIGKILL on Windows (unavoidable but at
    // least doesn't pretend graceful shutdown is possible).
    const isWin = process.platform === "win32";
    let settled = false;
    const finish = (value: RunResult): void => {
      if (settled) return;
      settled = true;
      resolveRun(value);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(NODE, argv, {
        stdio: ["pipe", "pipe", "pipe"],
        // FIX fenetres console: sans ce cache, chaque lecture/ecriture/prompt
        // creait une console Windows visible puis la fermait (le service
        // OpenCode n'a pas de console a laquelle l'enfant pourrait s'attacher).
        windowsHide: true
      });
    } catch (error) {
      finish({ status: 1, stdout: "", stderr: "", spawnError: String(error) });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let overflow = false;
    const kill = (): void => {
      try {
        child.kill(isWin ? "SIGKILL" : "SIGTERM");
      } catch {
        // process already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, RUN_TIMEOUT_MS);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > RUN_MAX_BUFFER) {
        overflow = true;
        kill();
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > RUN_MAX_BUFFER) {
        overflow = true;
        kill();
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({ status: 1, stdout: "", stderr: "", spawnError: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (overflow) {
        finish({ status: 1, stdout, stderr, spawnError: "output exceeded the buffer cap" });
        return;
      }
      // Deterministic timeout flag replaces the old status/signal heuristic
      // (audit finding 11): the timer owns the decision, not the exit shape.
      if (timedOut) {
        finish({ status: 1, stdout: "", stderr: "Novahiz timed out" });
        return;
      }
      finish({ status: code ?? 1, stdout, stderr });
    });
    if (child.stdin) {
      child.stdin.on("error", () => {
        // reader gone before EOF — close() still fires
      });
      child.stdin.end(input ?? "");
    }
  });
}

async function run(args: string[], input?: string): Promise<RunResult> {
  return spawnNode([CLI, ...args], input);
}

type McpCall = { ok: boolean; data: Record<string, unknown> | null; error: string | null };

// S-AUTO: tour unique vers le serveur MCP (mode --call). Le plugin installe
// ne peut pas importer src/*, donc memory_write / memory_search / novahiz_task
// passent par le meme handle() que le transport stdio: une seule source de
// verite pour la validation, la dedup, le routage et le lock.
async function callMcp(tool: string, args: Record<string, unknown>): Promise<McpCall> {
  let payload: string;
  try {
    payload = JSON.stringify(args);
  } catch (error) {
    return { ok: false, data: null, error: `serialize failed: ${String(error)}` };
  }
  const result = await spawnNode([MCP, "--call", tool], payload);
  if (result.spawnError) return { ok: false, data: null, error: result.spawnError };
  const stdout = result.stdout.trim();
  if (stdout.length === 0) return { ok: false, data: null, error: `empty response (exit ${result.status})` };
  // --call n'imprime qu'une ligne JSON; la derniere ligne non vide couvre
  // quand meme d'eventuelles traces d'en-tete d'un sous-processus.
  const line = stdout.split(/\r?\n/).filter((entry) => entry.trim().length > 0).pop() ?? "";
  let envelope: unknown;
  try {
    envelope = JSON.parse(line);
  } catch {
    return { ok: false, data: null, error: `invalid JSON response: ${line.slice(0, 160)}` };
  }
  const record = envelope as { result?: { content?: unknown; isError?: boolean }; error?: { message?: unknown } };
  if (record.error) return { ok: false, data: null, error: String(record.error.message ?? "mcp error") };
  const content = record.result?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
                ? (part as { text: string }).text
                : ""
            )
            .join("\n")
        : "";
  if (record.result?.isError === true) return { ok: false, data: null, error: text.slice(0, 300) || "tool error" };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ok: true, data: parsed as Record<string, unknown>, error: null };
    }
    return { ok: true, data: { value: parsed }, error: null };
  } catch {
    // Les resultats texte simples ("no active task") ne sont pas du JSON:
    // on les rend tels quels pour l'appelant.
    return { ok: true, data: { text }, error: null };
  }
}

// S-AUTO: extraction du payload JSON d'un Tool.Result (content string ou
// tableau de blocs texte). Null si le resultat n'est pas du JSON d'objet.
function parseToolPayload(result: unknown): Record<string, unknown> | null {
  const content = (result as { content?: unknown } | undefined)?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) =>
              part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
                ? (part as { text: string }).text
                : ""
            )
            .join("\n")
        : "";
  if (text.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export type AutoTrigger = "todoDone" | "review" | "spec";
export type AutoReadHit = { id?: unknown; title?: unknown; score?: unknown; snippet?: unknown };

// S-AUTO: detection deterministic du trigger depuis un execute.after réussi.
// T1/T2 sur l'outil MCP novahiz_task (done/review), T5 sur l'edition des
// fichiers spec/config novahiz (nom de fichier, peu importe le repertoire).
export function autoWriteTrigger(tool: string, input: unknown): AutoTrigger | null {
  const name = String(tool).toLowerCase();
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (name.endsWith("novahiz_task")) {
    const action = typeof args.action === "string" ? args.action : "";
    if (action === "done") return "todoDone";
    if (action === "review") return "review";
    return null;
  }
  if (["edit", "write", "patch", "apply_patch"].includes(name)) {
    const raw =
      (typeof args.filePath === "string" && args.filePath) ||
      (typeof args.file_path === "string" && args.file_path) ||
      (typeof args.path === "string" && args.path) ||
      "";
    if (raw.length > 0 && isSpecConfigPath(raw)) return "spec";
  }
  return null;
}

export function isSpecConfigPath(path: string): boolean {
  const base = String(path).replace(/\\/g, "/").split("/").pop() ?? String(path);
  return base === "novahiz.config.json" || base === "novahiz.config.example.json";
}

// S-AUTO: contenu deterministe des faits auto-ecrits. Meme payload + meme
// session → meme bloc (la dedup sha256 de memory_write encaisse les replays).
export function buildAutoWrite(
  trigger: AutoTrigger,
  payload: Record<string, unknown>,
  ctx: { sessionID: string }
): { title: string; content: string; tags: string[] } | null {
  const iso = new Date().toISOString();
  const session = ctx.sessionID;
  if (trigger === "todoDone") {
    const label =
      typeof payload.label === "string" && payload.label.trim().length > 0
        ? payload.label.trim()
        : String(payload.id ?? "todo");
    const proof =
      typeof payload.proof === "string" && payload.proof.trim().length > 0
        ? payload.proof.trim()
        : "aucune preuve fournie";
    return {
      title: `Todo done: ${label}`.slice(0, 200),
      content: [
        // P2: provenance EN TETE de l'entree — qui, quoi, quand, lisible
        // sans deplier le reste (standard handoff).
        `Provenance: session ${session} | tache ${String(payload.task_id ?? "inconnu")} | ${iso}`,
        "T1 — capture automatique (todo done).",
        `todo: ${String(payload.id ?? "inconnu")}`,
        `tache: ${String(payload.task_id ?? "inconnu")}`,
        `label: ${label}`,
        `preuve: ${proof}`,
        `session: ${session}`,
        `horodatage: ${iso}`
      ].join("\n"),
      tags: ["auto", "todo-done"]
    };
  }
  if (trigger === "review") {
    const task = payload.task && typeof payload.task === "object" ? (payload.task as Record<string, unknown>) : {};
    const applied =
      payload.applied && typeof payload.applied === "object" ? (payload.applied as Record<string, unknown>) : {};
    const signals = Array.isArray(payload.signals) ? payload.signals.length : 0;
    const revision = payload.revision ?? "?";
    return {
      title: `Ledger review r${String(revision)}`.slice(0, 200),
      content: [
        `Provenance: session ${session} | tache ${String(task.id ?? "inconnu")} | ${iso}`,
        "T2 — capture automatique (review du ledger).",
        `revision: ${String(revision)}`,
        `tache: ${String(task.id ?? "inconnu")} — ${String(task.title ?? "sans titre")}`,
        `applied: +${String(applied.additions ?? 0)} additions, ~${String(applied.amendments ?? 0)} amendments, -${String(applied.removals ?? 0)} removals, reordered=${String(applied.reordered ?? false)}`,
        `signals: ${signals}`,
        `session: ${session}`,
        `horodatage: ${iso}`
      ].join("\n"),
      tags: ["auto", "review"]
    };
  }
  const path = String(payload.path ?? "novahiz.config.json");
  const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
  return {
    title: `Spec change: ${base}`.slice(0, 200),
    content: [
      `Provenance: session ${session} | ${iso}`,
      "T5 — capture automatique (spec/config novahiz modifie).",
      `fichier: ${path}`,
      `outil: ${String(payload.tool ?? "edit")}`,
      "La config est lue a l'import: redemarrer opencode pour appliquer le changement.",
      `session: ${session}`,
      `horodatage: ${iso}`
    ].join("\n"),
    tags: ["auto", "spec"]
  };
}

// S-AUTO (R1-R3): filtre k / minScore / anti-repetition, puis formatage des
// lignes de resume injectees dans le bloc d'enforcement du prompt, suivies de
// la directive de consultation. Retourne les ids retenus et les lignes de
// detail (alignees sur injectedIds) pour que l'appelant les accumule dans la
// fenetre anti-repetition de la session.
export const MEMORY_READ_DIRECTIVE =
  "Directive: call memory_get(id) for the full slot before re-deriving anything already known; append session-surviving facts via memory_write.";

export function summaryHeader(count: number, read: MemoryAutoReadConfig): string {
  return `[Novahiz memory] auto-injected summaries (${count}/${read.k}, minScore ${read.minScore}):`;
}

// S-AUTO: la requete de recherche est la TETE du prompt, bornee a des tokens.
// rankSlots normalise par le nombre de tokens de la requete (maxRaw ∝ |query|):
// un prompt complet, ou seul un sous-ensemble de tokens matche la slot, tombe
// toujours sous le seuil 0.25 (observe en E2E: prompt complet = 0.223, requete
// concentree = 0.506). Concentrer la requete sur l'intention en tete de prompt
// preserve la porte du seuil sans le modifier.
export function autoReadQuery(text: string, maxTokens = 16): string {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  return words.slice(0, maxTokens).join(" ");
}

// S-AUTO: fenetre glissante anti-repetition — un id deja injecte n'entre
// jamais deux fois; la fenetre garde au plus k resumes (FIFO) pour que le
// bloc reste borne tout en persistant d'un prompt a l'autre (le bloc est
// reconstruit a chaque prompt: sans accumulation, les resumes disparaitraient
// des que le second prompt).
export function mergeSummaryWindow(
  state: { ids: string[]; details: string[] },
  freshIds: readonly string[],
  freshDetails: readonly string[],
  k: number
): { ids: string[]; details: string[] } {
  const ids = [...state.ids];
  const details = [...state.details];
  freshIds.forEach((id, index) => {
    if (ids.includes(id)) return;
    const line = freshDetails[index];
    if (typeof line !== "string" || line.length === 0) return;
    ids.push(id);
    details.push(line);
  });
  while (ids.length > k) {
    ids.shift();
    details.shift();
  }
  return { ids, details };
}

// V-AUTO: vault officiel du systeme — cree par l'installateur a
// `~/Documents/second-memory` (NOVAHIZ_SM_VAULT pour tests/overrides).
export const VAULT_ROOT: string =
  process.env.NOVAHIZ_SM_VAULT && process.env.NOVAHIZ_SM_VAULT.trim().length > 0
    ? process.env.NOVAHIZ_SM_VAULT
    : join(homedir(), "Documents", "second-memory");

type VaultHitLike = { rel?: unknown; title?: unknown; score?: unknown; snippet?: unknown };

// V-AUTO: formatage des hits `second-memory search --json` en lignes
// d'injection (une ligne chemin+titre+score, une ligne extrait tronque),
// filtres k / minScore. Exporte tel quel pour les tests (pure function).
export function buildVaultLines(
  hits: readonly VaultHitLike[],
  cfg: MemoryAutoVaultConfig
): { injectedRels: string[]; details: string[] } {
  const injectedRels: string[] = [];
  const details: string[] = [];
  for (const hit of hits) {
    if (injectedRels.length >= cfg.k) break;
    if (!hit || typeof hit.rel !== "string" || hit.rel.length === 0) continue;
    if (typeof hit.score === "number" && hit.score < cfg.minScore) continue;
    const title = typeof hit.title === "string" && hit.title.length > 0 ? hit.title : hit.rel;
    const score = typeof hit.score === "number" ? hit.score.toFixed(2) : "-";
    injectedRels.push(hit.rel);
    details.push(`- ${hit.rel} [${score}] — ${title}`);
    if (typeof hit.snippet === "string" && hit.snippet.trim().length > 0) {
      details.push(`  ${hit.snippet.replace(/\s+/g, " ").trim().slice(0, 220)}`);
    }
  }
  return { injectedRels, details };
}

// --- P3: heritage inter-sessions (injection au demarrage) -----------------
// L'index porte id/title/updated/status/tags (SlotMeta, src/memory.ts); le
// plugin installe ne resout pas ../../src/*, donc le type est re-declare ici.
export type MemorySlotMeta = {
  id?: unknown;
  title?: unknown;
  updated?: unknown;
  status?: unknown;
  tags?: unknown;
  file?: unknown;
};
export type InheritanceEntry = { id: string; title: string; updated: string };
export type RuleEntry = { id: string; title: string };

// Regle durable = slot dont le titre ou les tags portent "regle-durable" ou
// "rule-durable" (graphies sans accents, accord inclus via normalization).
// Les slots non-active sortent de l'heritage: on ne ressuscite pas du mort.
export function pickInheritance(slots: readonly MemorySlotMeta[]): {
  recent: InheritanceEntry[];
  rules: RuleEntry[];
} {
  const active: MemorySlotMeta[] = [];
  for (const slot of slots) {
    if (slot.status !== undefined && slot.status !== "active") continue;
    if (typeof slot.id !== "string" || slot.id.length === 0) continue;
    active.push(slot);
  }
  const rules: RuleEntry[] = [];
  const rest: MemorySlotMeta[] = [];
  for (const slot of active) {
    const title = typeof slot.title === "string" && slot.title.length > 0 ? slot.title : String(slot.id);
    const tags = Array.isArray(slot.tags)
      ? slot.tags.filter((tag): tag is string => typeof tag === "string").join(" ")
      : "";
    const haystack = `${title} ${tags}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (haystack.includes("regle-durable") || haystack.includes("rule-durable")) {
      rules.push({ id: String(slot.id), title });
    } else {
      rest.push(slot);
    }
  }
  // Recent d'abord: updated decroissant, top 3 — au-delà, la recherche lazy
  // (directive memory_search) couvre, le budget a un plafond a respecter.
  rest.sort((a, b) => String(b.updated ?? "").localeCompare(String(a.updated ?? "")));
  const recent = rest.slice(0, 3).map((slot) => ({
    id: String(slot.id),
    title: typeof slot.title === "string" && slot.title.length > 0 ? slot.title : String(slot.id),
    updated: typeof slot.updated === "string" ? slot.updated : ""
  }));
  return { recent, rules: rules.slice(0, 3) };
}

// P3: format pur sous budget de caracteres — sections « recent d'abord » puis
// « regles durables », jamais plus que maxChars. `session` (provenance) est
// optionnel par entree: extrait de la 1re ligne « Provenance: » du slot si
// l'ecriture etait auto (T1/T2/T5), absent sinon.
export function formatInheritance(
  recent: readonly (InheritanceEntry & { session?: string })[],
  rules: readonly RuleEntry[],
  maxChars: number
): string[] {
  if (recent.length === 0 && rules.length === 0) return [];
  const lines: string[] = [];
  let used = 0;
  const push = (line: string): boolean => {
    if (used + line.length + 1 > maxChars) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };
  if (recent.length > 0 && push("Heritage des sessions precedentes (recent d'abord):")) {
    for (const entry of recent) {
      const date = entry.updated.slice(0, 10);
      const where = [date, entry.session].filter((part): part is string => Boolean(part)).join(", ");
      if (!push(`  - ${entry.id}${where ? ` (${where})` : ""} — ${entry.title}`)) break;
    }
  }
  if (rules.length > 0 && push("Regles durables:")) {
    for (const entry of rules) {
      if (!push(`  - ${entry.id} — ${entry.title}`)) break;
    }
  }
  return lines;
}

// P3: plafond commun du bloc d'injection (~4 chars/token). On empile ligne a
// ligne en gardant l'ordre (recent puis pertinent) et on s'arrete au premier
// depassement: au-delà, la directive de recherche lazy reste la porte de sortie.
export function applyInjectionBudget(lines: readonly string[], maxChars: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > maxChars) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept;
}

export function buildAutoReadLines(
  hits: readonly AutoReadHit[],
  read: MemoryAutoReadConfig,
  injected: ReadonlySet<string>,
  maxChars: number = Number.POSITIVE_INFINITY
): { lines: string[]; injectedIds: string[]; details: string[] } {
  const kept: string[] = [];
  const detail: string[] = [];
  const seen = new Set(injected);
  for (const hit of hits) {
    if (kept.length >= read.k) break;
    const id = typeof hit.id === "string" ? hit.id : "";
    const score = typeof hit.score === "number" && Number.isFinite(hit.score) ? hit.score : -1;
    if (id.length === 0 || score < read.minScore) continue;
    if (read.antiRepetition && seen.has(id)) continue;
    const title = typeof hit.title === "string" && hit.title.trim().length > 0 ? hit.title.trim() : id;
    const snippet = typeof hit.snippet === "string" ? hit.snippet.trim() : "";
    detail.push(`  - ${id} (score ${score.toFixed(2)}): ${snippet.length > 0 ? `${title} — ${snippet}` : title}`);
    kept.push(id);
    seen.add(id);
  }
  if (kept.length === 0) return { lines: [], injectedIds: [], details: [] };
  // P3: le budget de tokens porte sur les lignes de detail (en-tete et
  // directive restent: fixes et courts). Les ids suivent les lignes conservees.
  const trimmed = applyInjectionBudget(detail, maxChars);
  if (trimmed.length === 0) return { lines: [], injectedIds: [], details: [] };
  return {
    lines: [summaryHeader(trimmed.length, read), ...trimmed, MEMORY_READ_DIRECTIVE],
    injectedIds: kept.slice(0, trimmed.length),
    details: trimmed
  };
}

// H2: Session IDs must be non-empty strings. This guards against undefined/null
// being passed to the spawn env, which would throw on Windows.
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
    // Always add novahiz-gate: it explains why the block happened and how to
    // satisfy the rule, which is what the agent needs before retrying.
    const loads = missing.includes("novahiz-gate") ? missing : [...missing, "novahiz-gate"];
    const steps = loads.map((skill, index) => `  ${index + 1}. skill({id:"${skill}"})`).join("\n");
    return [
      `${head} Missing skills: ${missing.join(", ")}.`,
      "GATE RELOAD — execute now, do not ask the user, do not stop:",
      steps,
      `  ${loads.length + 1}. Retry this exact ${failure.tool} call once, then continue the user's task where it left off.`,
      "Never bypass the gate: no NOVAHIZ_GATE, no alternate tool, no shell write, no editing around the block."
    ].join("\n");
  }

  return [
    `${head} GATE RELOAD FAILED on attempt ${attempt}: still missing ${missing.join(", ")} after skill() loads.`,
    "The loads did not register — diagnose instead of retrying:",
    "  1. Confirm the skill is installed and the index matches (`novahiz doctor`).",
    "  2. Realign the index (`novahiz sync`), then load the named skills again.",
    "  3. If doctor shows the skill installed for another root but not this one (for example ~/.agents/skills vs ~/.config/opencode/skills), run `novahiz install --yes` to place it, restart opencode so it discovers the new skills, then load again.",
    "If the skill genuinely does not exist, report that honestly to the user and stop. Never bypass the gate."
  ].join("\n");
}

async function setup(ctx: Context): Promise<Cleanup> {
  const loadedBySession = new Map<string, Set<string>>();
  const categoriesBySession = new Map<string, string[]>();
  const enforcementBySession = new Map<string, string>();
  const lastSeenBySession = new Map<string, number>();
  // P0-B: reason of the last failed classify per session — gate tool calls are
  // refused while set, instead of running with empty categories (fail-open).
  const classifyFailedBySession = new Map<string, string>();
  // Gate reload: denial count per `session|tool|missing set`. A first denial
  // carries the reload protocol; an identical repeat escalates to diagnosis
  // instead of looping. Cleared on a successful call of the same tool.
  const repairAttemptsBySession = new Map<string, number>();
  // S-AUTO: injection memoire par session — fenetre glissante des resumes
  // deja injectes (ids + lignes, anti-repetition par id, FIFO borne a k),
  // dernier prompt (requete de recherche post-compaction), directives posees
  // (T3 fin de tache / T4 compaction) qui survivent au rebuild du bloc a
  // chaque prompt, chunk de resumes courant (remplacement post-compaction)
  // et cles de directive T3 deja posees.
  const autoReadBySession = new Map<string, { ids: string[]; details: string[] }>();
  // V-AUTO: fenetre de notes vault re-injectee entre deux consultations, et
  // compteur de prompts pour la cadence memory.auto.vault.every.
  const vaultWindowBySession = new Map<string, { rels: string[]; details: string[] }>();
  const vaultCountBySession = new Map<string, number>();
  const lastPromptBySession = new Map<string, string>();
  const directivesBySession = new Map<string, string[]>();
  const summaryChunkBySession = new Map<string, string[]>();
  // P3: bloc d'heritage construit UNE fois au demarrage de la session (premier
  // prompt), re-emis ensuite a chaque prompt — la memoire des sessions
  // precedentes du projet ne disparait pas du bloc reconstruit.
  const inheritanceBySession = new Map<string, string[]>();
  const taskEndDirectiveBySession = new Set<string>();
  const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

  // OpenCode V2 dropped client.app.log: plugin diagnostics go through console,
  // which the service keeps with the rest of its output.
  const log = async (level: "info" | "warn", message: string): Promise<void> => {
    try {
      const line = `[Novahiz] ${message}`;
      if (level === "warn") console.warn(line);
      else console.log(line);
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
    autoReadBySession.delete(sessionID);
    lastPromptBySession.delete(sessionID);
    directivesBySession.delete(sessionID);
    summaryChunkBySession.delete(sessionID);
    inheritanceBySession.delete(sessionID);
    // Gate reload keys are prefixed with the session ID — drop them too.
    for (const key of repairAttemptsBySession.keys()) {
      if (key.startsWith(`${sessionID}|`)) repairAttemptsBySession.delete(key);
    }
    // S-AUTO: les cles de directive T3 sont prefixees par la session.
    for (const key of taskEndDirectiveBySession) {
      if (key.startsWith(`${sessionID}|`)) taskEndDirectiveBySession.delete(key);
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

  ensureProjectMemory(process.cwd());

  // S-AUTO: aides d'auto-capture/auto-lecture — fermetures de session (etat,
  // logs et enforcement restent dans le meme scope que les hooks).
  //
  // Une directive (T3 fin de tache / T4 compaction) est posee une seule fois
  // par session et survive au rebuild du bloc a chaque prompt — sinon le
  // prompt suivant l'effacerait au moment precis ou elle doit pousser
  // l'agent a ecrire la synthese. Retourne true si la directive vient
  // d'etre posee (log d'observation).
  const appendDirective = (sessionID: string, text: string): boolean => {
    const posted = directivesBySession.get(sessionID) ?? [];
    if (posted.includes(text)) return false;
    directivesBySession.set(sessionID, [...posted, text]);
    const current = enforcementBySession.get(sessionID);
    enforcementBySession.set(sessionID, current ? `${current}\n${text}` : `[Novahiz enforcement]\n${text}`);
    return true;
  };

  const autoWriteFact = async (trigger: AutoTrigger, payload: Record<string, unknown>, sessionID: string): Promise<void> => {
    const fact = buildAutoWrite(trigger, payload, { sessionID });
    if (!fact) return;
    const call = await callMcp("memory_write", { title: fact.title, content: fact.content, tags: fact.tags });
    if (!call.ok) {
      void log("warn", `memory auto-write (${trigger}) failed: ${call.error}`);
      return;
    }
    const slot = call.data ? (call.data.slot as { id?: unknown } | undefined) : undefined;
    const id = slot && typeof slot === "object" && typeof slot.id === "string" ? slot.id : "slot-inconnu";
    void log("info", `memory auto-write ${trigger} -> ${id}`);
  };

  // S-AUTO (T3): apres un todo done, interroge l'etat de la tache — quand
  // elle vient de se terminer (done/abandoned), pose une seule fois la
  // directive de synthese de fin de tache dans le bloc d'enforcement.
  const checkTaskEnd = async (taskId: string, sessionID: string): Promise<void> => {
    const key = `${sessionID}|${taskId}`;
    if (taskEndDirectiveBySession.has(key)) return;
    const call = await callMcp("novahiz_task", { action: "status", task: taskId });
    const task = call.ok && call.data ? (call.data.task as { status?: unknown } | null) : null;
    const status = task && typeof task === "object" && typeof task.status === "string" ? task.status : "";
    if (status !== "done" && status !== "abandoned") return;
    taskEndDirectiveBySession.add(key);
    appendDirective(
      sessionID,
      `Task ${taskId} finished (${status}) — synthesis directive (T3): write ONE structured handoff entry to project-memory now (memory_write), provenance (session + date) first, then four sections: ## Decisions / ## Details techniques / ## Questions ouvertes / ## Prochaines etapes (agent-handoff standard).`
    );
    void log("info", `task end directive posted (T3) for ${taskId}: ${status}`);
  };

  // S-AUTO (R1-R3): recherche de resumes + anti-repetition. La fenetre de
  // resumes persiste d'un prompt a l'autre (le bloc est reconstruit a chaque
  // prompt): seuls les ids nouveaux entrent, FIFO borne a k — un meme resume
  // n'est jamais injecte deux fois, mais il ne disparait pas au prompt
  // suivant. Retourne le chunk complet a pousser et le nombre de nouveaux
  // ids (log d'observation). Pas de spawn si le project-memory est vide.
  // P3: bloc d'heritage au demarrage — partition pure (pickInheritance) puis
  // provenance session lue sur la 1re ligne des slots recents ("Provenance: "
  // posee par T1/T2/T5, absente sinon). Construit UNE fois, re-emis ensuite.
  const buildInheritanceBlock = (slots: readonly MemorySlotMeta[], maxChars: number): string[] => {
    try {
      const picked = pickInheritance(slots);
      const recent = picked.recent.map((entry) => {
        const file = slots.find((slot) => slot.id === entry.id)?.file;
        if (typeof file !== "string" || file.length === 0) return entry;
        try {
          const firstLine = readFileSync(join(process.cwd(), "project-memory", file), "utf8").split("\n", 1)[0] ?? "";
          const match = /^Provenance: session (\S+)/.exec(firstLine);
          return match ? { ...entry, session: match[1] } : entry;
        } catch {
          return entry;
        }
      });
      return formatInheritance(recent, picked.rules, maxChars);
    } catch {
      return [];
    }
  };

  const buildAutoRead = async (
    sessionID: string,
    query: string
  ): Promise<{ lines: string[]; newCount: number }> => {
    if (!MEMORY_AUTO) return { lines: [], newCount: 0 };
    try {
      let state: { ids: string[]; details: string[] } = autoReadBySession.get(sessionID) ?? { ids: [], details: [] };
      let newCount = 0;
      let active = 0;
      let slots: MemorySlotMeta[] = [];
      try {
        const index = JSON.parse(readFileSync(join(process.cwd(), "project-memory", "index.json"), "utf8")) as {
          slots?: unknown;
        };
        slots = Array.isArray(index.slots)
          ? index.slots.filter((slot): slot is MemorySlotMeta => Boolean(slot) && typeof slot === "object")
          : [];
        active = slots.filter((slot) => slot.status !== "archived").length;
      } catch {
        active = 0;
        slots = [];
      }
      // P3: plafond d'injection (~4 chars/token) — heritage d'abord (demarrage
      // de session), puis la fenetre de resumes dans le reliquat de budget.
      const budgetChars = MEMORY_AUTO.read.budgetTokens * 4;
      let inherit = inheritanceBySession.get(sessionID);
      if (!inherit) {
        inherit = buildInheritanceBlock(slots, budgetChars);
        // On ne fige que ce qui a reussi: un index illisible au premier
        // prompt ne condamne pas la session — le build reprend au prompt
        // suivant, idempotent et peu couteux, jusqu'au premier succes.
        if (inherit.length > 0) inheritanceBySession.set(sessionID, inherit);
      }
      if (active > 0) {
        const limit = Math.min(20, Math.max(MEMORY_AUTO.read.k * 3, 6));
        // Tete du prompt (voir autoReadQuery): la longueur dilue le score fold.
        const call = await callMcp("memory_search", { query: autoReadQuery(query), limit });
        if (!call.ok || !call.data) {
          // info (console.log) et non warn: seul ce canal est capture par les
          // logs opencode — observe en E2E serve --print-logs --log-level all.
          void log("info", `memory auto-read skipped: ${call.error}`);
        } else {
          const results = Array.isArray(call.data.results) ? (call.data.results as AutoReadHit[]) : [];
          const fresh = buildAutoReadLines(results, MEMORY_AUTO.read, new Set(state.ids));
          if (fresh.injectedIds.length > 0) {
            newCount = fresh.injectedIds.length;
            // Anti-repetition desactivee: la fenetre est remplacee a chaque
            // recherche — les memes resumes sont re-injectes volontairement.
            state = MEMORY_AUTO.read.antiRepetition
              ? mergeSummaryWindow(state, fresh.injectedIds, fresh.details, MEMORY_AUTO.read.k)
              : { ids: [...fresh.injectedIds], details: [...fresh.details] };
          } else {
            void log(
              "info",
              `memory auto-read: ${results.length} result(s), 0 injected (minScore ${MEMORY_AUTO.read.minScore})`
            );
          }
        }
      } else {
        void log("info", "memory auto-read: no active slots in project-memory/index.json");
      }
      autoReadBySession.set(sessionID, state);
      const inheritUsed = inherit.reduce((sum, line) => sum + line.length + 1, 0);
      const keptDetails = applyInjectionBudget(state.details, Math.max(0, budgetChars - inheritUsed));
      const lines = [...inherit];
      if (keptDetails.length > 0) {
        lines.push(summaryHeader(keptDetails.length, MEMORY_AUTO.read), ...keptDetails);
      }
      // La directive de recherche lazy reste toujours quand un bloc existe:
      // c'est la porte de sortie au-dela du budget (recherche lazy P3).
      if (lines.length > 0) lines.push(MEMORY_READ_DIRECTIVE);
      return { lines, newCount };
    } catch (error) {
      void log("info", `memory auto-read failed: ${String(error).slice(0, 200)}`);
      return { lines: [], newCount: 0 };
    }
  };

  // V-AUTO: consultation automatique du vault second-memory. Aller simple via
  // la CLI (`second-memory search --json`) : le plugin installe ne peut pas
  // importer src/*, donc le ranking reel est celui de la CLI — une seule
  // source de verite pour l'agent et pour l'injection. Cadence every (defaut
  // 3) : le 1er prompt consulte toujours, la fenetre est re-emise entre deux
  // consultations pour que les notes restent dans le contexte.
  const buildVaultRead = async (
    sessionID: string,
    query: string
  ): Promise<{ lines: string[]; newCount: number }> => {
    if (!MEMORY_AUTO || !MEMORY_AUTO.vault.enabled) return { lines: [], newCount: 0 };
    try {
      let state = vaultWindowBySession.get(sessionID) ?? { rels: [], details: [] };
      let newCount = 0;
      const n = (vaultCountBySession.get(sessionID) ?? 0) + 1;
      vaultCountBySession.set(sessionID, n);
      if ((n - 1) % MEMORY_AUTO.vault.every === 0) {
        if (!existsSync(VAULT_ROOT)) {
          if (n === 1) void log("info", `vault auto-consult skipped: ${VAULT_ROOT} absent`);
        } else {
          const call = await run([
            "second-memory",
            "search",
            autoReadQuery(query, 24),
            `--k=${MEMORY_AUTO.vault.k}`,
            `--min-score=${MEMORY_AUTO.vault.minScore}`,
            "--json"
          ]);
          if (call.status !== 0 || call.stdout.trim().length === 0) {
            void log("info", `vault auto-consult failed: ${call.stderr.slice(0, 200) || `exit ${call.status}`}`);
          } else {
            try {
              const parsed = JSON.parse(call.stdout) as { hits?: unknown };
              const hits = Array.isArray(parsed.hits) ? (parsed.hits as VaultHitLike[]) : [];
              const fresh = buildVaultLines(hits, MEMORY_AUTO.vault);
              if (fresh.injectedRels.length > 0) {
                newCount = fresh.injectedRels.length;
                state = { rels: fresh.injectedRels, details: fresh.details };
              } else {
                void log(
                  "info",
                  `vault auto-consult: ${hits.length} hit(s), 0 injected (minScore ${MEMORY_AUTO.vault.minScore})`
                );
              }
            } catch {
              void log("info", "vault auto-consult: invalid JSON from second-memory search");
            }
          }
        }
      }
      if (state.rels.length === 0) return { lines: [], newCount };
      vaultWindowBySession.set(sessionID, state);
      const kept = applyInjectionBudget(state.details, MEMORY_AUTO.vault.budgetTokens * 4);
      const lines = [
        `[Novahiz memory] vault second-memory auto-consulted (${state.rels.length}/${MEMORY_AUTO.vault.k}):`,
        ...kept,
        `Vault: ${VAULT_ROOT} — read a full note with the read tool on <vault>/<rel>; re-search: novahiz second-memory search "<terms>".`
      ];
      return { lines, newCount };
    } catch (error) {
      void log("info", `vault auto-consult failed: ${String(error).slice(0, 200)}`);
      return { lines: [], newCount: 0 };
    }
  };

  // V1 `config` hook → MCP transform. Audit 2026-10-08 : le transform partait
  // APRES l'attente du spawn `providers --mcp-json` (~0,5-1s) et arrivait trop
  // tard — aucun serveur lié, aucun avertissement au log. Le trio runtime part
  // donc en premier, avant toute await ; le catalogue compose en second
  // transform (les transforms se cumulent dans leur domaine). Les callbacks
  // restent synchrones et sans effet de bord un seul. En pratique la config
  // statique de l'installateur porte deja les entrees : editor.get(id) les
  // saute, sans doublon.
  if (!DISABLED) {
    try {
      await ctx.mcp.transform((editor) => {
        // A server configured by the user wins over the catalog registration.
        // Audit 2026-09-25 (P2): novahiz-scan joined the hard-coded trio — when
        // `providers --mcp-json` fails, argus must not vanish from the harness.
        if (!editor.get("novahiz-core")) {
          editor.set("novahiz-core", { type: "local", command: [NODE, join(HOME, "mcp", "novahiz-tools", "index.mjs")], timeout: MCP_TIMEOUT });
        }
        // The gate is its own server since the extraction: same fallback rule.
        if (!editor.get("novahiz-gate")) {
          editor.set("novahiz-gate", { type: "local", command: [NODE, join(HOME, "mcp", "novahiz-gate", "index.mjs")], timeout: MCP_TIMEOUT });
        }
        if (!editor.get("novahiz-scan")) {
          editor.set("novahiz-scan", { type: "local", command: [NODE, join(HOME, "mcp", "argus", "src", "cli.mjs")], timeout: MCP_TIMEOUT });
        }
      });
      const providers = await run(["providers", "--mcp-json"]);
      const entries: Record<string, unknown> = {};
      if (providers.status === 0 && providers.stdout.trim().length > 0) {
        try {
          Object.assign(entries, JSON.parse(providers.stdout) as Record<string, unknown>);
        } catch {
          await log("warn", "Providers returned invalid JSON, MCP auto-register skipped");
        }
      } else if (providers.status !== 0) {
        await log("warn", `Providers command failed (exit ${providers.status}), MCP auto-register skipped`);
      }
      if (Object.keys(entries).length > 0) {
        await ctx.mcp.transform((editor) => {
          for (const [id, raw] of Object.entries(entries)) {
            if (editor.get(id)) continue;
            const entry = raw as { type?: unknown; command?: unknown; url?: unknown; enabled?: unknown };
            // V2 replaced `enabled` with `disabled`: an explicit `enabled: false`
            // is carried across instead of silently flipping the server on.
            const disabled = entry.enabled === false ? { disabled: true as const } : {};
            if (entry.type === "remote" && typeof entry.url === "string") {
              editor.set(id, { type: "remote", url: entry.url, timeout: MCP_TIMEOUT, ...disabled });
            } else if (
              entry.type === "local" &&
              Array.isArray(entry.command) &&
              entry.command.every((part) => typeof part === "string")
            ) {
              editor.set(id, { type: "local", command: entry.command as string[], timeout: MCP_TIMEOUT, ...disabled });
            }
          }
        });
      }
    } catch (error) {
      await log("warn", `MCP registration failed: ${String(error).slice(0, 200)}`);
    }
  }

  // V1 `event` hook → subscription on the public event stream, aborted from the
  // cleanup function returned by setup.
  const events = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: events.signal })) {
        if (event.type === "session.idle") {
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
        } else if (event.type === "session.deleted") {
          const sessionID = event.data?.sessionID;
          if (sessionID) forget(sessionID);
        }
      }
    } catch {
      // stream closed while the plugin unloads
    }
  })();

  // V1 `chat.message` → prompt admission hook.
  await ctx.session.hook("prompt", async (event) => {
    ensureProjectMemory(process.cwd());
    if (DISABLED) return;
    const sessionID = event.sessionID;
    try {
      if (!isValidSessionId(sessionID)) return;
      touch(sessionID);
      const text = (event.prompt?.text ?? "").trim();
      if (text.length === 0) return;

      // Prompt rewriter: translate non-English prompts to optimized English
      // before classification. Responses always match the user's language.
      const rewrite = rewritePrompt(text);
      const classifyText = rewrite.rewritten;
      if (rewrite.wasRewritten) {
        // Audit 2026-09-25 (privacy): log the language and size, never the
        // prompt content — opencode logs land on disk in cleartext.
        await log("info", `Prompt rewritten: ${rewrite.sourceLanguage} → English (${classifyText.length} chars)`);
      }

      // P0-B: the prompt travels on stdin. On argv it allowed option
      // injection (--home), broke past the Windows 32k limit, and was
      // readable in the process list.
      const result = await run(["classify", "--stdin"], classifyText);
      if (result.status !== 0) {
        classifyFailedBySession.set(sessionID, `classify exit ${result.status}`);
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
        classifyFailedBySession.set(sessionID, "classify returned invalid JSON");
        await log("warn", "Classify returned invalid JSON, gate tool calls refused for this session");
        return;
      }
      // M5: the `as` cast is compile-time only — validate the shape at runtime
      // so a malformed classify response cannot silently disable enforcement.
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.categories)) {
        classifyFailedBySession.set(sessionID, "classify returned an unexpected structure");
        await log("warn", "Classify returned unexpected structure, gate tool calls refused for this session");
        return;
      }
      classifyFailedBySession.delete(sessionID);
      const categories = (parsed.categories ?? []).map((entry) => entry.id);
      categoriesBySession.set(sessionID, categories);
      // P1-4: the gate takes the last prompt as its tier seed via --prompt even
      // when memory auto is off — set unconditionally, not inside MEMORY_AUTO.
      lastPromptBySession.set(sessionID, text.slice(0, 300));
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
      const ledger = await run(["task", "current", "--session", sessionID]);
      if (ledger.status === 0 && ledger.stdout.trim().length > 0) {
        try {
          const state = JSON.parse(ledger.stdout) as { task?: unknown; summary?: string[] };
          if (state.task && Array.isArray(state.summary) && state.summary.length > 0) lines.push(...state.summary);
        } catch {
          await log("warn", "Ledger state is invalid JSON, enforcement injected without the task summary");
        }
      }
      lines.push("The gate blocks edit/write/patch/apply_patch/bash/shell until the required skills are loaded via skill({id:\"...\"}).");
      lines.push("The gate is content-aware: novahiz-humanizer, ui-slop-remover and ui-craft-rules are required only on frontend design tasks (R13), and impeccable on the same design selectors (R14).");
      lines.push("Config edited = opencode restart required (config read at import).");
      lines.push("Memory lives in project-memory/ under the project root (cwd): index.json + fixed-size slots (8000 chars / 200 lines) with compact → archive → new-slot rotation. Use the MCP memory_* tools: memory_search to find relevant slots first, then memory_get to read, memory_write to append, memory_update to correct, memory_archive to retire.");
      // S-AUTO (R1-R3): a chaque prompt, injection du chunk de resumes
      // (fenetre anti-repetition persistante — le bloc est reconstruit a
      // chaque prompt, donc le chunk entier est re-emis: un resume deja
      // vu ne repart pas de zero, il reste dans le contexte) puis des
      // directives posees (T3/T4) qui survivent au rebuild. buildAutoRead
      // est sans effet si memory auto est coupee.
      if (MEMORY_AUTO) {
        const auto = await buildAutoRead(sessionID, text);
        // Ligne de synthese inconditionnelle: elle prouve en E2E que le
        // chemin lecture a tourne, y compris quand il ressort vide.
        await log("info", `memory auto-read prompt: ${auto.lines.length} line(s), ${auto.newCount} new`);
        lines.push(...auto.lines);
        // V-AUTO: bloc vault second-memory — meme contrat que les resumes :
        // reconstruit a chaque prompt, fenetre persistante entre deux
        // consultations, log inconditionnel pour prouver la consultation.
        const vault = await buildVaultRead(sessionID, text);
        await log("info", `vault auto-consult prompt: ${vault.lines.length} line(s), ${vault.newCount} new`);
        lines.push(...vault.lines);
        summaryChunkBySession.set(sessionID, [...auto.lines, ...vault.lines]);
        const directives = directivesBySession.get(sessionID) ?? [];
        lines.push(...directives);
      }
      enforcementBySession.set(sessionID, lines.join("\n"));
    } catch (error) {
      classifyFailedBySession.set(sessionID, "prompt hook error");
      await log("warn", `prompt hook failed, gate tool calls refused for this session: ${String(error).slice(0, 200)}`);
      return;
    }
  });

  // V1 `experimental.chat.system.transform` → model-context hook.
  await ctx.session.hook("context", async (event) => {
    if (DISABLED) return;
    try {
      const block = enforcementBySession.get(event.sessionID);
      if (!block) return;
      // The system array can still hold the block from a previous request:
      // pushing again duplicated "[Novahiz enforcement]" once per request.
      // Drop every stale copy, then inject exactly one fresh block.
      for (let i = event.system.length - 1; i >= 0; i--) {
        const entry = event.system[i];
        if (entry && entry.type === "text" && typeof entry.text === "string" && entry.text.startsWith("[Novahiz enforcement]")) {
          event.system.splice(i, 1);
        }
      }
      event.system.push({ type: "text", text: block });
    } catch (error) {
      await log("warn", `system.transform hook failed: ${String(error).slice(0, 200)}`);
    }
  });

  // S-AUTO (T4 + R4): a chaque compaction, on pose la directive de synthese
  // (une fois par session, elle survit au rebuild du prompt suivant) et on
  // recharge le chunk de resumes — le chunk precedent est retire du bloc puis
  // remplace par sa version fraiche (recherche sur le dernier prompt), jamais
  // duplique.
  if (MEMORY_AUTO) {
    await ctx.session.hook("compaction", async (event) => {
      try {
        const sessionID = (event as unknown as { sessionID?: unknown }).sessionID;
        if (!isValidSessionId(sessionID)) return;
        touch(sessionID);
        if (MEMORY_AUTO.write.compaction) {
          const posted = appendDirective(
            sessionID,
            "Context compacted — synthesis directive (T4): persist to project-memory (memory_write) the facts from the compacted context that must survive (decisions, proofs, next steps), if not already written."
          );
          if (posted) void log("info", "compaction synthesis directive posted (T4)");
        }
        if (MEMORY_AUTO.read.postCompaction) {
          const query = lastPromptBySession.get(sessionID) ?? "session";
          const auto = await buildAutoRead(sessionID, query);
          if (auto.lines.length > 0) {
            const previous = new Set(summaryChunkBySession.get(sessionID) ?? []);
            const block = enforcementBySession.get(sessionID) ?? "[Novahiz enforcement]";
            const kept = block.split("\n").filter((line) => !previous.has(line));
            enforcementBySession.set(sessionID, [...kept, ...auto.lines].join("\n"));
            summaryChunkBySession.set(sessionID, auto.lines);
            void log("info", `memory auto-read re-injected post-compaction: ${auto.lines[0]}`);
          }
        }
      } catch (error) {
        await log("warn", `compaction hook failed: ${String(error).slice(0, 200)}`);
      }
    });
  }

  // V1 `tool.execute.before` → tool hook. Throwing denies the tool call.
  await ctx.tool.hook("execute.before", async (event) => {
    try {
      const tool = event.tool.toLowerCase();
      const gated = !DISABLED && GATE_TOOLS.has(tool);
      // P0-B: an invalid session ID must not bypass the gate. Gate tools and
      // skill loads are refused; tools that need no enforcement still pass.
      if (!isValidSessionId(event.sessionID)) {
        if (gated || (!DISABLED && tool === "skill")) {
          throw new Error(
            `Novahiz gate blocked ${event.tool}: invalid session ID — loaded skills cannot be tracked. Fix the session or set NOVAHIZ_GATE=off to disable.`
          );
        }
        return;
      }
      touch(event.sessionID);
      if (!loadedBySession.has(event.sessionID)) loadedBySession.set(event.sessionID, new Set());
      const loaded = loadedBySession.get(event.sessionID)!;

      if (tool === "skill") {
        // V2 regression fix: opencode's skill tool carries the identifier
        // under `id` in execute.before input. Reading only name/skill made
        // every load silently unrecorded — GATE RELOAD could never succeed.
        // name/skill stay as fallbacks for older harness argument shapes.
        const args = event.input as { id?: unknown; name?: unknown; skill?: unknown } | undefined;
        const raw = args?.id ?? args?.name ?? args?.skill;
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
          // H3 stays: failures are surfaced in the log instead of vanishing,
          // with the exit code — a bare empty reason hid real failures.
          const loadResult = await run(["session-load", "--session", event.sessionID, "--skill", name]);
          if (loadResult.status !== 0) {
            await log("warn", `session-load failed for skill ${name} (exit ${loadResult.status}), not recorded: ${(loadResult.stderr || loadResult.stdout || "").trim().slice(0, 200)}`);
          } else {
            loaded.add(name);
          }
        }
        return;
      }

      if (!gated) return;
      // P0-B: a failed classify would empty the session categories and
      // neutralize the prompt-scoped rules — refuse instead of failing open.
      const classifyFailure = classifyFailedBySession.get(event.sessionID);
      if (classifyFailure) {
        throw new Error(
          `Novahiz gate blocked ${event.tool}: prompt classification failed (${classifyFailure}). Fix the install (run "novahiz sync", check catalog/) and send a new message, or set NOVAHIZ_GATE=off to disable.`
        );
      }

      const categories = categoriesBySession.get(event.sessionID) ?? [];
      const result = await run(
        [
          "gate",
          "--tool",
          event.tool,
          "--args-stdin",
          "--categories",
          categories.join(","),
          "--loaded",
          [...loaded].join(","),
          "--session",
          event.sessionID,
          // P1-1/P1-4: frozen tool list + last prompt as tier seed — the CLI
          // must not re-read a possibly edited gate.tools from the config, and
          // the tier must see the prompt even when categories arrive empty.
          "--tools",
          [...GATE_TOOLS].join(","),
          "--prompt",
          lastPromptBySession.get(event.sessionID) ?? ""
        ],
        (() => {
          try {
            return JSON.stringify(event.input ?? {});
          } catch (error) {
            throw new Error(`Novahiz gate blocked ${event.tool}: could not serialize tool args (${String(error)}).`);
          }
        })()
      );

      // H2: fail-closed — an unavailable gate denies the tool call instead of
      // silently bypassing enforcement. NOVAHIZ_GATE=off remains the escape hatch.
      if (result.spawnError) {
        await log("warn", `Gate unavailable, denying the tool call: ${result.spawnError}`);
        throw new Error(
          `Novahiz gate blocked ${event.tool}: gate unavailable (${result.spawnError}). Fix the install (run sync, check catalog/) or set NOVAHIZ_GATE=off to disable.`
        );
      }
      if (result.status === 2) {
        // Gate reload: a structured denial becomes an executable directive
        // (load the named skills, retry the same call, resume the task).
        // Counting identical denials turns a failed reload into a diagnosis
        // instead of an infinite retry loop. The denial itself still stands
        // until the gate CLI sees the skills — nothing is granted here.
        const failure = parseGateFailure(result.stdout);
        if (failure) {
          const key = `${event.sessionID}|${failure.tool}|${[...failure.missingSkills].sort().join(",")}`;
          const attempt = (repairAttemptsBySession.get(key) ?? 0) + 1;
          repairAttemptsBySession.set(key, attempt);
          throw new Error(buildRepairDirective(failure, attempt));
        }
        throw new Error(`Novahiz gate blocked ${event.tool}.\n${result.stdout}`);
      }
      if (result.status !== 0) {
        throw new Error(
          `Novahiz gate unavailable (exit ${result.status}). Fix the install (run sync, check catalog/) or set the escape variable to disable.\n${result.stderr}`
        );
      }
      // The call is allowed: the repair converged — drop this session's
      // denial counters so the next task starts a fresh cycle.
      const allowedPrefix = `${event.sessionID}|${event.tool.toLowerCase()}|`;
      for (const key of repairAttemptsBySession.keys()) {
        if (key.startsWith(allowedPrefix)) repairAttemptsBySession.delete(key);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Novahiz gate")) throw error;
      // H2: fail-closed — unknown gate errors deny, they never bypass.
      await log("warn", `Gate error, denying the tool call as precaution: ${String(error)}`);
      throw new Error(`Novahiz gate blocked ${event.tool}: internal gate error. Set NOVAHIZ_GATE=off to disable.`);
    }
  });

  // V1 `tool.execute.after` → tool hook. Session state only, never fails.
  await ctx.tool.hook("execute.after", async (event) => {
    // Fail-open: mark major paths only; never break the tool result.
    try {
      const tool = event.tool.toLowerCase();

      // S-AUTO (T1/T2/T5 + T3): ecriture deterministe des faits observes,
      // uniquement sur un appel reussi et si memory auto est activee. Les
      // echecs sont logues, jamais remontes: le resultat d'outil reste intact.
      if (MEMORY_AUTO && event.status === "completed") {
        const trigger = autoWriteTrigger(tool, event.input);
        if (trigger === "todoDone" || trigger === "review") {
          const wantsWrite = trigger === "todoDone" ? MEMORY_AUTO.write.todoDone : MEMORY_AUTO.write.review;
          const payload = parseToolPayload(event.result);
          if (payload) {
            if (wantsWrite) await autoWriteFact(trigger, payload, event.sessionID);
            // T3: un todo done peut terminer la tache → directive de synthese.
            if (trigger === "todoDone" && MEMORY_AUTO.write.taskEnd && typeof payload.task_id === "string") {
              await checkTaskEnd(payload.task_id, event.sessionID);
            }
          }
        } else if (trigger === "spec" && MEMORY_AUTO.write.spec) {
          const args = (event.input ?? {}) as Record<string, unknown>;
          const raw =
            (typeof args.filePath === "string" && args.filePath) ||
            (typeof args.file_path === "string" && args.file_path) ||
            (typeof args.path === "string" && args.path) ||
            "";
          await autoWriteFact("spec", { path: raw, tool: event.tool }, event.sessionID);
        }
      }

      if (!["edit", "write", "patch", "apply_patch"].includes(tool)) return;
      const args = (event.input ?? {}) as Record<string, unknown>;
      const raw =
        (typeof args.filePath === "string" && args.filePath) ||
        (typeof args.file_path === "string" && args.file_path) ||
        (typeof args.path === "string" && args.path) ||
        "";
      if (!raw) return;
      const cwd = process.cwd();
      const abs = resolve(cwd, raw);
      const rel = relative(cwd, abs).replace(/\\/g, "/");
      // Audit 2026-09-25 (traversal): relative() across drives returns an
      // absolute path ("D:/..."), which slipped past the ".." prefix test —
      // reject anything outside cwd, absolute or not.
      if (!rel || rel.startsWith("..") || isAbsolute(rel)) return;
      if (!isMajorPath(rel)) return;
      markDirty(cwd, rel);
    } catch {
      // fail-open
    }
  });

  return () => events.abort();
}

const novahizPlugin: Plugin = { id: "novahiz-workflow", setup };
export default novahizPlugin;
