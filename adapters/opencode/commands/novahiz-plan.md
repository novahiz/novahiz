---
description: Produit le plan Novahiz d'une demande (direction, perimetre, taches, analyse) sans executer aucune ecriture.
agent: plan
---

Établis le plan Novahiz de la demande suivante, et rien d'autre. Arguments : $ARGUMENTS

Tu es en lecture seule. Aucune écriture de fichier, aucune commande qui change l'état, aucun commit. Le harnais refuse déjà les éditions dans cet agent ; ne cherche pas à le contourner.

1. Classe la demande avec l'outil `novahiz_classify`. Lis les catégories et les skills requises.
2. Charge avec l'outil `skill` celles que le gate réclame. Si le harnais refuse, continue : le plan ne dépend pas de leur chargement.
3. Produis le plan dans cet ordre, en quatre mouvements :
   - Direction : ce que « terminé » veut dire, le périmètre, l'approche retenue, les options écartées et pourquoi.
   - Clarification : les familles ambiguës. Pose tes questions avec l'outil `question`, une salve à la fois, deux à cinq options exclusives par question, la recommandation en premier. Aucune question rédigée en prose dans le chat.
   - Tâches : pour chacune, objectif, critères d'acceptation testables, preuve, dépendances, fichiers concernés, taille XS à XL.
   - Analyse : les fichiers et symboles qui portent la logique, les chemins de données, et les inconnues qui restent.
4. Trace le plan dans le registre avec `novahiz_task` : `action: "new"` pour créer la tâche, puis `action: "plan"` pour y déposer les étapes. N'ouvre aucune étape.
5. Affiche le récapitulatif, puis arrête-toi.

Interdits dans ce tour : modifier un fichier, lancer une commande qui change l'état, committer, annoncer comme fait ce qui n'a pas été exécuté.

Termine par la suite honnête : relancer la même demande sans le préfixe `/novahiz-plan` pour exécuter le plan.
