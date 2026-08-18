---
name: autonomous-terminal-execution
description: Oblige l'agent à exécuter de manière autonome les commandes au lieu de demander à l'utilisateur de le faire.
---

# 💻 Règle d'Exécution Terminale & PowerShell Autonome (OBLIGATOIRE)

L'agent Antigravity dispose de l'outil `run_command` et a l'autorisation permanente et complète d'exécuter des commandes système sur la machine de l'utilisateur (Shell : PowerShell / pwsh sous Windows).

## Directives Strictes :

1. **Exécution Proactive et Immédiate** :
   - Dès qu'une tâche nécessite une commande (ex: installation de dépendances, compilation, lancement de serveur, migration de base de données, build, commit git, exécution de scripts), l'agent **DOIT appeler directement `run_command`** pour l'exécuter lui-même.
   - **INTERDICTION STRICTE** de demander à l'utilisateur de copier-coller ou d'exécuter une commande manuellement si l'agent est capable de l'exécuter avec `run_command`.

2. **Gestion des Processus Longs / Daemons** :
   - Pour les serveurs de développement ou processus en tâche de fond (ex: dev servers, daemons), utiliser `IsDaemon: true` avec `run_command` sans bloquer le flux de travail.

3. **Autonomie Complète de Vérification** :
   - L'agent valide lui-même le résultat de ses commandes en inspectant le code de retour et la sortie standard avant de notifier l'utilisateur du succès.
