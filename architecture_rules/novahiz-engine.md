# Novahiz Engine

## 1. Classification
Classifiez chaque requête en 1 des 13 catégories. Loggez l'événement:
`novahiz_log(rule="request_classified", detail="[catégorie]")`

## 2. Gate (Pre-Task)
Vérifiez toutes les règles requises avec `novahiz_gate`. Bloquez jusqu'à ce qu'il renvoie PASS.

## 3. Inventory
Chargez les skills nécessaires. Consultez toujours `skills_inventory.md` et loguez l'événement.

## 4. Plan (Todo)
Décomposez en tâches atomiques.

## 5. Execute
Exécutez le Todo. Le Gate bloquera automatiquement les outils non autorisés.

## 6. Code Review + Tech Debt
Une fois terminé, utilisez le skill `code-review-excellence` et `tech-debt-detector`.

## 7. Memory
Effectuez le Dual-Write (fichier projet `MEMORY.md` + vault Obsidian).

## 8. Gate (Post-Task)
Vérifiez que le code review et la mémoire ont été faits.

## 9. Session Audit
En fin de session, lancez `novahiz_audit`.
