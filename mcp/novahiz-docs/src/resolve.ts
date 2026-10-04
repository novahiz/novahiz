// Resolution fuzzy LOCALE d'un nom de bibliotheque vers une entree du
// bouquet. Deterministe et sans LLM : crible par trigrammes (le meme
// principe que le tokenizer de l'index) avec un echelle de scores exacts
// qui ecrasent toujours l'approximation.
//
// Echelle :
//   100 id exact            "nextjs"
//    90 alias exact          "next", "next.js", "reactjs"
//    85 nom exact            "Tailwind CSS" insensitive a la casse
//    75 prefixe d'id (>=3)   "type" -> typescript
//    65 partie d'id (>=3)    "router" -> reactrouter
//    48-60 dice(trigrammes)  "reacr" -> react  (faute de frappe)

import type { CatalogEntry } from "./catalog.ts";

export type MatchedOn = "id" | "alias" | "name" | "prefix" | "substring" | "fuzzy";

export interface Resolution {
  entry: CatalogEntry;
  score: number;
  matchedOn: MatchedOn;
}

export interface ResolveOptions {
  /** Nombre maximal de propositions (defaut 5, plafond 20). */
  limit?: number;
}

// Dessous, la proposition est du bruit : mieux vaut rien qu'une bibliotheque
// au hasard. Les scores fuzzy occupent ensuite [48, 60] — toujours sous la
// sous-chaîne (65), jamais au-dessus d'une correspondance exacte.
export const MIN_SIMILARITY = 0.4;

function trigrams(value: string): Set<string> {
  const padded = ` ${value} `;
  const grams = new Set<string>();
  for (let index = 0; index + 3 <= padded.length; index += 1) grams.add(padded.slice(index, index + 3));
  return grams;
}

/** Coefficient de Dice sur les trigrammes : 1 = identique, 0 = disjoint. */
export function similarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

export function resolve(
  query: string,
  catalog: readonly CatalogEntry[],
  options: ResolveOptions = {}
): Resolution[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 5), 1), 20);

  const resolutions: Resolution[] = [];
  for (const entry of catalog) {
    const id = entry.id.toLowerCase();
    const name = entry.name.toLowerCase();
    let score = 0;
    let matchedOn: MatchedOn | null = null;

    if (id === needle) {
      score = 100;
      matchedOn = "id";
    } else if (entry.aliases.some((alias) => alias.toLowerCase() === needle)) {
      score = 90;
      matchedOn = "alias";
    } else if (name === needle) {
      score = 85;
      matchedOn = "name";
    } else if (needle.length >= 3 && id.startsWith(needle)) {
      score = 75;
      matchedOn = "prefix";
    } else if (needle.length >= 3 && id.includes(needle)) {
      score = 65;
      matchedOn = "substring";
    } else {
      const best = Math.max(
        similarity(needle, id),
        similarity(needle, name),
        ...entry.aliases.map((alias) => similarity(needle, alias.toLowerCase()))
      );
      if (best >= MIN_SIMILARITY) {
        // Palette [48, 60] : (best - 0.4) * 20 borne a 12, donc 60 max,
        // toujours sous la sous-chaîne (65).
        score = 48 + Math.round((best - MIN_SIMILARITY) * 20);
        matchedOn = "fuzzy";
      }
    }

    if (matchedOn !== null) resolutions.push({ entry, score, matchedOn });
  }

  // Tri deterministe : score decroissant, puis id alphabetique — le meme
  // appel rend toujours la meme liste, cache client comprises.
  resolutions.sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id));
  return resolutions.slice(0, limit);
}
