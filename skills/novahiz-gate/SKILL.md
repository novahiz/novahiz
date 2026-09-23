---
name: novahiz-gate
description: |
  novahiz-gate vu côté agent : pourquoi une édition est refusée, quelles skills la
  débloquent, comment lire le message de blocage. Implémenté dans src/gate.ts, il combine
  catalog/rules.json et les étapes de roadmap de type skill non optionnelles dans
  catalog/categories.json.
  Use when an edit is refused, before a significant action, or to know which skill to load.
  Triggers on: "le gate bloque", "missing skill", requiredSkills, enforcement, novahiz_GATE,
  "pourquoi mon edition est refusee".
license: Apache-2.0
compatibility: opencode
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# novahiz-gate

Le gate pose une seule question : les skills exigées par le contexte sont-elles chargées ? Tant que la réponse est non, l'édition est refusée.

## Deux sources d'exigence

**Les règles** (`catalog/rules.json`) se déclenchent sur le chemin, la classe de fichier, la catégorie active ou le contenu :

| Règle | Se déclenche sur | Exige |
|---|---|---|
| R1-docs | texte, data, config | `novahiz-humanizer` |
| R1-code-prose | code ou design dont le contenu porte de la prose | `novahiz-humanizer` |
| R3-supabase | chemin `**/supabase/**` ou `**/migrations/**`, catégorie `database-supabase` | `supabase`, `supabase-postgres-best-practices` |

**Les étapes de roadmap** (`catalog/categories.json`) : seules celles marquées `kind: "skill"` sans `optional` bloquent. Les étapes `edit`, `verify` et `advisory` apparaissent dans `requiredSkills` mais ne refusent rien.

## Sémantique de l'index (gate.ts, lignes 229 à 236)

```
index disponible ET skill absente de l'index  ->  unmatchedRequired
sinon                                          ->  effective
```

Trois conséquences à connaître :

1. Skill absente de l'index (`build/installed-skills.json`, écrit au dernier `sync`) : elle cesse d'être exigée en silence, sans message.
2. Skill présente dans l'index mais absente du disque : elle reste exigée et rien ne peut la charger. Blocage jusqu'au prochain `sync`.
3. Index illisible : tout est exigé. Le gate devient plus strict, jamais plus laxiste.

## Lire un blocage

```json
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

`missingSkills` liste ce qu'il faut charger. `matchedRules` explique pourquoi. `roadmap` indique la catégorie qui a imposé le reste.

## Débloquer

Charger chaque skill manquante avec `skill({name})`. Le chargement est enregistré dans la session et le gate repasse. Une skill requise devenue introuvable signale une divergence index/disque : un `sync` les remet d'accord.

## Contournement

Le seul prévu par le code : `novahiz_GATE=off` (ou `0`, `false`, `no`, `disabled`) dans l'environnement, lu via `gate.envEscape`. L'utilisateur peut aussi demander explicitement de passer outre. Dans les deux cas, la dérogation se dit à voix haute et se rattrape après coup. Le jugement de l'agent n'est pas un contournement valide.

## Anti-patterns

- Charger une skill sans rapport pour faire taire le message.
- Éditer en contournant, puis régulariser plus tard.
- Supposer que l'édition est passée sans regarder `allow`.
- Oublier `sync` après avoir ajouté ou renommé une skill.
- Croire qu'une étape `edit` ou `verify` bloque : seul `kind: "skill"` bloque.
