import { spawnSync } from "node:child_process";
import type { Provider, Spec } from "./spec.ts";

export function commandExists(command: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], { encoding: "utf8", shell: false });
  return result.status === 0;
}

type DependencyStatus = {
  id: string;
  kind: string;
  requires: string[];
  missing: string[];
  ok: boolean;
};

export function checkDependencies(spec: Spec): DependencyStatus[] {
  return spec.providers.map((provider) => {
    const requires = provider.requires ?? [];
    const missing = requires.filter((command) => !commandExists(command));
    return { id: provider.id, kind: provider.kind, requires, missing, ok: missing.length === 0 };
  });
}

export function bootstrapFor(provider: Provider, platform: string = process.platform): string[] | null {
  const bootstrap = provider.bootstrap;
  if (!bootstrap) return null;
  return bootstrap[platform] ?? bootstrap.default ?? null;
}

export function missingPrerequisites(spec: Spec): { provider: Provider; missing: string[] }[] {
  return spec.providers
    .map((provider) => ({ provider, missing: (provider.requires ?? []).filter((command) => !commandExists(command)) }))
    .filter((entry) => entry.missing.length > 0);
}
