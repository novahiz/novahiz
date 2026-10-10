---
name: memory
description: |
  memory is the alias for novahiz-memory, the local context save into MEMORY.md
  and project-memory slots - never the Obsidian vault.
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "3.0.0"
---

# Alias

The local save is defined once in the `novahiz-memory` skill.

Load `novahiz-memory` instead of applying custom logic here. It writes the project's `MEMORY.md` and the matching `project-memory/` slot — both stay inside the project; the Obsidian vault is out of scope for memory.
