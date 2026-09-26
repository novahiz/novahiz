/**
 * Prompt rewriter — translates and optimizes user prompts into English
 * before classification.
 *
 * Why English?
 * - LLMs are trained predominantly on English data
 * - English prompts produce more precise classifications
 * - Technical terms are natively English (refactor, debug, migrate)
 * - Imperative mood is clearer in English
 *
 * The rewritten prompt is used for classification and reasoning.
 * The original language is preserved for response generation
 * (sourceLanguage is enforced in the adapter's system instruction).
 *
 * Coverage:
 * - Arabic: Unicode-range detection, translated via the AR_EN term map.
 * - French: weighted marker detection (LANG_PATTERNS), translated via the
 *   FR_EN term map.
 * - Spanish, German, Portuguese: weighted marker detection only, so the
 *   adapter can enforce the user's language. No term map yet — the
 *   classifier still receives the native text for these three (known
 *   limitation, documented in skills/prompt-rewriter/SKILL.md).
 * - English: optimized only (imperative mood, fluff removed).
 */

export type RewriteResult = {
  original: string;
  rewritten: string;
  sourceLanguage: string;
  wasRewritten: boolean;
};

/** Lowercase + strip combining marks (NFD), so accented input matches
 *  ASCII patterns: "créer" -> "creer", "não" -> "nao". Used for detection. */
function fold(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Word-boundary regex: the match must not touch a letter or digit on
 *  either side. Unicode-aware, so "la" does not match inside "login" or
 *  inside Arabic/CJK text. */
function rx(words: string, flags: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, flags);
}

/** Marker pattern for detection: runs on folded (lowercase) text. */
function marker(words: string): RegExp {
  return rx(words, "iu");
}

/** Translation pattern: runs on the original text, case-insensitive. */
function word(words: string): RegExp {
  return rx(words, "giu");
}

/** Detection threshold: a language must accumulate at least this weight
 *  in matching markers before it is considered the source language. */
const DETECT_MIN_SCORE = 3;

/** Fixed order used only as a tie-break between equal candidates. */
const LANG_ORDER = ["fr", "es", "de", "pt"];

/**
 * Weighted detection markers per language (folded spelling: no accents,
 * lowercase). Weight 3 = unmistakably that language, 2 = distinctive,
 * 1 = common function word. English cognates (test, code, page, design,
 * interface, responsive, security, function, class...) are deliberately
 * excluded so English prompts never score here.
 */
const LANG_PATTERNS: Record<string, Array<[RegExp, number]>> = {
  fr: [
    [marker("corriger|corrige"), 3],
    [marker("ajouter|ajoute|ajoutez"), 3],
    [marker("supprimer|supprime|supprimez"), 3],
    [marker("creer|creez|creation"), 3],
    [marker("developper|developpe"), 3],
    [marker("implementer|implemente"), 3],
    [marker("refactoriser|refactorise"), 3],
    [marker("configurer"), 3],
    [marker("installer"), 3],
    [marker("ameliorer|amelioration"), 3],
    [marker("optimiser"), 3],
    [marker("verifier|verifie"), 3],
    [marker("expliquer|explique"), 3],
    [marker("pourquoi"), 3],
    [marker("comment faire"), 3],
    [marker("dans"), 2],
    [marker("avec"), 2],
    [marker("pour"), 2],
    [marker("vous"), 2],
    [marker("nous"), 2],
    [marker("votre|notre"), 2],
    [marker("fonction|fonctions"), 2],
    [marker("classe|classes"), 2],
    [marker("fichier|fichiers"), 2],
    [marker("probleme|problemes"), 2],
    [marker("erreur|erreurs"), 2],
    [marker("serveur"), 2],
    [marker("donnees"), 2],
    [marker("utilisateur|utilisateurs"), 2],
    [marker("ecran"), 2],
    [marker("bouton"), 2],
    [marker("formulaire"), 2],
    [marker("securite"), 2],
    [marker("reseau"), 2],
    [marker("requete"), 2],
    [marker("besoin"), 2],
    [marker("faites|fait"), 2],
    [marker("le"), 1],
    [marker("la"), 1],
    [marker("les"), 1],
    [marker("des"), 1],
    [marker("du"), 1],
    [marker("de"), 1],
    [marker("un"), 1],
    [marker("une"), 1],
    [marker("est"), 1],
    [marker("ne"), 1],
    [marker("pas"), 1],
  ],
  es: [
    [marker("hacer"), 3],
    [marker("crear|cree"), 3],
    [marker("anadir"), 3],
    [marker("borrar"), 3],
    [marker("arreglar"), 3],
    [marker("corregir"), 3],
    [marker("explicar"), 3],
    [marker("necesito"), 3],
    [marker("quiero"), 3],
    [marker("tengo"), 3],
    [marker("base de datos"), 3],
    [marker("inicio de sesion"), 3],
    [marker("para"), 2],
    [marker("con"), 2],
    [marker("pero"), 2],
    [marker("muy"), 2],
    [marker("tambien"), 2],
    [marker("pagina|paginas"), 2],
    [marker("servidor"), 2],
    [marker("usuario|usuarios"), 2],
    [marker("archivo|archivos"), 2],
    [marker("codigo"), 2],
    [marker("pantalla"), 2],
    [marker("mensaje"), 2],
    [marker("conexion"), 2],
    [marker("datos"), 2],
    [marker("diseno"), 2],
    [marker("aplicacion"), 2],
    [marker("de"), 1],
    [marker("la"), 1],
    [marker("el"), 1],
    [marker("los"), 1],
    [marker("las"), 1],
    [marker("un"), 1],
    [marker("una"), 1],
    [marker("es"), 1],
    [marker("en"), 1],
    [marker("por"), 1],
    [marker("que"), 1],
    [marker("se"), 1],
    [marker("al"), 1],
    [marker("lo"), 1],
  ],
  de: [
    [marker("bitte"), 3],
    [marker("machen"), 3],
    [marker("erstellen|erstelle"), 3],
    [marker("hinzufugen"), 3],
    [marker("loschen"), 3],
    [marker("beheben|behebt"), 3],
    [marker("debuggen"), 3],
    [marker("testen"), 3],
    [marker("erklaren|erklare"), 3],
    [marker("warum"), 3],
    [marker("nicht"), 3],
    [marker("muss"), 3],
    [marker("soll"), 3],
    [marker("funktion|funktionen"), 2],
    [marker("klasse"), 2],
    [marker("datei|dateien"), 2],
    [marker("fehler"), 2],
    [marker("seite|seiten"), 2],
    [marker("datenbank"), 2],
    [marker("anwendung|anwendungen"), 2],
    [marker("benutzer"), 2],
    [marker("anmelden"), 2],
    [marker("einloggen"), 2],
    [marker("variablen"), 2],
    [marker("speichern"), 2],
    [marker("anzeigen"), 2],
    [marker("verbessern"), 2],
    [marker("optimieren"), 2],
    [marker("implementieren"), 2],
    [marker("schreiben"), 2],
    [marker("suchen"), 2],
    [marker("starten"), 2],
    [marker("der"), 1],
    [marker("die"), 1],
    [marker("das"), 1],
    [marker("den"), 1],
    [marker("dem"), 1],
    [marker("ein"), 1],
    [marker("eine"), 1],
    [marker("ist"), 1],
    [marker("mit"), 1],
    [marker("fur"), 1],
    [marker("und"), 1],
    [marker("auf"), 1],
    [marker("zu"), 1],
  ],
  pt: [
    [marker("criar|crie"), 3],
    [marker("fazer"), 3],
    [marker("adicionar"), 3],
    [marker("corrigir"), 3],
    [marker("preciso"), 3],
    [marker("quero"), 3],
    [marker("banco de dados"), 3],
    [marker("pagina|paginas"), 2],
    [marker("usuario|usuarios"), 2],
    [marker("arquivo|arquivos"), 2],
    [marker("codigo"), 2],
    [marker("mensagem"), 2],
    [marker("tela"), 2],
    [marker("configurar"), 2],
    [marker("instalar"), 2],
    [marker("melhorar"), 2],
    [marker("conectar"), 2],
    [marker("senha"), 2],
    [marker("rede"), 2],
    [marker("funcao"), 2],
    [marker("nao"), 2],
    [marker("tambem"), 2],
    [marker("uma"), 1],
    [marker("um"), 1],
    [marker("para"), 1],
    [marker("com"), 1],
    [marker("que"), 1],
    [marker("na"), 1],
    [marker("os"), 1],
    [marker("as"), 1],
    [marker("ao"), 1],
    [marker("mais"), 1],
  ],
};

/**
 * Detect the source language of a prompt.
 * "ar" for Arabic (Unicode range, unambiguous), "fr"/"es"/"de"/"pt" by
 * weighted marker scoring on folded text, "en" otherwise.
 * On a candidate tie, a language holding a weight-3 marker wins, then the
 * higher total weight, then the LANG_ORDER fixed order.
 */
export function detectLanguage(prompt: string): string {
  if (/[\u0600-\u06FF]/.test(prompt)) return "ar";
  const folded = fold(prompt);
  let bestLang = "en";
  let bestScore = 0;
  let bestStrong = false;
  for (const lang of LANG_ORDER) {
    let score = 0;
    let strong = false;
    for (const [pattern, weight] of LANG_PATTERNS[lang]) {
      if (pattern.test(folded)) {
        score += weight;
        if (weight >= 3) strong = true;
      }
    }
    if (score < DETECT_MIN_SCORE) continue;
    const wins =
      bestScore === 0 ? true : strong !== bestStrong ? strong : score > bestScore;
    if (wins) {
      bestLang = lang;
      bestScore = score;
      bestStrong = strong;
    }
  }
  return bestLang;
}

// Arabic -> English task term mappings
// Arabic is the only language that benefits from rewriting:
// - Unicode-range detection is unambiguous
// - The classifier cannot match Arabic keywords natively
// NOTE: Arabic has multiple valid spellings. Use common forms users actually type.
const AR_EN: Array<[RegExp, string]> = [
  // Technical verbs (noun + imperative forms)
  [/اصلاح|اصلح/g, "fix"],
  [/انشاء|اصنع/g, "create"],
  [/اضافة|اضف/g, "add"],
  [/حذف|احذف/g, "remove"],
  [/تعديل|عدّل/g, "modify"],
  [/هاكود|اكتشف/g, "debug"],
  [/اختبار|اختبر/g, "test"],
  [/ترحيل|هجر/g, "migrate"],
  [/اضبط|ضبط/g, "configure"],
  [/تحسين|حسّن/g, "optimize"],
  [/تبسيط|بسّط/g, "simplify"],
  [/تنظيف|نظّف/g, "clean up"],
  [/تنفيذ|طبّق/g, "implement"],
  [/استخدام|استخدم/g, "use"],
  [/استبدال|بدّل/g, "replace"],
  [/كتابة|اكتب/g, "write"],
  [/قراءة|اقرأ/g, "read"],
  [/حفظ|احفظ/g, "save"],
  [/عرض|اعرض/g, "display"],
  [/اخفاء|اخفي/g, "hide"],
  [/تفعيل|فعّل/g, "enable"],
  [/تعطيل|عطّل/g, "disable"],
  // Nouns
  [/دالة/g, "function"],
  [/فئة/g, "class"],
  [/طريقة/g, "method"],
  [/متغير/g, "variable"],
  [/ملف/g, "file"],
  [/شفرة/g, "code"],
  [/مشكلة/g, "issue"],
  [/حل/g, "solution"],
  // Structural words
  [/كيف/g, "how to"],
  [/لماذا/g, "why"],
  [/أي/g, "which"],
  [/افعل/g, "do"],
  [/في/g, "in"],
  [/من/g, "from"],
  [/على/g, "on"],
  // UI/Design words
  [/صفحة/g, "page"],
  [/هبوط/g, "landing"],
  [/متجاوبة/g, "responsive"],
  [/تصميم/g, "design"],
  [/واجهة/g, "interface"],
  [/زر/g, "button"],
  [/قائمة/g, "menu"],
  [/شريط/g, "bar"],
  [/نافذة/g, "window"],
  [/شكل/g, "form"],
  // Domain terms
  [/الخادم|السيرفر/g, "server"],
  [/قاعدة البيانات/g, "database"],
  [/صفحة الهبوط/g, "landing page"],
  [/المصادقة/g, "auth"],
  [/تسجيل الدخول/g, "login"],
  [/خطأ/g, "bug"],
  [/اداء/g, "performance"],
  [/امان/g, "security"],
];

// French -> English task term mappings.
// Multi-word phrases first so single-word rules cannot break them.
// Accented and unaccented spellings are both listed: users type both.
const FR_EN: Array<[RegExp, string]> = [
  [word("base de donnees|base de données"), "database"],
  [word("page d'accueil|page daccueil|page d accueil"), "homepage"],
  [word("mot de passe"), "password"],
  [word("site web"), "website"],
  [word("mise a jour|mise à jour"), "update"],
  [word("tableau de bord"), "dashboard"],
  [word("code source"), "source code"],
  [word("en temps reel|en temps réel"), "realtime"],
  [word("formulaire de contact"), "contact form"],
  [word("point d'entree|point d entree|point d'entrée"), "entry point"],
  [word("se deconnecter|se déconnecter"), "logout"],
  [word("se connecter"), "login"],
  // Verbs
  [word("corriger|corrige"), "fix"],
  [word("ajouter|ajoute|ajoutez"), "add"],
  [word("supprimer|supprime|supprimez|effacer|enlever"), "remove"],
  [word("creer|créer|creez|créez"), "create"],
  [word("developper|développer"), "develop"],
  [word("implementer|implémenter"), "implement"],
  [word("refactoriser|refactorer"), "refactor"],
  [word("configurer"), "configure"],
  [word("installer"), "install"],
  [word("migrer"), "migrate"],
  [word("ameliorer|améliorer"), "improve"],
  [word("amelioration|amélioration"), "improvement"],
  [word("optimiser"), "optimize"],
  [word("verifier|vérifier|verifie"), "verify"],
  [word("expliquer|explique"), "explain"],
  [word("afficher|affiche|montrer|montre"), "display"],
  [word("masquer|cacher"), "hide"],
  [word("activer"), "enable"],
  [word("desactiver|désactiver"), "disable"],
  [word("ecrire|écrire"), "write"],
  [word("sauvegarder|enregistrer"), "save"],
  [word("utiliser|utilise"), "use"],
  [word("remplacer"), "replace"],
  [word("simplifier"), "simplify"],
  [word("nettoyer"), "clean up"],
  [word("tester|teste|testez"), "test"],
  [word("deboguer|déboguer"), "debug"],
  [word("compiler"), "compile"],
  [word("deployer|déployer"), "deploy"],
  [word("rechercher|chercher"), "search"],
  [word("telecharger|télécharger"), "download"],
  [word("envoyer"), "send"],
  [word("ouvrir"), "open"],
  [word("fermer"), "close"],
  // Nouns
  [word("fonction|fonctions"), "function"],
  [word("classe|classes"), "class"],
  [word("methode|méthode"), "method"],
  [word("fichier|fichiers"), "file"],
  [word("probleme|problème|problemes"), "issue"],
  [word("erreur|erreurs"), "error"],
  [word("serveur|serveurs"), "server"],
  [word("donnees|données"), "data"],
  [word("ecran|écran"), "screen"],
  [word("bouton|boutons"), "button"],
  [word("formulaire|formulaires"), "form"],
  [word("champ|champs"), "field"],
  [word("lien|liens"), "link"],
  [word("modele|modèle"), "model"],
  [word("schema|schéma"), "schema"],
  [word("reseau|réseau"), "network"],
  [word("securite|sécurité"), "security"],
  [word("utilisateur|utilisateurs"), "user"],
  [word("requete|requête"), "request"],
  [word("reponse|réponse"), "response"],
  [word("performances"), "performance"],
  [word("tableau"), "table"],
  [word("liste"), "list"],
  [word("boucle"), "loop"],
  [word("authentification"), "auth"],
  [word("inscription"), "register"],
  [word("connexion"), "login"],
  // Structural words
  [word("dans"), "in"],
  [word("avec"), "with"],
  [word("pour"), "for"],
  [word("sur"), "on"],
  [word("sans"), "without"],
  [word("aussi"), "also"],
  [word("mais"), "but"],
  [word("pas"), "not"],
  [word("plus"), "more"],
  [word("tres|très"), "very"],
  [word("comment"), "how to"],
  [word("pourquoi"), "why"],
  [word("besoin"), "need"],
];

/**
 * Apply term translations to a prompt. Arabic and French have term maps;
 * ES/DE/PT are detected but not translated (known limitation).
 */
function translateTerms(prompt: string, lang: string): string {
  const map = lang === "ar" ? AR_EN : lang === "fr" ? FR_EN : null;
  if (!map) return prompt;
  let result = prompt;
  for (const [pattern, replacement] of map) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Optimize an English prompt: imperative mood, precise terms, remove fluff.
 */
function optimizeEnglish(prompt: string): string {
  let result = prompt.trim();

  // Convert "I want to X" -> "X"
  result = result.replace(/^I\s+want\s+to\s+/i, "");
  // Convert "I need to X" -> "X"
  result = result.replace(/^I\s+need\s+to\s+/i, "");
  // Convert "Can you X" -> "X"
  result = result.replace(/^Can\s+you\s+/i, "");
  // Convert "Could you X" -> "X"
  result = result.replace(/^Could\s+you\s+/i, "");
  // Convert "Please X" -> "X"
  result = result.replace(/^Please\s+/i, "");
  // Convert "I would like to X" -> "X"
  result = result.replace(/^I\s+would\s+like\s+to\s+/i, "");
  // Convert "It would be great if you could X" -> "X"
  result = result.replace(/^It\s+would\s+be\s+great\s+if\s+you\s+could\s+/i, "");

  // Remove trailing punctuation for cleaner classification
  result = result.replace(/[.!?]+$/, "");

  return result.trim();
}

/**
 * Rewrite a prompt into optimized English.
 * Returns the rewritten prompt and the detected source language.
 * wasRewritten is true only when the text actually changed.
 */
export function rewritePrompt(prompt: string): RewriteResult {
  const sourceLanguage = detectLanguage(prompt);

  const withTranslatedTerms = translateTerms(prompt, sourceLanguage);
  const rewritten = optimizeEnglish(withTranslatedTerms);

  return {
    original: prompt,
    rewritten,
    sourceLanguage,
    wasRewritten: rewritten !== prompt,
  };
}
