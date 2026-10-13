# Disclosure progressive

Trois niveaux, dans cet ordre de cout : metadonnees, corps du SKILL.md,
ressources. Chaque niveau ne se charge que si le precedent a justifie
son chargement. L'objectif n'est pas d'economiser des tokens au centieme :
c'est de garder la fenetre disponible pour le travail de l'utilisateur.

## Niveau 1 — metadonnees (toujours en contexte)

`name` et `description` sont charges pour **tous** les skills du registre,
declenches ou non. C'est le niveau le plus cher du systeme, pas le moins :
il paie le cout de tous les skills que vous n'utiliserez pas cette session.

Consequences pratiques :

- Une description longue est une taxe permanente. 1024 caracteres est le
  maximum autorise, pas une cible.
- Un mot rare vaut mieux qu'un adjectif. `wireframe` route mieux que
  `interface`.
- Dire **quand** ne pas utiliser le skill reduit les declenchements
  parasites autant que dire quand l'utiliser.

## Niveau 2 — corps du SKILL.md (sur declenchement)

Le corps est charge une fois, au declenchement. Il doit tenir sous
**500 lignes**. Au-dela, `scan-skill.py` signale un echec dur.

Le seuil de 500 lignes n'est pas un caprice de formatage : au-dela, le
corps commence a entrer en conflit avec le travail reel, et l'agent
commence a sauter des instructions. Un corps trop long est un corps qui
ne sera pas suivi.

Au-dela de 500 lignes, deplacer le detail dans `references/` et laisser
dans le corps un pointeur explicite du type :

```
Le format complet de l'evals.json : references/evals-spec.md
```

Un pointeur sans nom de fichier oblige l'agent a deviner. Un pointeur
avec chemin relatif se suit sans ambiguïté.

## Niveau 3 — ressources (a la demande)

`references/`, `assets/` et `scripts/` ne sont lus que si le corps les
designe. Trois usages distincts :

| Dossier | Contenu | Qui le lit |
|---|---|---|
| `references/` | specifications, cas limites, pieges | l'agent, sur pointeur du corps |
| `assets/` | modeles a copier (templates) | l'agent, pour produire un fichier |
| `scripts/` | outils executables deterministes | l'agent, en shell |

Ne pas fusionner ces roles. Un script qui imprime un template est plus
dur a maintenir qu'un template et un script separes.

## Signes qu'un skill viole la disclosure progressive

**Le corps contient un schema JSON complet que le corps reexplique.**
Deplacer le schema dans `references/`, garder un exemple de trois lignes.

**Les references font moins de dix lignes.** Un fichier de six lignes
n'est pas une reference, c'est un placeholder. Soit il porte du contenu
reel, soit il n'existe pas : un stub consomme de l'attention sans
apporter de certitude.

**Le corps contient des codes de sortie en dur qui different du script.**
Le corps et le script doivent dire la meme chose, et le script fait foi.
En cas d'ecart, corriger le corps.

**Le skill dit qu'il fait quelque chose qu'aucun de ses fichiers ne fait.**
C'est le cas le plus grave, parce qu'il corrompt la decision de l'agent :
elle croit avoir une capacite qu'elle n'a pas. Voir `scripts/` et le
contrat honnete.

## Verification

```
python scripts/scan-skill.py .
# body_lines <= 500, references au niveau 1, scripts avec --help
```
