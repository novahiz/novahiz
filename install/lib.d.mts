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
export declare function defaultConfig(): NovahizConfig;
export declare function loadManifest(home: string): NovahizManifest;
export declare function unsafeHostToken(tokens: string[]): string | null;
export declare function spawnHost(cmd: string, args: string[], opts?: SpawnSyncOptions): SpawnSyncReturns<string>;
export declare function saveManifest(home: string, manifest: NovahizManifest): void;
export declare function mergeCreated(previous?: string[], next?: string[]): string[];
export declare function mergeBackups(previous?: BackupEntry[], next?: BackupEntry[]): BackupEntry[];
export declare function pruneEmptyDirs(paths: string[], stops?: string[]): void;
export declare function detectedHarnesses(dirs: Record<string, string>, whichFn?: (cmd: string) => boolean): string[];
export declare function which(cmd: string): boolean;
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
