# Notices

Novahiz is licensed under Apache-2.0. See [LICENSE](LICENSE).

## Bundled skills

The `skills/` directory ships a curated set of agent skills so the system works right after installation. These files were carried over from the earlier Novahiz repository and keep their original content.

Each skill is a self-contained folder. When a skill folder contains its own `LICENSE` or `NOTICE`, that file governs that skill and is kept in place. Where no per-skill license is present, the skill is distributed as part of Novahiz under Apache-2.0.

Several skills originate from third-party projects. `humanizer` is derived from the community "Signs of AI writing" work. `impeccable` is by Paul Bakaus. If you are an author and want a different attribution or removal, open an issue on the repository.

## Dependencies

The core and the MCP server use Node.js built-ins only. The opencode adapter imports only Node.js built-ins and the `@opencode-ai/plugin` types, which the harness provides.
