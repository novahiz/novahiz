/**
 * Preuve de rendu textuelle (NX-38).
 *
 * Une capture d'écran ne prouve rien qu'un humain puisse vérifier, et un agent
 * qui ne lit pas les images ne peut pas s'en servir. Ce module lit l'HTML
 * réellement rendu et en tire des faits vérifiables : titre, langue, plan de
 * titres, repères, images sans alternative, liens et boutons sans nom,
 * identifiants dupliqués, `tabindex` positifs, styles en ligne.
 *
 * Limite assumée : l'analyse porte sur le HTML, pas sur le rendu calculé. Elle
 * ne voit donc ni les couleurs effectives, ni le débordement, ni les éléments
 * injectés après hydratation. C'est un complément à un test visuel, pas un
 * remplacement — et c'est déjà ce qui manquait : une preuve citable.
 */

export type RenderSeverity = "error" | "warning" | "info";

export type RenderFinding = {
  severity: RenderSeverity;
  code: string;
  message: string;
};

export type RenderReport = {
  title: string;
  lang: string;
  h1: string;
  counts: {
    images: number;
    imagesWithoutAlt: number;
    links: number;
    linksWithoutName: number;
    buttons: number;
    buttonsWithoutName: number;
    inputs: number;
    inputsWithoutLabel: number;
    duplicateIds: number;
    inlineStyles: number;
    landmarks: number;
  };
  findings: RenderFinding[];
};

const MAX_LABEL = 80;

function texteDe(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attributs(balise: string): Record<string, string> {
  const sortie: Record<string, string> = {};
  const motif = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(balise)) !== null) {
    sortie[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, "");
  }
  return sortie;
}

function aUnNom(attrs: Record<string, string>, contenu: string): boolean {
  if ((attrs["aria-label"] ?? "").trim().length > 0) return true;
  if ((attrs["aria-labelledby"] ?? "").trim().length > 0) return true;
  if ((attrs.title ?? "").trim().length > 0) return true;
  if (texteDe(contenu).length > 0) return true;
  // Une image d'un lien porte souvent le nom.
  return /<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(contenu);
}

export function analyzeHtml(html: string): RenderReport {
  const findings: RenderFinding[] = [];
  const add = (severity: RenderSeverity, code: string, message: string): void => {
    findings.push({ severity, code, message });
  };

  const titre = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const title = texteDe(titre);
  if (title.length === 0) add("error", "title-missing", "aucun <title> : l'onglet et le partage n'ont pas de nom");

  const htmlTag = html.match(/<html\b([^>]*)>/i)?.[1] ?? "";
  const lang = attributs(htmlTag).lang ?? "";
  if (lang.length === 0) add("error", "lang-missing", "l'élément <html> n'a pas d'attribut lang");

  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => texteDe(m[1]));
  if (h1s.length === 0) add("warning", "h1-missing", "aucun <h1> : le plan de la page n'a pas de titre");
  if (h1s.length > 1) add("warning", "h1-multiple", `${h1s.length} <h1> : un seul titre de niveau 1 par page`);

  // Plan de titres : un saut de niveau > 1 est signalé.
  const niveaux = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((m) => Number(m[1]));
  let precedent = 0;
  for (const niveau of niveaux) {
    if (precedent > 0 && niveau > precedent + 1) {
      add("warning", "heading-jump", `plan de titres : h${precedent} suivi de h${niveau}`);
      break;
    }
    precedent = niveau;
  }

  const images = [...html.matchAll(/<img\b([^>]*)>/gi)];
  const imagesSansAlt = images.filter((m) => !/\balt\s*=/i.test(m[1]));
  if (imagesSansAlt.length > 0) {
    add("error", "img-alt-missing", `${imagesSansAlt.length} image(s) sans attribut alt (alt="" pour une image décorative)`);
  }

  const liens = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const liensSansNom = liens.filter((m) => !aUnNom(attributs(m[1]), m[2]));
  if (liensSansNom.length > 0) {
    add("error", "link-name-missing", `${liensSansNom.length} lien(s) sans texte ni libellé accessible`);
  }

  const boutons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  const boutonsSansNom = boutons.filter((m) => !aUnNom(attributs(m[1]), m[2]));
  if (boutonsSansNom.length > 0) {
    add("error", "button-name-missing", `${boutonsSansNom.length} bouton(s) sans texte ni libellé accessible`);
  }

  // Un champ n'a pas de nom s'il n'a ni label associé, ni aria-label, ni titre.
  const labels = new Set(
    [...html.matchAll(/<label\b([^>]*)>/gi)].map((m) => attributs(m[1]).for ?? "").filter(Boolean),
  );
  const champs = [...html.matchAll(/<input\b([^>]*)>/gi)].map((m) => attributs(m[1]));
  const champsSansLabel = champs.filter((attrs) => {
    if ((attrs.type ?? "").toLowerCase() === "hidden") return false;
    if ((attrs["aria-label"] ?? "").trim().length > 0) return false;
    if ((attrs["aria-labelledby"] ?? "").trim().length > 0) return false;
    if (attrs.id && labels.has(attrs.id)) return false;
    // Un bouton de soumission porte son nom dans value.
    if (["submit", "button", "reset"].includes((attrs.type ?? "").toLowerCase()) && (attrs.value ?? "").trim()) return false;
    return true;
  });
  if (champsSansLabel.length > 0) {
    add("warning", "input-label-missing", `${champsSansLabel.length} champ(s) sans label associé ni aria-label`);
  }

  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const vus = new Set<string>();
  const doublons = new Set<string>();
  for (const id of ids) {
    if (vus.has(id)) doublons.add(id);
    vus.add(id);
  }
  if (doublons.size > 0) {
    add("error", "id-duplicate", `identifiant(s) dupliqué(s) : ${[...doublons].slice(0, 5).join(", ")}`);
  }

  const tabindexPositifs = [...html.matchAll(/\btabindex\s*=\s*["']?(\d+)/gi)].filter((m) => Number(m[1]) > 0);
  if (tabindexPositifs.length > 0) {
    add("warning", "tabindex-positive", `${tabindexPositifs.length} tabindex > 0 : l'ordre de tabulation doit suivre le DOM`);
  }

  const stylesEnLigne = (html.match(/\bstyle\s*=\s*["']/gi) ?? []).length;
  if (stylesEnLigne > 0) {
    add("info", "inline-styles", `${stylesEnLigne} style(s) en ligne : signal de bricolage visuel`);
  }

  const reperes = ["<header", "<nav", "<main", "<footer"].filter((balise) => html.includes(balise)).length;
  if (reperes < 3) {
    add("warning", "landmarks-thin", `${reperes} repère(s) seulement (header, nav, main, footer) : la page se lit mal au lecteur d'écran`);
  }

  const coupe = (valeur: string): string => (valeur.length > MAX_LABEL ? `${valeur.slice(0, MAX_LABEL)}…` : valeur);

  return {
    title: coupe(title),
    lang,
    h1: coupe(h1s[0] ?? ""),
    counts: {
      images: images.length,
      imagesWithoutAlt: imagesSansAlt.length,
      links: liens.length,
      linksWithoutName: liensSansNom.length,
      buttons: boutons.length,
      buttonsWithoutName: boutonsSansNom.length,
      inputs: champs.length,
      inputsWithoutLabel: champsSansLabel.length,
      duplicateIds: doublons.size,
      inlineStyles: stylesEnLigne,
      landmarks: reperes,
    },
    findings,
  };
}

export function hasBlockingRenderFinding(report: RenderReport): boolean {
  return report.findings.some((finding) => finding.severity === "error");
}
