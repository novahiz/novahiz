// Decoupe d'une page de documentation en passages indexables.
//
// Regles, dans l'ordre :
//   1. frontiere principale = titres H1-H3 rencontres HORS bloc de code — un
//      passage garde son titre, donc son chemin de sections (heading_path) ;
//   2. une fence ``` voyage entiere : le bloc de code n'est jamais coupe au
//      hasard en pleine ligne ;
//   3. un passage trop long est regroupe par paragraphes (lignes vides) avant
//      d'etre coupe, pour que chaque morceau reste comprehensible seul ;
//   4. cas extreme : un paragraphe ou un code plus grand que la limite est
//      decoupe ligne par ligne, et une fence > limite est refermee puis
//      rouverte a chaque morceau (chaque passage reste du markdown valide).

export interface MarkdownChunk {
  /** Titres successifs de la section, H1 compris, ex. ["Guide", "Hooks"]. */
  headingPath: string[];
  /** Position du passage dans la page (0, 1, 2 ...). */
  ord: number;
  body: string;
}

export interface SplitOptions {
  /** Taille cible d'un passage en caracteres (defaut DEFAULT_MAX_CHARS). */
  maxChars?: number;
}

export const DEFAULT_MAX_CHARS = 4000;

interface Heading {
  level: number;
  title: string;
}

interface Section {
  headingPath: string[];
  lines: string[];
}

type Unit =
  | { kind: "para"; lines: string[] }
  | { kind: "fence"; lines: string[]; fence: string };

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE_RE = /^(`{3,}|~{3,})/;

function closeReFor(fence: string): RegExp {
  return fence[0] === "`" ? /^\s*`{3,}\s*$/ : /^\s*~{3,}\s*$/;
}

function isFenceClose(line: string, fence: string): boolean {
  // Une fermeture au moins aussi longue que l'ouverture, sans info-string.
  return line.trim().length >= fence.length && closeReFor(fence).test(line);
}

function isHeadingOnly(text: string): boolean {
  return HEADING_RE.test(text);
}

// Les sections s'arretent a chaque titre hors fence ; le chemin de sections
// suit une pile de niveaux (sauts de niveau acceptes : H1 puis H4).
function parseSections(source: string): Section[] {
  const sections: Section[] = [];
  const stack: Heading[] = [];
  let current: Section = { headingPath: [], lines: [] };
  let fence: string | null = null;

  const flush = (): void => {
    // Un titre sans corps ne vaut pas un passage : la section est jetee.
    const headingSolo =
      current.lines.length > 0 &&
      current.lines.length <= 2 &&
      current.lines.every((line) => line.trim().length === 0 || HEADING_RE.test(line));
    if (current.lines.length > 0 && !headingSolo) sections.push(current);
    current = { headingPath: stack.map((entry) => entry.title), lines: [] };
  };

  for (const line of source.split(/\r?\n/)) {
    if (fence !== null) {
      current.lines.push(line);
      if (isFenceClose(line, fence)) fence = null;
      continue;
    }
    const opened = FENCE_RE.exec(line);
    if (opened) {
      fence = opened[1];
      current.lines.push(line);
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: heading[2].trim() });
      flush();
      current.lines.push(line);
      continue;
    }
    current.lines.push(line);
  }
  flush();
  return sections;
}

// Les lignes d'une section deviennent des unites : paragraphes separes par
// lignes vides, blocs de code atomiques (du contenu de la fence au closer).
function toUnits(lines: string[]): Unit[] {
  const units: Unit[] = [];
  let buffer: string[] = [];
  let fence: string | null = null;

  const flushPara = (): void => {
    if (buffer.length > 0 && buffer.some((line) => line.trim().length > 0)) {
      units.push({ kind: "para", lines: [...buffer] });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (fence !== null) {
      buffer.push(line);
      if (isFenceClose(line, fence)) {
        units.push({ kind: "fence", lines: [...buffer], fence });
        buffer = [];
        fence = null;
      }
      continue;
    }
    const opened = FENCE_RE.exec(line);
    if (opened) {
      flushPara();
      fence = opened[1];
      buffer = [line];
      continue;
    }
    if (line.trim().length === 0) {
      flushPara();
      continue;
    }
    buffer.push(line);
  }
  if (fence !== null && buffer.length > 0) {
    // Fence jamais refermee en fin de page : on la stocke ouverte, le
    // decoupage la referme lui-meme sur chaque morceau.
    units.push({ kind: "fence", lines: [...buffer], fence });
  } else {
    flushPara();
  }
  return units;
}

// Decoupe des lignes a une taille donnee. Une ligne trop longue est d'abord
// coupee aux espaces (le mot reste entier) ; le couteau aux caracteres ne
// survient que pour un mot unique plus grand que la limite.
function sliceLongLine(line: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  const commit = (): void => {
    if (piece.length > 0) {
      pieces.push(piece);
      piece = "";
    }
  };
  for (const word of line.split(" ")) {
    const candidate = piece.length === 0 ? word : `${piece} ${word}`;
    if (candidate.length <= maxChars) {
      piece = candidate;
      continue;
    }
    commit();
    if (word.length <= maxChars) {
      piece = word;
      continue;
    }
    for (let offset = 0; offset < word.length; offset += maxChars) {
      const slice = word.slice(offset, offset + maxChars);
      if (offset + maxChars >= word.length) piece = slice;
      else pieces.push(slice);
    }
  }
  commit();
  return pieces;
}

function sliceLines(lines: string[], maxChars: number): string[][] {
  const pieces: string[][] = [];
  let current: string[] = [];
  let size = 0;
  const flush = (): void => {
    if (current.length > 0) {
      pieces.push(current);
      current = [];
      size = 0;
    }
  };
  for (const line of lines) {
    if (line.length > maxChars) {
      flush();
      for (const slice of sliceLongLine(line, maxChars)) pieces.push([slice]);
      continue;
    }
    if (current.length > 0 && size + 1 + line.length > maxChars) flush();
    size = current.length === 0 ? line.length : size + 1 + line.length;
    current.push(line);
  }
  flush();
  return pieces;
}

function packUnits(units: Unit[], maxChars: number): string[] {
  const chunks: string[] = [];
  const pushText = (text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length > 0 && !isHeadingOnly(trimmed)) chunks.push(trimmed);
  };

  let acc: string[] = [];
  let accSize = 0;
  const flushAcc = (): void => {
    if (acc.length > 0) pushText(acc.join("\n"));
    acc = [];
    accSize = 0;
  };

  const sizeOf = (lines: string[]): number => lines.join("\n").length;

  for (const unit of units) {
    // Deux caracteres de separation (ligne vide) quand l'accumulateur est plein.
    const cost = sizeOf(unit.lines) + (acc.length > 0 ? 2 : 0);
    if (accSize + cost <= maxChars) {
      if (acc.length > 0) acc.push("");
      acc.push(...unit.lines);
      accSize += cost;
      continue;
    }
    flushAcc();
    if (unit.kind === "para") {
      for (const piece of sliceLines(unit.lines, maxChars)) pushText(piece.join("\n"));
      continue;
    }
    // Fence : chaque morceau reprend l'ouverture et se termine par une
    // fermeture — un passage reste toujours du markdown valide.
    const opener = unit.lines[0];
    const tail = unit.lines.slice(1);
    const hadCloser = tail.length > 0 && isFenceClose(tail[tail.length - 1], unit.fence);
    const body = hadCloser ? tail.slice(0, -1) : tail;
    const overhead = opener.length + unit.fence.length + 2;
    const budget = Math.max(1, maxChars - overhead);
    for (const piece of sliceLines(body, budget)) {
      pushText([opener, ...piece, unit.fence].join("\n"));
    }
  }
  flushAcc();
  return chunks;
}

export function splitMarkdown(source: string, options: SplitOptions = {}): MarkdownChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  if (maxChars < 64) throw new Error("maxChars: 64 caracteres au minimum");
  const chunks: MarkdownChunk[] = [];
  for (const section of parseSections(source)) {
    for (const body of packUnits(toUnits(section.lines), maxChars)) {
      chunks.push({ headingPath: section.headingPath, ord: chunks.length, body });
    }
  }
  return chunks;
}
