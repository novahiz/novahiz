# Spécification du frontmatter

Le frontmatter YAML doit commencer par --- et se terminer avant le prochain ---.
Champs obligatoires : name (kebab-case, ≤64 caractères), description (≤1024 caractères, pas de balises XML), license.
Champs optionnels : compatibility, metadata (author, organization, version, date).
Le nom du dossier doit correspondre au champ name après normalisation NFKC.
