---
description: Etat de Novahiz : sante de l'installation, base, index des skills, rapport d'enforcement.
agent: build
---

Rapporte l'état de Novahiz. Arguments : $ARGUMENTS

1. Localise la maison Novahiz : `NOVAHIZ_HOME` si définie, sinon `~/.config/novahiz`. Le CLI est `<maison>/src/cli.ts`.
2. Lance `node <maison>/src/cli.ts doctor --json` et `node <maison>/src/cli.ts report --json`.
3. Mesure la taille de `novahiz.sqlite` et la date de dernière écriture de `build/installed-skills.json`.
4. Présente un résumé court : les anomalies bloquantes d'abord, puis les chiffres clés (lignes du journal, invocations, taille de la base, skills indexées).

Lecture seule. Ne modifie rien.
