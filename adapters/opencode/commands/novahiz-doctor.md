---
description: Diagnostique l'installation Novahiz et propose le correctif exact de chaque anomalie.
agent: build
---

Diagnostique l'installation Novahiz. Arguments : $ARGUMENTS

1. Localise la maison Novahiz : `NOVAHIZ_HOME` si définie, sinon `~/.config/novahiz`. Le CLI est `<maison>/src/cli.ts`.
2. Lance `node <maison>/src/cli.ts doctor --json`.
3. Pour chaque contrôle en échec, donne le correctif exact à lancer, en te fondant sur le détail renvoyé. Par exemple `npm install -g defuddle` quand une CLI externe manque, ou `node src/cli.ts sync` quand l'index est périmé.
4. Propose d'appliquer les correctifs un par un, avec accord explicite. Ne modifie rien sans accord.
