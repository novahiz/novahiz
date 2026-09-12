import type { Provider, Spec } from "./spec.ts";

type McpEntry = {
  type: "local" | "remote";
  command?: string[];
  url?: string;
  enabled: boolean;
};

export function enabledProviders(spec: Spec): Provider[] {
  const disabled = new Set(spec.config.providers.disabled);
  return spec.providers.filter((provider) => !disabled.has(provider.id));
}

export function providersForCategories(spec: Spec, categories: string[]): Provider[] {
  return enabledProviders(spec).filter((provider) =>
    (provider.categories ?? []).some((category) => categories.includes(category))
  );
}

export function buildMcpEntries(spec: Spec): Record<string, McpEntry> {
  const entries: Record<string, McpEntry> = {};
  if (!spec.config.providers.autoRegister) return entries;
  for (const provider of enabledProviders(spec)) {
    if (provider.kind !== "mcp") continue;
    if (provider.transport === "remote") {
      if (!provider.url) continue;
      entries[provider.id] = { type: "remote", url: provider.url, enabled: true };
    } else {
      entries[provider.id] = { type: "local", command: provider.command ?? [provider.id], enabled: true };
    }
  }
  return entries;
}

type InstallCommand = {
  id: string;
  kind: string;
  command: string[];
  source: string;
};

export function installCommands(spec: Spec): InstallCommand[] {
  return enabledProviders(spec)
    .filter((provider) => Array.isArray(provider.install) && provider.install.length > 0)
    .map((provider) => ({
      id: provider.id,
      kind: provider.kind,
      command: provider.install as string[],
      source: provider.source ?? ""
    }));
}
