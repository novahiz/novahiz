# Security

## What Novahiz runs

The gate runs the local CLI (`node src/cli.ts`) as a child process. It reads JSON spec files from the repository and the skill roots you configure. It does not make network calls.

The opencode adapter runs the CLI on tool calls. It has no network code and no credentials.

## Reporting

Report a vulnerability through a private GitHub security advisory on the repository, or contact the maintainers directly. Do not open a public issue for an exploitable problem.

Include the affected version, a description, and the steps to reproduce. We aim to acknowledge reports within a few days.

## Bundled third-party content

The bundled skills include reference files written by third parties. Some of those files demonstrate insecure code as a teaching example, including placeholder credentials such as `API_KEY = "sk-1234..."`. Those are illustrative strings, not live secrets. A secret scanner run over the repository may flag them; treat a hit inside a skill's `references/` directory as documentation until proven otherwise.

## Scope

Novahiz reads files under your configured skill roots. Treat the spec files as trusted input. A rule that requires an unavailable skill is reported and skipped, so a misconfigured catalog degrades rather than blocks, as long as the installed-skills index exists. When that index is missing or unreadable, the gate fails closed instead.
