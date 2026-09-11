# Notices

Novahiz is licensed under Apache-2.0. See [LICENSE](LICENSE).

## Bundled skills

The `skills/` directory ships a curated set of agent skills so the system works right after installation. Each skill is a self-contained folder. When it carries its own `LICENSE` or `NOTICE`, that file governs that skill. The rest ship with Novahiz under Apache-2.0.

Some skills began as community work and keep their upstream attribution: `skill-creator` is by Anthropic, `impeccable` by Paul Bakaus, `adversarial-reviewer` by ekreloff. If you are an author and want a different attribution or removal, open an issue on the repository.

## Providers

Providers are referenced by install command, never vendored. Each lists its upstream license in `catalog/providers.json`.

## Dependencies

The core and the MCP server use Node.js built-ins only. The opencode adapter imports only Node.js built-ins and the `@opencode-ai/plugin` types, which the harness provides.
