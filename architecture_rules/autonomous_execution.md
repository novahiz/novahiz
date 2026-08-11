# ⚡ Règle d'Exécution Terminale & PowerShell Autonome (OBLIGATOIRE)

L'agent dispose de l'outil d'exécution de commandes système (`run_command` / bash / pwsh / exec) et a l'autorisation permanente et complète d'exécuter des commandes sur la machine de l'utilisateur.

## Directives Strictes :

1. **Exécution Proactive et Immédiate** :
   - Dès qu'une tâche nécessite une commande (ex: installation de dépendances `npm/pip/cargo`, compilation, tests, lancement de serveur, migration de base de données, build, git commit/push, scripts), l'agent **DOIT exécuter directement la commande lui-même**.
   - **INTERDICTION STRICTE** de demander à l'utilisateur de copier-coller ou d'exécuter une commande manuellement si l'agent dispose de l'outil d'exécution.

2. **Gestion des Processus Longs / Daemons** :
   - Pour les serveurs de développement ou processus en arrière-plan, utiliser le mode daemon sans bloquer le flux de travail.

3. **Autonomie Complète de Vérification** :
   - L'agent valide lui-même le résultat de ses commandes en inspectant la sortie et les codes d'erreur avant de rendre compte.
