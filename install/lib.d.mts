// Declarations pour install/lib.mjs (module JS pur, consomme aussi par les
// tests TypeScript). Garde le contrat en phase avec lib.mjs — toute change de
// signature se reflete ici (typecheck = preuve que les deux coincident).
import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";

export interface BackupEntry {
  path: string;
  backup: string;
}

export interface CopyFileResult {
  created: string | null;
  backup: BackupEntry | null;
}

export interface CopyIntoResult {
  created: string[];
  backups: BackupEntry[];
  total: number;
}

export interface NovahizManifest {
  version?: string;
  installedAt?: string;
  harness?: string;
  harnesses?: string[];
  configDir?: string;
  home?: string;
  coreCopied?: boolean;
  configCreated?: boolean;
  created?: string[];
  backups?: BackupEntry[];
  /** Horodatage du dernier nettoyage (install.mjs --clean). */
  cleanedAt?: string;
  /**
   * Vrai quand seul le core a tourne : les extras (providers, MCP globaux,
   * vault Obsidian, rafraichissement npm) sont rejoues au premier lancement
   * du CLI, puis le drapeau retombe a false.
   */
  extrasPending?: boolean;
}

export interface NovahizConfig {
  dbPath: string;
  skillRoots: string[];
  gate: { enabled: boolean; mode: string; envEscape: string; tools: string[] };
  classify: { minScore: number; maxCategories: number; fallbackCategory: string };
  providers: { autoRegister: boolean; autoInstall: boolean; disabled: string[] };
}

export interface DeferredWaitOptions {
  /** Cadence de sonde entre deux verifications de vie (defaut 2000 ms). */
  pollMs?: number;
  /** Plafond inclusif par pid (defaut 10 min) : la fonction rend toujours la main. */
  timeoutMs?: number;
  /** Patience fixe quand npm n'a pas pu etre identifie (defaut 30000 ms). */
  graceMs?: number;
  /** Sonde de vie injectable pour les tests (defaut pidAlive). */
  isAlive?: (pid: number) => boolean;
  log?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export declare function parseArgs(argv: string[]): Record<string, string | boolean>;
export declare function expandHome(value: string): string;
export declare function repoRoot(metaUrl: string): string;
export declare function opencodeConfigDir(env?: NodeJS.ProcessEnv): string;
export declare function NovahizHome(flags?: Record<string, unknown>, env?: NodeJS.ProcessEnv): string;
export declare function listFiles(root: string): string[];
export declare function skillNamesIn(roots: string[]): Set<string>;
export declare function copyFileWithBackup(srcPath: string, destPath: string, useBackup?: boolean): CopyFileResult;
export declare function copyInto(srcDir: string, destDir: string, useBackup?: boolean): CopyIntoResult;
export declare function readJson(path: string): unknown;
export declare function readJson<T>(path: string, fallback: T): T;
export declare function writeJson(path: string, value: unknown): void;
export declare function playwrightBrowserFlag(platform?: string): string;
export declare function playwrightProfileDir(env?: Record<string, string | undefined>): string;
export declare function playwrightProfileFlag(env?: Record<string, string | undefined>): string;
export declare function reconcilePlaywrightCommand(
  configPath: string,
  platform?: string,
  env?: Record<string, string | undefined>,
): { state: "absent" | "illisible" | "inchange" | "corrige"; changes?: string[] };
export declare function defaultConfig(): NovahizConfig;
export declare function loadManifest(home: string): NovahizManifest;
export declare function unsafeHostToken(tokens: string[]): string | null;
export declare function spawnHost(cmd: string, args: string[], opts?: SpawnSyncOptions): SpawnSyncReturns<string>;
export declare function saveManifest(home: string, manifest: NovahizManifest): void;
export declare function mergeCreated(previous?: string[], next?: string[]): string[];
export declare function mergeBackups(previous?: BackupEntry[], next?: BackupEntry[]): BackupEntry[];
export declare function pruneEmptyDirs(paths: string[], stops?: string[]): void;

// --- Nettoyage de l'installation precedente -------------------------------
export interface OwnedRoot {
  /** Racine de destination : la ou novahiz pose ses fichiers. */
  dest: string;
  /** Racine source equivalente, dans le package. */
  src: string;
}

export interface CleanupResult {
  /** Valeur attendue par ui.finishStep : "done" ou "skip". */
  status: "done" | "skip";
  /** Phrase expliquant l'issue, affichee telle quelle par l'installateur. */
  detail: string;
  /** Chemins reels supprimes ; toujours vide en mode a blanc. */
  removed: string[];
  /** Present uniquement en mode a blanc : ce qui partirait. */
  stale?: string[];
  /** Fichiers retires mais retouches depuis : jamais supprimes, seulement dits. */
  kept: string[];
}

export declare function withinDir(value: string, dir: string): boolean;
export declare function staleOwnedPaths(
  created: string[] | undefined,
  roots: OwnedRoot[],
  exists?: (path: string) => boolean,
): string[];

// --- Fichiers retires du paquet -------------------------------------------
export interface RetiredFile {
  /** Chemin relatif au home, tel que l'ancienne version l'installait. */
  path: string;
  /** Version qui a cesse de le livrer. */
  version: string;
  /** sha256 du contenu publie, fins de ligne normalisees en LF. */
  sha256: string;
}

export interface RetiredInventory {
  files: RetiredFile[];
}

/** Empreinte d'un contenu, `\r\n` ramene a `\n` avant hachage. */
export declare function normalisedSha256(content: string | Buffer | Uint8Array): string;
export declare function retiredOwnedPaths(
  retired: RetiredInventory | null | undefined,
  home: string,
  readFile?: (path: string) => Buffer,
  exists?: (path: string) => boolean,
): { removed: string[]; kept: string[] };
export declare function cleanupPreviousInstall(options: {
  home: string;
  configDir: string;
  roots: OwnedRoot[];
  clean: boolean;
  dryRun?: boolean;
  stepFailure?: string | null;
  retired?: RetiredInventory | null;
}): CleanupResult;
export declare function detectedHarnesses(dirs: Record<string, string>, whichFn?: (cmd: string) => boolean): string[];
/**
 * Scan de PATH, sans `which`/`where` externe (absents de Debian minimal et
 * Alpine). `PATHEXT` est respecte sous Windows.
 */
export declare function which(cmd: string, env?: NodeJS.ProcessEnv, platform?: string): boolean;
/**
 * Shell declare dans opencode : `$SHELL` sur macOS/Linux (zsh par defaut sur
 * macOS), pwsh si present sous Windows, sinon powershell.exe.
 */
export declare function shellSetting(
  env?: NodeJS.ProcessEnv,
  platform?: string,
  whichFn?: (cmd: string, env?: NodeJS.ProcessEnv) => boolean,
): string;
/**
 * `--core` (local, sans reseau ni sudo), `--extras` (reseau/systeme), ou les
 * deux sans drapeau (comportement historique de `novahiz-install`).
 */
export declare function installMode(flags?: Record<string, unknown>): {
  core: boolean;
  extras: boolean;
  mode: "all" | "core" | "extras";
};
export declare function nodeVersionOk(minimum?: [number, number, number]): boolean;

// --- Phase opencode differee (postinstall npm) ------------------------------
export declare function deferOpencodePhase(flags?: Record<string, unknown>, env?: NodeJS.ProcessEnv): boolean;
export declare function parsePid(value: unknown): number | null;
export declare function pidAlive(pid: number): boolean;
export declare function findNpmAncestorPid(startPid?: number): number | null;
export declare function waitForPids(
  pids: ReadonlyArray<number | null | undefined>,
  opts?: DeferredWaitOptions,
): Promise<void>;
export declare function waitForDeferredPhase(env?: NodeJS.ProcessEnv, opts?: DeferredWaitOptions): Promise<void>;
