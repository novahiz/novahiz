---
name: memory
description: Sauvegarde Dual-Write du contexte
---

# Novahiz Memory Skill

Utilisé à la fin d'une tâche pour persister le contexte.

1. Identifiez les décisions techniques majeures prises.
2. Écrivez le résumé dans `MEMORY.md` à la racine du projet.
3. Si le vault Obsidian est disponible via l'outil MCP (obsidian), synchronisez le contexte de la session dans le vault.
4. Loguez l'événement `novahiz_log(rule="memory_saved", status="PASS")`.
