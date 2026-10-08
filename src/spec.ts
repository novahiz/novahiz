import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

type Keyword = { term: string; weight?: number };
export type CategoryKeyword = string | Keyword;

type RoadmapStepKind = "advisory" | "skill" | "edit" | "verify" | "approval";

export type RoadmapStep = {
  id: string;
  label: string;
  kind: RoadmapStepKind;
  requireSkills?: string[];
  optional?: boolean;
};

export type Roadmap = {
  id: string;
  steps: RoadmapStep[];
};

export type Category = {
  id: string;
  label: string;
  priority: number;
  keywords: CategoryKeyword[];
  negativeKeywords?: CategoryKeyword[];
  defaultSkills: string[];
  roadmap?: Roadmap;
};

type RuleWhen = {
  match?: "any" | "all";
  fileClasses?: string[];
  pathGlobs?: string[];
  /** Project-scoped selector: the rule applies only when at least one file under
   * the project root (nearest ancestor of the edited file holding .git,
   * package.json or pubspec.yaml) matches one of these globs, written from that
   * root — e.g. "stitch/**". Expresses "only in projects that carry X", which no
   * per-file selector can. */
  projectGlobs?: string[];
  promptCategories?: string[];
  contentMatches?: string[];
  contentExcludes?: string[];
  minChange?: number;
};

export type Rule = {
  id: string;
  description: string;
  when: RuleWhen;
  require: string[];
};

type SkillOverride = {
  power?: number;
  stars?: number | null;
  tags?: string[];
  categories?: string[];
};

type Overrides = {
  skills?: Record<string, SkillOverride>;
};

type ProviderKind = "mcp" | "skill" | "commands";

export type Provider = {
  id: string;
  label: string;
  kind: ProviderKind;
  transport?: "local" | "remote";
  command?: string[];
  url?: string;
  install?: string[];
  requires?: string[];
  bootstrap?: Record<string, string[]>;
  purpose?: string;
  categories?: string[];
  source?: string;
  license?: string;
};

type ProvidersConfig = {
  autoRegister: boolean;
  autoInstall: boolean;
  disabled: string[];
};

type TraceConfig = {
  enabled: boolean;
  categories: string[];
};

export type GateConfig = {
  enabled: boolean;
  mode: "block" | "warn" | "audit";
  envEscape: string;
  tools: string[];
  ignoreFiles: string[];
  placeholders: boolean;
  trace: TraceConfig;
};

type ClassifyConfig = {
  minScore: number;
  maxCategories: number;
  fallbackCategory: string;
};

type LedgerReviewConfig = {
  edits: number;
  todos: number;
};

type LedgerConfig = {
  enabled: boolean;
  review: LedgerReviewConfig;
};

// S-AUTO: capture et consultation automatiques de la memoire.
// write = les 5 triggers d'ecriture automatique (T1-T5), tous actifs par
// defaut ("full-on"): T1 todo done, T2 review, T3 fin de tache (directive de
// synthese), T4 compaction (directive de synthese), T5 spec/config change.
// read = injection de resumes sur le prompt (k resultats au-dessus de
// minScore), anti-repetition par session, re-injection post-compaction (R4).
export type MemoryAutoWriteConfig = {
  todoDone: boolean;
  review: boolean;
  taskEnd: boolean;
  compaction: boolean;
  spec: boolean;
};

export type MemoryAutoReadConfig = {
  k: number;
  minScore: number;
  antiRepetition: boolean;
  postCompaction: boolean;
  // P3: plafond d'injection par session en tokens (~4 chars/token), heritage
  // sessions precedentes + resumes de pertinence compris. Defaut 1500 tokens.
  budgetTokens: number;
};

// V-AUTO: consultation automatique du vault second-memory (vault Obsidian
// officiel du systeme, cree a l'installation). every = cadence en
// occurrences de prompt (1 = a chaque prompt, defaut 3 = "de temps en
// temps"), budgetTokens = plafond d'injection du bloc vault (~4 chars/token).
export type MemoryAutoVaultConfig = {
  enabled: boolean;
  k: number;
  minScore: number;
  every: number;
  budgetTokens: number;
};

export type MemoryAutoConfig = {
  enabled: boolean;
  write: MemoryAutoWriteConfig;
  read: MemoryAutoReadConfig;
  vault: MemoryAutoVaultConfig;
};

export type MemoryConfig = {
  auto: MemoryAutoConfig;
};

export type NovahizConfig = {
  dbPath: string;
  skillRoots: string[];
  gate: GateConfig;
  classify: ClassifyConfig;
  providers: ProvidersConfig;
  ledger: LedgerConfig;
  memory: MemoryConfig;
};

export type Spec = {
  root: string;
  config: NovahizConfig;
  categories: Category[];
  rules: Rule[];
  overrides: Overrides;
  providers: Provider[];
};

const DEFAULT_IGNORE_FILES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/vendor/**",
  "**/*.min.*",
  "**/*.map",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/bun.lockb",
  "**/__snapshots__/**",
  "**/*.snap",
  "**/*.generated.*"
];

export const DEFAULT_CONFIG: NovahizConfig = {
  dbPath: "novahiz.sqlite",
  // Documented default (docs/CONFIGURATION.md). An empty array would index
  // nothing when a config omits the key; relative paths resolve against the
  // Novahiz home.
  // Mirrors novahiz.config.example.json (and install/lib.mjs defaultConfig):
  // bundled skills, the harness skills dir and the external packs (~/.agents/
  // skills) must all be indexed, or gate-required pack skills are invisible
  // whenever a config is missing a skillRoots key.
  skillRoots: ["./skills", "~/.config/opencode/skills", "~/.agents/skills"],
  gate: {
    enabled: true,
    mode: "block",
    envEscape: "NOVAHIZ_GATE", // canonical kill-switch name; gate command ignores this field
    // Audit 2026-09-25 (P1): snap_restore rolls back files, clepsydre_enable_task
    // re-arms a disabled task — both carry, create or execute state too.
    tools: ["edit", "write", "patch", "apply_patch", "bash", "shell", "snap_restore", "clepsydre_add_task", "clepsydre_add_shell_task", "clepsydre_add_http_task", "clepsydre_add_prompt_task", "clepsydre_update_task", "clepsydre_remove_task", "clepsydre_run_task_now", "clepsydre_enable_task"],
    ignoreFiles: DEFAULT_IGNORE_FILES,
    placeholders: true,
    trace: {
      enabled: false,
      categories: ["code", "debug", "audit", "review", "database-supabase"]
    }
  },
  classify: {
    minScore: 1,
    maxCategories: 3,
    fallbackCategory: "general"
  },
  providers: {
    autoRegister: true,
    autoInstall: true,
    disabled: []
  },
  ledger: {
    enabled: true,
    review: {
      edits: 3,
      todos: 2
    }
  },
  // S-AUTO: memoire automatique full-on — les 5 triggers T1-T5 actives, la
  // lecture injecte k=3 resumes au score >= 0.25 avec anti-repetition et
  // re-injection post-compaction. Le kill-switch d'environnement
  // NOVAHIZ_MEM_AUTO (vocabulaire off/0/false/no/disabled) est lu par le
  // consommateur (plugin opencode), pas par cette config, au motif de
  // gate.envEscape: une config ecrivable ne redirige jamais le kill-switch.
  memory: {
    auto: {
      enabled: true,
      write: {
        todoDone: true,
        review: true,
        taskEnd: true,
        compaction: true,
        spec: true
      },
      read: {
        k: 3,
        minScore: 0.25,
        antiRepetition: true,
        postCompaction: true,
        budgetTokens: 1500
      },
      vault: {
        enabled: true,
        k: 3,
        minScore: 0.25,
        every: 3,
        budgetTokens: 600
      }
    }
  }
};

export function NovahizHome(): string {
  // M7: resolve ~/ and relative segments — the installer variant already did,
  // the TS variant returned the raw string (broken on NOVAHIZ_HOME=~/x).
  // Default stays .config/novahiz: the canonical home directory.
  const fromEnv = process.env.NOVAHIZ_HOME || process.env.NOVAHIZ_HOME;
  if (fromEnv && fromEnv.length > 0) return resolve(expandHome(fromEnv));
  return join(homedir(), ".config", "novahiz");
}

export function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  // H15: reject path traversal — check if any path segment is exactly ".."
  if (hasTraversalSegment(value)) return value;
  // M19: ~username is a shell convention not natively supported by Node.js.
  return value;
}

/** Returns true if the path contains a segment that is exactly ".." */
function hasTraversalSegment(p: string): boolean {
  return p.split(/[/\\]/).some((segment) => segment === "..");
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function readJson<T>(path: string): T {
  return JSON.parse(stripBom(readFileSync(path, "utf8"))) as T;
}

export function mergeConfig(raw: Partial<NovahizConfig> | null | undefined): NovahizConfig {
  const source = raw && typeof raw === "object" ? raw : {};
  const gateSource: Partial<GateConfig> = source.gate && typeof source.gate === "object" ? source.gate : {};
  const gate: GateConfig = { ...DEFAULT_CONFIG.gate, ...gateSource };
  if (typeof gate.enabled !== "boolean") gate.enabled = DEFAULT_CONFIG.gate.enabled;
  if (gate.mode !== "block" && gate.mode !== "warn" && gate.mode !== "audit") gate.mode = DEFAULT_CONFIG.gate.mode;
  if (typeof gate.envEscape !== "string") gate.envEscape = DEFAULT_CONFIG.gate.envEscape;
  // C2: an empty tools array would silently un-gate every tool — fall back
  // to the default set so a partial/corrupt config cannot disable the gate.
  if (!Array.isArray(gate.tools) || gate.tools.length === 0) gate.tools = DEFAULT_CONFIG.gate.tools;
  if (!Array.isArray(gate.ignoreFiles)) gate.ignoreFiles = DEFAULT_CONFIG.gate.ignoreFiles;
  if (typeof gate.placeholders !== "boolean") gate.placeholders = DEFAULT_CONFIG.gate.placeholders;

  const traceSource: Partial<TraceConfig> = gateSource.trace && typeof gateSource.trace === "object" ? gateSource.trace : {};
  const trace: TraceConfig = { ...DEFAULT_CONFIG.gate.trace, ...traceSource };
  if (typeof trace.enabled !== "boolean") trace.enabled = DEFAULT_CONFIG.gate.trace.enabled;
  if (!Array.isArray(trace.categories)) trace.categories = [...DEFAULT_CONFIG.gate.trace.categories];
  gate.trace = trace;

  const classifySource: Partial<ClassifyConfig> = source.classify && typeof source.classify === "object" ? source.classify : {};
  const classify: ClassifyConfig = { ...DEFAULT_CONFIG.classify, ...classifySource };
  if (typeof classify.minScore !== "number" || !Number.isFinite(classify.minScore)) {
    classify.minScore = DEFAULT_CONFIG.classify.minScore;
  }
  if (typeof classify.maxCategories !== "number" || !Number.isFinite(classify.maxCategories)) {
    classify.maxCategories = DEFAULT_CONFIG.classify.maxCategories;
  }
  if (typeof classify.fallbackCategory !== "string") {
    classify.fallbackCategory = DEFAULT_CONFIG.classify.fallbackCategory;
  }

  const providersSource: Partial<ProvidersConfig> = source.providers && typeof source.providers === "object" ? source.providers : {};
  const providers: ProvidersConfig = {
    autoRegister: typeof providersSource.autoRegister === "boolean" ? providersSource.autoRegister : DEFAULT_CONFIG.providers.autoRegister,
    autoInstall: typeof providersSource.autoInstall === "boolean" ? providersSource.autoInstall : DEFAULT_CONFIG.providers.autoInstall,
    disabled: Array.isArray(providersSource.disabled) ? providersSource.disabled : [...DEFAULT_CONFIG.providers.disabled]
  };

  const ledgerSource: Partial<LedgerConfig> = source.ledger && typeof source.ledger === "object" ? source.ledger : {};
  const reviewSource: Partial<LedgerReviewConfig> = ledgerSource.review && typeof ledgerSource.review === "object" ? ledgerSource.review : {};
  const review: LedgerReviewConfig = {
    edits: typeof reviewSource.edits === "number" && Number.isFinite(reviewSource.edits) && reviewSource.edits > 0 ? Math.trunc(reviewSource.edits) : DEFAULT_CONFIG.ledger.review.edits,
    todos: typeof reviewSource.todos === "number" && Number.isFinite(reviewSource.todos) && reviewSource.todos > 0 ? Math.trunc(reviewSource.todos) : DEFAULT_CONFIG.ledger.review.todos
  };
  const ledger: LedgerConfig = {
    enabled: typeof ledgerSource.enabled === "boolean" ? ledgerSource.enabled : DEFAULT_CONFIG.ledger.enabled,
    review
  };

  // S-AUTO: un bloc memory.auto absent ou invalide retombe sur les defauts
  // full-on — une config corrompue ne desactive jamais l'auto par accident
  // (meme regle que gate.tools). k entier dans [1,20], minScore dans [0,1].
  const memorySource: Partial<MemoryConfig> = source.memory && typeof source.memory === "object" ? source.memory : {};
  const autoSource: Partial<MemoryAutoConfig> = memorySource.auto && typeof memorySource.auto === "object" ? memorySource.auto : {};
  const writeSource: Partial<MemoryAutoWriteConfig> = autoSource.write && typeof autoSource.write === "object" ? autoSource.write : {};
  const readSource: Partial<MemoryAutoReadConfig> = autoSource.read && typeof autoSource.read === "object" ? autoSource.read : {};
  const autoWrite: MemoryAutoWriteConfig = {
    todoDone: typeof writeSource.todoDone === "boolean" ? writeSource.todoDone : DEFAULT_CONFIG.memory.auto.write.todoDone,
    review: typeof writeSource.review === "boolean" ? writeSource.review : DEFAULT_CONFIG.memory.auto.write.review,
    taskEnd: typeof writeSource.taskEnd === "boolean" ? writeSource.taskEnd : DEFAULT_CONFIG.memory.auto.write.taskEnd,
    compaction: typeof writeSource.compaction === "boolean" ? writeSource.compaction : DEFAULT_CONFIG.memory.auto.write.compaction,
    spec: typeof writeSource.spec === "boolean" ? writeSource.spec : DEFAULT_CONFIG.memory.auto.write.spec
  };
  const autoRead: MemoryAutoReadConfig = {
    k:
      typeof readSource.k === "number" && Number.isFinite(readSource.k) && readSource.k >= 1 && readSource.k <= 20
        ? Math.trunc(readSource.k)
        : DEFAULT_CONFIG.memory.auto.read.k,
    minScore:
      typeof readSource.minScore === "number" && Number.isFinite(readSource.minScore) && readSource.minScore >= 0 && readSource.minScore <= 1
        ? readSource.minScore
        : DEFAULT_CONFIG.memory.auto.read.minScore,
    antiRepetition: typeof readSource.antiRepetition === "boolean" ? readSource.antiRepetition : DEFAULT_CONFIG.memory.auto.read.antiRepetition,
    postCompaction: typeof readSource.postCompaction === "boolean" ? readSource.postCompaction : DEFAULT_CONFIG.memory.auto.read.postCompaction,
    budgetTokens:
      typeof readSource.budgetTokens === "number" && Number.isFinite(readSource.budgetTokens) && readSource.budgetTokens >= 100 && readSource.budgetTokens <= 4000
        ? Math.trunc(readSource.budgetTokens)
        : DEFAULT_CONFIG.memory.auto.read.budgetTokens
  };
  // V-AUTO: vault second-memory — bornes [1,10] pour k, [0,1] minScore,
  // [1,100] cadence every, [100,2000] budgetTokens; toute valeur hors bornes
  // retombe sur le defaut (meme regle que read).
  const vaultSource: Partial<MemoryAutoVaultConfig> = autoSource.vault && typeof autoSource.vault === "object" ? autoSource.vault : {};
  const autoVault: MemoryAutoVaultConfig = {
    enabled: typeof vaultSource.enabled === "boolean" ? vaultSource.enabled : DEFAULT_CONFIG.memory.auto.vault.enabled,
    k:
      typeof vaultSource.k === "number" && Number.isFinite(vaultSource.k) && vaultSource.k >= 1 && vaultSource.k <= 10
        ? Math.trunc(vaultSource.k)
        : DEFAULT_CONFIG.memory.auto.vault.k,
    minScore:
      typeof vaultSource.minScore === "number" && Number.isFinite(vaultSource.minScore) && vaultSource.minScore >= 0 && vaultSource.minScore <= 1
        ? vaultSource.minScore
        : DEFAULT_CONFIG.memory.auto.vault.minScore,
    every:
      typeof vaultSource.every === "number" && Number.isFinite(vaultSource.every) && vaultSource.every >= 1 && vaultSource.every <= 100
        ? Math.trunc(vaultSource.every)
        : DEFAULT_CONFIG.memory.auto.vault.every,
    budgetTokens:
      typeof vaultSource.budgetTokens === "number" && Number.isFinite(vaultSource.budgetTokens) && vaultSource.budgetTokens >= 100 && vaultSource.budgetTokens <= 2000
        ? Math.trunc(vaultSource.budgetTokens)
        : DEFAULT_CONFIG.memory.auto.vault.budgetTokens
  };
  const memory: MemoryConfig = {
    auto: {
      enabled: typeof autoSource.enabled === "boolean" ? autoSource.enabled : DEFAULT_CONFIG.memory.auto.enabled,
      write: autoWrite,
      read: autoRead,
      vault: autoVault
    }
  };

  return {
    dbPath: typeof source.dbPath === "string" ? source.dbPath : DEFAULT_CONFIG.dbPath,
    skillRoots: Array.isArray(source.skillRoots) ? source.skillRoots : [...DEFAULT_CONFIG.skillRoots],
    gate,
    classify,
    providers,
    ledger,
    memory
  };
}

function loadConfig(root: string = NovahizHome()): NovahizConfig {
  const config = readUserConfig(root);
  const dbOverride = process.env.NOVAHIZ_DB;
  if (dbOverride && dbOverride.length > 0) {
    // P2-C (LOW): an absolute override used to create a database anywhere on
    // disk (mkdirSync recursive in openDb). Allow home, the system temp dir
    // (tests/CI), or the cwd; refuse everything else loudly.
    const resolved = resolve(dbOverride);
    const allowed = [homedir(), tmpdir(), process.cwd()].some((base) => {
      const prefix = resolve(base);
      return resolved === prefix || resolved.startsWith(prefix + sep);
    });
    if (!allowed) throw new Error(`NOVAHIZ_DB points outside home/temp/cwd: ${resolved}`);
    config.dbPath = resolved;
  }
  return config;
}

function readUserConfig(root: string): NovahizConfig {
  const userPath = join(root, "novahiz.config.json");
  if (existsSync(userPath)) {
    try {
      return mergeConfig(JSON.parse(stripBom(readFileSync(userPath, "utf8"))) as Partial<NovahizConfig>);
    } catch (error) {
      throw new Error(`Invalid JSON in ${userPath}: ${(error as Error).message}`);
    }
  }
  const examplePath = join(root, "novahiz.config.example.json");
  if (existsSync(examplePath)) return mergeConfig(readJson<Partial<NovahizConfig>>(examplePath));
  return mergeConfig(null);
}

function readCatalog<T>(path: string): T {
  try {
    return JSON.parse(stripBom(readFileSync(path, "utf8"))) as T;
  } catch (error) {
    throw new Error(`Invalid or missing catalog file ${path}: ${(error as Error).message}`);
  }
}

// Community path: `npm install -g novahiz` leaves the home untouched (npm 11+
// gates lifecycle scripts, and the postinstall only previews anyway), so a
// brand-new machine has no catalog in its home yet — every command used to die
// with ENOENT right after the documented install. The package ships its own
// catalog/: fall back to it before failing.
// Audit 2026-10-08: the old one-level assumption (dirname(argv[1])/..) held for
// bin/ and src/ but NOT for mcp/<server>/index.mjs — two levels down it pointed
// at mcp/catalog/ (absent), so on any machine without a home catalog (CI,
// fresh npm-global) the memory MCP degraded on every call: red CI on Linux,
// memory_write/search dead for the community path. Walk up instead: the package
// root is the nearest ancestor carrying a package.json, preferring name
// "novahiz"; a stray nested manifest is kept only as a last resort.
// Exported: doctor resolves the shipped skills/ the same way.
export function packageRoot(): string | null {
  const entry = process.argv[1];
  if (!entry || entry.length === 0) return null;
  let dir = dirname(resolve(entry));
  let loose: string | null = null;
  for (let depth = 0; depth < 6; depth += 1) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        const name = (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name;
        if (name === "novahiz") return dir;
        loose ??= dir;
      } catch {
        // manifest illisible: on remonte quand meme.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return loose;
}

// The home copy always wins when present, because that is what the installer
// refreshes.
function catalogPath(root: string, name: string): string {
  const homePath = join(root, "catalog", name);
  if (existsSync(homePath)) return homePath;
  const pkgRoot = packageRoot();
  if (pkgRoot) {
    const packagePath = join(pkgRoot, "catalog", name);
    if (existsSync(packagePath)) return packagePath;
  }
  return homePath;
}

export function loadSpec(root: string = NovahizHome()): Spec {
  const categories = readCatalog<Category[]>(catalogPath(root, "categories.json"));
  const rules = readCatalog<Rule[]>(catalogPath(root, "rules.json"));
  const overrides = readCatalog<Overrides>(catalogPath(root, "overrides.json"));
  let providers: Provider[] = [];
  try {
    const loaded = readCatalog<Provider[]>(catalogPath(root, "providers.json"));
    if (Array.isArray(loaded)) providers = loaded;
  } catch {
    providers = [];
  }
  if (!Array.isArray(categories)) throw new Error("catalog/categories.json must be an array");
  if (!Array.isArray(rules)) throw new Error("catalog/rules.json must be an array");
  if (!overrides || typeof overrides !== "object") throw new Error("catalog/overrides.json must be an object");
  return { root, config: loadConfig(root), categories, rules, overrides, providers };
}
