---
name: skillenforce-gate
description: |
  Le gate d'application de skillenforce, vu du côté agent. Explique pourquoi une édition est
  refusée, quelles skills la débloquent, et comment lire le message de blocage.
  Le gate est implémenté dans src/gate.ts et combine deux sources : les règles
  (catalog/rules.json) et les étapes de roadmap de type skill non optionnelles
  (catalog/categories.json).
  Use when an edit is refused, before a significant action, or to know which skill to load.
  Triggers on: "le gate bloque", "missing skill", requiredSkills, enforcement, skillenforce_GATE,
  "pourquoi mon edition est refusee".
license: MIT
compatibility: opencode
---

# skillenforce-gate : lire et satisfaire le gate

Le gate vérifie une seule chose : les skills requises par le contexte sont-elles chargées ? Si non, il refuse l'édition.

## Les deux sources d'exigence

**Les règles** (`catalog/rules.json`), évaluées sur le chemin, la classe de fichier, la catégorie active et le contenu :

| Règle | Se déclenche sur | Exige |
|---|---|---|
| R1-docs | texte, data, config | `humanizer` |
| R1-code-prose | code ou design dont le contenu porte de la prose | `humanizer` |
| R2-style | css, scss, sass, less, styl, html, vue, svelte, astro | `impeccable` |
| R2-styled-component | jsx, tsx dont le contenu touche au style | `impeccable` |
| R2-design-target | catégorie `design-ui` sur un fichier de design | `impeccable` |
| R3-supabase | chemin `**/supabase/**` ou `**/migrations/**`, catégorie `database-supabase` | `supabase`, `supabase-postgres-best-practices` |

**Les étapes de roadmap** : seules celles `kind: "skill"` et non `optional` bloquent. Les étapes `edit`, `verify` et `advisory` apparaissent dans `requiredSkills` mais ne refusent rien.

## Sémantique exacte (gate.ts:229-236)

```
si l'index est disponible ET que la skill n'y figure pas
  -> unmatchedRequired : non appliquée, et signalée nulle part
sinon
  -> effective : appliquée
```

Trois conséquences à connaître :

1. **Skill absente de l'index** (`build/installed-skills.json`, écrit au dernier `sync`) : elle cesse d'être exigée, en silence. Aucun message ne le dit.
2. **Skill présente dans l'index mais absente du disque** : elle reste exigée et rien ne peut la charger. Blocage définitif jusqu'au prochain `sync`.
3. **Index illisible** : tout est exigé. Le gate devient plus strict, jamais plus laxiste.

## Lire un blocage

```
{
  "allow": false,
  "missingSkills": ["humanizer"],
  "indexMissing": false,
  "targets": [{
    "path": "...", "fileClass": "text", "roadmap": "feature",
    "matchedRules": ["R1-docs"], "reasons": ["missing skill: humanizer"]
  }]
}
```

`missingSkills` est la liste à charger. `matchedRules` dit pourquoi. `roadmap` dit quelle catégorie a imposé le reste.

## Débloquer

Charge chaque skill manquante avec `skill({name})`. Le chargement est enregistré dans la session, le gate repasse.

Une skill requise devenue introuvable n'est pas un obstacle à contourner : c'est le signal que l'index et le disque ont divergé. Un `sync` les remet d'accord.

## Contournement

Le seul prévu par le code : `skillenforce_GATE=off` (ou `0`, `false`, `no`, `disabled`) dans l'environnement, lu via `gate.envEscape`. L'utilisateur peut aussi demander explicitement de passer outre. Dans les deux cas, la dérogation se dit à voix haute et se rattrape après coup. Le jugement de l'agent n'est pas un contournement valide.

## Anti-patterns

- Charger une skill sans rapport pour faire taire le message.
- Éditer en contournant, puis régulariser plus tard.
- Supposer que l'édition est passée sans regarder `allow`.
- Oublier `sync` après avoir ajouté ou renommé une skill.
- Croire qu'une étape `edit` ou `verify` bloque : seul `kind: "skill"` bloque.
