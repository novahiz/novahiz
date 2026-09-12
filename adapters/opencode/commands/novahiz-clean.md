---
description: Nettoie partiellement les anciennes donnees de novahiz.sqlite (journal, progression, sessions, taches terminees).
agent: build
---

Nettoie les anciennes données de la base Novahiz. Arguments : $ARGUMENTS

1. Localise la maison Novahiz : `NOVAHIZ_HOME` si la variable est définie, sinon `~/.config/novahiz`. Le CLI est `<maison>/src/cli.ts`.
2. Lance le mode plan : `node <maison>/src/cli.ts clean $ARGUMENTS --dry-run --json`.
3. Présente le tableau : cible, ancienneté, lignes par table, total à retirer.
4. Demande une confirmation explicite avec l'outil `question` (appliquer, changer la cible, annuler).
5. Si l'utilisateur confirme, relance la même commande avec `--apply` à la place de `--dry-run`, puis rapporte les lignes réellement supprimées et la taille avant et après.

Ne supprime jamais sans confirmation dans ce tour. Lancer la commande ne vaut pas accord.

Cibles : `logs` (défaut), `roadmap`, `sessions`, `tasks`, `all`. Drapeaux : `--days N` (défaut 30), `--vacuum`, `--target <cible>`.
