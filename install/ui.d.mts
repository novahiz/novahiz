// Declarations pour install/ui.mjs (module JS pur, consomme aussi par les
// tests TypeScript). Garde le contrat en phase avec ui.mjs — toute change de
// signature se reflete ici (typecheck = preuve que les deux coincident).
export declare const BANNER: string[];
export declare const BANNER_COLORS: string[];

export interface InstallerUIOptions {
  steps?: string[];
  dryRun?: boolean;
  write?: (text: string) => void;
  columns?: number;
  env?: NodeJS.ProcessEnv;
  mode?: "anim" | "plain";
  version?: string;
}

export type StepStatus = "done" | "skip" | "warn" | "fail";

export interface InstallerUI {
  banner(): void;
  step(label: string): void;
  note(message: string): void;
  raw(text: string): void;
  suspend(): void;
  resume(): void;
  finish(summaryLines?: string[]): void;
  finishStep(status?: StepStatus, detail?: string): void;
  resolveMode(): "anim" | "plain";
  colors(): boolean;
}

export declare function packageVersion(): string;
export declare function renderBar(ratio: number, width: number): string;
export declare function resolveMode(env?: NodeJS.ProcessEnv, isTTY?: boolean): "anim" | "plain";
export declare function createInstallerUI(opts?: InstallerUIOptions): InstallerUI;
