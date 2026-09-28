---
name: novahiz-analyse
description: |
  novahiz-analyse, step 4 of the Novahiz pipeline: understand the affected code
  before modifying it. Five ordered phases (reconnaissance, architecture, quality,
  operations, synthesis), backed by the code map when one is available. Every claim cites
  a real file path, and what could not be determined gets stated as such.
  Use before touching unfamiliar code, before a refactor or a migration, or to locate a bug.
  Triggers on: "understand this code", "where is", "who calls", codebase map,
  impact analysis, root cause, entry point.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-analyse: understand before modifying

**Step 4 of 6** in the pipeline. Analysis covers what the task requires. The whole repo stays out of scope. Depth beats breadth.

Previous: `novahiz-task`. Next: `novahiz-implement`.

## Use the code map

Before reading at random: the `narsil` server exposes call graphs, symbols, references, and imports. A "who calls this" question gets resolved with the tool, so you never guess.

## Phase 1: reconnaissance

- Directory tree to two or three levels.
- Manifests first: package.json, Cargo.toml, go.mod, pyproject.toml, pom.xml, build.gradle, Gemfile, csproj, Podfile, Package.swift.
- Build and CI: Makefile, Dockerfile, docker-compose, workflows, turbo.json, nx.json.
- Configs: tsconfig, eslint, environment template, bundler, editorconfig.
- Docs: README, CONTRIBUTING, ARCHITECTURE, docs directory.
- Languages, frameworks, monorepo presence.

## Phase 2: architecture

- Entry points: main, index, server, routes, CLI, AppDelegate, activities.
- Trace up to five critical paths end to end: route, controller, service, data, response.
- Dependency graph between modules.
- Dominant pattern: monolith, microservices, event-driven, hexagonal, MVC, CQRS.
- Data layer: schemas, migrations, ORM, models, cache.
- API surface: REST, GraphQL, gRPC, WebSocket, IPC, contracts, authentication.

## Phase 3: quality

- Tests: structure, frameworks, unit, integration, end to end, fixtures, mocks.
- Error handling and logging.
- Typing and runtime validation.
- Security posture: authentication, authorization, secrets, sanitization, dependency vulnerabilities.
- Pattern consistency, naming, duplication.

## Phase 4: operations

Build, CI/CD, deployment model, observability, environment management.

## Phase 5: synthesis

Write the synthesis after the preceding phases and never before them. Each claim cites a real file path. State what you could not determine. An ASCII diagram helps when the architecture matters.

Destination: the project's documentation directory if one exists, otherwise the execution ledger. Do not invent `docs/analysis/` in a project with no such convention.

## Categories that require this step

`code`, `debug`, `review`, `database-supabase`, `devops`, and `data`. `flutter` and `expo` also require it via their own roadmaps.

## Rules

- Read before writing.
- Skip generated, vendored, and boilerplate code.
- Do not re-document the entire repo on every task: aim at the useful scope.
- An observation without a file path carries no weight.

## Exit

The files and symbols that carry the logic, the data paths, the extension points, and an explicit list of remaining unknowns. `novahiz-implement` consumes this output.
