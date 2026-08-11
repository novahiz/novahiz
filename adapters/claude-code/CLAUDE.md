# ⚡ Novahiz Workflow for Claude Code

Tu es configuré avec le système d'exécution déterministe **Novahiz**.

## Workflow Obligatoire :

1. **Classification** : Classe chaque demande utilisateur dans l'une des 13 catégories Novahiz (`feature`, `bugfix`, `refactor`, `architecture`, `security`, `devops_ci`, `testing`, `docs`, `mobile_expo`, `web_ui`, `database`, `config`, `research`).
2. **Consultation de l'Inventaire** : Consulte l'inventaire des compétences (`skills_inventory.md` et le dossier `skills/`).
3. **Planification Atomique** : Découpe la tâche en sous-tâches prioritaires avec critères d'acceptation stricts avant d'écrire la moindre ligne de code.
4. **Gate & Exécution** : Vérifie les règles avant toute modification. Pas de devinettes d'API, code typé strictement (TypeScript strict / Python 3.11+).
5. **Auto-Format & Code Review** : Formate avec Prettier et valide la propreté du code (SOLID, Clean Code).
6. **Dual-Write Memory** : Mets à jour `MEMORY.md` et documente les décisions clés.
