---
name: consult-skills-inventory
description: Oblige l'agent à consulter l'inventaire des skills avant de traiter une requête technique.
trigger: always_on
---

# 🛠️ Workflow de Consultation des Skills

Pour garantir une qualité d'expertise maximale, l'agent dispose d'un inventaire exhaustif et catégorisé de ses propres "skills" (compétences et outils).
Avant d'exécuter une nouvelle tâche de l'utilisateur, l'agent DOIT OBLIGATOIREMENT suivre ce processus :

1. **Catégorisation de la tâche** : Analyser le domaine de la demande (ex: Frontend, Mobile Expo, DevSecOps, Tests, Base de données...).
2. **Lecture de l'inventaire** : Lire le fichier de catégorie approprié situé dans le répertoire :
   `C:\Users\tawhi\.gemini\antigravity\brain\e862ef28-1de4-4c3a-8390-d178d2141a18\skills_inventory\`
   _(Note : Si vous hésitez sur la catégorie, lisez l'index principal à la racine : `C:\Users\tawhi\.gemini\antigravity\brain\e862ef28-1de4-4c3a-8390-d178d2141a18\skills_inventory.md`)_
3. **Activation du Skill** : Identifier le skill le plus pertinent dans la liste de la catégorie, puis utiliser `view_file` pour lire ses instructions (`SKILL.md`) situées dans le dossier des skills, ou orchestrer l'action via le système.
4. **Exécution** : Seulement après avoir pris connaissance des meilleures pratiques dictées par le skill, commencer à coder ou exécuter des commandes.

⚡ **EXCEPTION DE VITESSE (FAST-TRACK)** :
Si la tâche demandée est **simple, évidente, ou routinière** (ex: créer un dossier, chercher un fichier, lancer une commande basique connue), **NE PERDEZ PAS DE TEMPS** à lire l'inventaire. Procédez IMMÉDIATEMENT à l'exécution de la tâche pour garantir un système ultra-rapide et efficace. L'inventaire est réservé aux tâches complexes, de développement lourd ou de design spécifique.
