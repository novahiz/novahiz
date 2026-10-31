/**
 * Politique du navigateur de vérification (NX-37).
 *
 * Le 2026-10-31, la configuration Playwright tournait avec `--browser=msedge`
 * mais **sans `--user-data-dir`**. Chaque démarrage créait donc un profil
 * différent : onze dossiers `mcp-msedge-*` dans `%LOCALAPPDATA%`, et une
 * session qui se connecte dans l'un ne l'est plus dans l'autre. Deux sessions
 * qui se partagent l'outil se marchent dessus sans qu'aucun message ne le dise.
 *
 * La règle est courte : Edge uniquement, un profil explicite et unique, jamais
 * `--isolated` pour le travail qui a besoin d'une session. Ce module la vérifie
 * sur le texte de la configuration, sans lancer de navigateur.
 */

/**
 * La commande du serveur Playwright, lue dans un `opencode.jsonc`.
 *
 * Le fichier contient des commentaires : on n'essaie pas de le parser en JSON,
 * on isole le bloc `"playwright"` puis on relit ses chaînes. Suffisant pour un
 * diagnostic, et robuste aux commentaires.
 */
export function commandePlaywright(texteConfig: string): string[] | null {
  const bloc = texteConfig.match(/"playwright"\s*:\s*\{[\s\S]*?"command"\s*:\s*\[([\s\S]*?)\]/);
  if (!bloc) return null;

  const commande: string[] = [];
  for (const trouve of bloc[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    try {
      commande.push(JSON.parse(`"${trouve[1]}"`) as string);
    } catch {
      commande.push(trouve[1]);
    }
  }
  return commande.length > 0 ? commande : null;
}

/** Les problèmes de politique, vides quand la configuration est saine. */
export function verifierPolitiquePlaywright(commande: readonly string[] | null): string[] {
  if (!commande || commande.length === 0) {
    return ["aucune commande Playwright dans la configuration"];
  }

  const texte = commande.join(" ").toLowerCase();
  const problemes: string[] = [];

  if (/--browser[= ](chrome|chromium)\b/.test(texte)) {
    problemes.push("Chromium/Chrome demandé explicitement : Edge est le seul navigateur autorisé");
  }
  if (!/--browser[= ]msedge\b/.test(texte)) {
    problemes.push("navigateur non imposé : ajouter --browser=msedge");
  }
  if (!/--user-data-dir[= ]/.test(texte)) {
    problemes.push("aucun --user-data-dir : chaque démarrage crée un profil, donc une session différente");
  }
  if (/--isolated\b/.test(texte)) {
    problemes.push("--isolated : aucun état conservé entre les appels, la connexion est perdue à chaque lancement");
  }

  return problemes;
}
