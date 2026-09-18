---
name: skillenforce-analyse
description: |
  Step 4 of the skillenforce pipeline: understand the code involved before changing it.
  Five ordered phases (recognition, architecture, quality, operation, synthesis),
  supported by the code map when available. Every claim cites a real file path;
  anything that could not be determined is stated explicitly.
  Use before touching unfamiliar code, before a refactor or a migration, or to locate a bug.
  Triggers on: "understand this code", "where is", "who calls", codebase map,
  impact analysis, root cause, entry point.
license: MIT
compatibility: opencode
---

# skillenforce-analyse: understand before modifying

**Step 4 of 6** in the pipeline. The analysis focuses on what the task requires, never on the whole repository. Depth over exhaustiveness.

Previous step: `skillenforce-task`. Next step: `skillenforce-implement`.

## Rely on the code map

Before reading at random: the `code-understand` skill builds a ranked, cited map, and the `narsil` server exposes the call graph, symbols, references, and imports. A "who calls this" question is answered with the tool, not by guessing.

## Phase 1: recognition

- Directory tree at two or three levels.
- Manifests first: package.json, Cargo.toml, go.mod, pyproject.toml, pom.xml, build.gradle, Gemfile, csproj, Podfile, Package.swift.
- Build and CI: Makefile, Dockerfile, docker-compose, workflows, turbo.json, nx.json.
- Configs: tsconfig, eslint, environment model, bundler, editorconfig.
- Docs: README, CONTRIBUTING, ARCHITECTURE, docs folder.
- Languages, frameworks, presence of a monorepo.

## Phase 2: architecture

- Entry points: main, index, server, routes, CLI, AppDelegate, activities.
- Follow up to five critical end-to-end paths: route to controller to service to data to response.
- Dependency graph between modules.
- Dominant pattern: monolith, microservices, event-driven, hexagonal, MVC, CQRS.
- Data layer: schemas, migrations, ORM, models, cache.
- API surface: REST, GraphQL, gRPC, WebSocket, IPC, contracts, authentication.

## Phase 3: quality

- Tests: structure, frameworks, unit, integration, end-to-end, fixtures, mocks.
- Error handling and logging.
- Typing and runtime validation.
- Security posture: authentication, authorization, secrets, sanitization, dependency vulnerabilities.
- Pattern consistency, naming, duplication.

## Phase 4: operation

Build, CI/CD, deployment model, observability, environment management.

## Phase 5: synthesis

Write the synthesis after the previous phases, never before. Every claim cites a real file path. State what you could not determine. An ASCII diagram helps for architecture.

Destination: the project's documentation folder if it has one, otherwise the execution ledger. You do not invent `docs/analysis/` in a project that has no such convention.

## Six categories require this step

`code`, `debug`, `review`, `database-supabase`, `devops`, and `data`.

## Rules

- Read before writing.
- Ignore generated, vendored, and boilerplate code.
- Do not re-document the whole repository for every task: target the useful scope.
- An observation without a file path is worthless.

## Output

The files and symbols that carry the logic, the data paths, the extension points, and the explicit list of remaining unknowns. This output feeds `skillenforce-implement`.
