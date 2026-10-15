import { expandHome, type Provider, type Spec } from "./spec.ts";

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
      try { new URL(provider.url); } catch { continue; }
      entries[provider.id] = { type: "remote", url: provider.url, enabled: true };
    } else {
      // M20b: when a provider has no `command` field, we fall back to using the
      // provider ID as the command name. This works for providers that register
      // a globally-installed CLI tool with the same name as their ID (e.g.,
      // "npx supabase"). If the provider ID is actually a scoped
      // npm package (e.g., "@scope/pkg"), this fallback will fail silently —
      // the provider should define `command` explicitly in that case.
      // `~` in a command path is expanded here: transform callbacks hand the
      // argv to opencode verbatim, and a literal `~` would not resolve
      // (novahiz-docs lives under the user's home by convention).
      entries[provider.id] = { type: "local", command: (provider.command ?? [provider.id]).map(expandHome), enabled: true };
    }
  }
  return entries;
}

type InstallCommand = {
  id: string;
  kind: string;
  command: string[];
  source: string;
  // Providers a deduped update command actually refreshes (see updateCommands):
  // present only when one shared command collapsed several providers.
  covers?: string[];
};

function toInstallCommand(provider: Provider): InstallCommand {
  return {
    id: provider.id,
    kind: provider.kind,
    command: provider.install as string[],
    source: provider.source ?? ""
  };
}

export function installCommands(spec: Spec): InstallCommand[] {
  return enabledProviders(spec)
    .filter((provider) => Array.isArray(provider.install) && provider.install.length > 0)
    .map(toInstallCommand);
}

// Refresh path (2026-10-15): `deps --install` alone can never update a pack
// that is already installed — pendingInstallCommands drops it, which is why
// /novahiz-skills-update refreshed nothing for flutter/dart/expo. `update`
// carries the provider's official refresh command instead; unlike install it
// is never gated on installedWhen, because refreshing an up-to-date pack is
// the whole point. Providers without one fall back to their install command
// (re-running `skills add` re-syncs from upstream).
export function updateCommands(spec: Spec): InstallCommand[] {
  const byCommand = new Map<string, InstallCommand>();
  for (const provider of enabledProviders(spec)) {
    if (!Array.isArray(provider.install) || provider.install.length === 0) continue;
    const command = Array.isArray(provider.update) && provider.update.length > 0 ? provider.update : provider.install;
    const entry = toInstallCommand({ ...provider, install: command });
    const key = entry.command.join(" ");
    const existing = byCommand.get(key);
    // One global `skills update -g` genuinely refreshes every pack it sees, so
    // a shared command is merged instead of dropped: the report must keep
    // naming every provider that command actually covers.
    if (existing) existing.covers = [...(existing.covers ?? [existing.id]), entry.id];
    else byCommand.set(key, entry);
  }
  return [...byCommand.values()];
}

// Idempotence (2026-10-12): a pack whose `installedWhen` skills are ALL
// already on disk is skipped, so a second `deps --install --yes` runs
// nothing. Providers without installedWhen keep the historical always-run
// behaviour (updates from upstream on every explicit install).
export function pendingInstallCommands(spec: Spec, installedSkillIds: ReadonlySet<string>): InstallCommand[] {
  return enabledProviders(spec)
    .filter((provider) => Array.isArray(provider.install) && provider.install.length > 0)
    .filter((provider) => {
      const when = provider.installedWhen ?? [];
      return when.length === 0 || !when.every((id) => installedSkillIds.has(id));
    })
    .map(toInstallCommand);
}
