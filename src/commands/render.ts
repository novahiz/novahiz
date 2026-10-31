import { readFileSync } from "node:fs";

import { asString, print, type Parsed } from "./context.ts";
import { analyzeHtml, hasBlockingRenderFinding } from "../renderproof.ts";

/**
 * Les en-têtes HTTP d'une vérification de rendu (NX-51).
 *
 * Une page d'administration renvoie la page de connexion sans session : la
 * sonde ne voyait donc jamais l'écran à vérifier. `--cookie` et `--header`
 * laissent l'appelant fournir ce que le navigateur enverrait.
 *
 * `--cookie` prend des paires séparées par des virgules (`a=1,b=2`).
 * `--header` prend un ou plusieurs `Nom: valeur` séparés par `|`, parce qu'un
 * en-tête contient lui-même des deux-points.
 *
 * Fonction pure : elle ne fait aucun appel réseau, ce qui la rend testable.
 */
export function entetesRender(options: { cookie?: string; header?: string }): Record<string, string> {
  const entetes: Record<string, string> = { accept: "text/html" };

  const cookies = (options.cookie ?? "")
    .split(",")
    .map((paire) => paire.trim())
    .filter((paire) => paire.includes("="));
  if (cookies.length > 0) entetes.cookie = cookies.join("; ");

  for (const brut of (options.header ?? "").split("|")) {
    const separateur = brut.indexOf(":");
    if (separateur <= 0) continue;
    const nom = brut.slice(0, separateur).trim();
    const valeur = brut.slice(separateur + 1).trim();
    if (nom.length > 0 && valeur.length > 0) entetes[nom.toLowerCase()] = valeur;
  }

  return entetes;
}

/**
 * `novahiz render --url <url>` ou `--file <chemin>` (NX-38).
 *
 * Lit le HTML réellement servi et en tire une preuve textuelle : titre, langue,
 * plan de titres, alternatives, noms accessibles, identifiants, repères. Sortie
 * non nulle seulement sur un constat bloquant, pour qu'un script puisse s'y
 * fier.
 */
export async function commandRender(parsed: Parsed): Promise<void> {
  const url = asString(parsed.flags.url);
  const file = asString(parsed.flags.file);

  if (url.length === 0 && file.length === 0) {
    throw new Error("render: fournir --url <url> ou --file <chemin>");
  }

  let html: string;
  let source: string;

  if (url.length > 0) {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
      headers: entetesRender({
        cookie: asString(parsed.flags.cookie),
        header: asString(parsed.flags.header),
      }),
    });
    html = await response.text();
    source = `${url} (HTTP ${response.status})`;
  } else {
    html = readFileSync(file, "utf8");
    source = file;
  }

  const report = analyzeHtml(html);
  print({ source, ...report });

  if (hasBlockingRenderFinding(report)) process.exitCode = 1;
}
