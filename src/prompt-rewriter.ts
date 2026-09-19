/**
 * Prompt rewriter — translates and optimizes user prompts into English.
 *
 * Why English?
 * - LLMs are trained predominantly on English data
 * - English prompts produce more precise classifications
 * - Technical terms are natively English (refactor, debug, migrate)
 * - Imperative mood is clearer in English
 *
 * The rewritten prompt is used for classification and reasoning.
 * The original language is preserved for response generation.
 */

export type RewriteResult = {
  original: string;
  rewritten: string;
  sourceLanguage: string;
  wasRewritten: boolean;
};

// Language detection patterns (simple heuristics, no external deps)
// Weight design: high-weight patterns are unambiguous language signals.
// Low-weight function words (le, la, el, etc.) are weak — they can false-positive
// on English text. Only high-weight patterns should push detection away from English.
const LANG_PATTERNS: Array<{ lang: string; pattern: RegExp; weight: number }> = [
  // French
  { lang: "fr", pattern: /\b(c'est-a-dire|par exemple|en fait|cependant|neanmoins|toutefois|par consequent|ainsi que)\b/i, weight: 5 },
  { lang: "fr", pattern: /\b(probleme|fonction|classe|methode|variable|fichier|corriger|ajouter|supprimer|modifier|creer|refactoriser|debugger|migrer|configurer|optimiser|simplifier|ameliorer|implementer|renommer)\b/i, weight: 4 },
  { lang: "fr", pattern: /\b(le|la|les|un|une|des|est|sont|avec|pour|dans|ce|cette|pourquoi|quel|quelle|faire|fait|etre|avoir|pas|plus|tout|mais|donc|car|ni|ou|et)\b/i, weight: 1 },
  // Arabic — Unicode range is unambiguous
  { lang: "ar", pattern: /[\u0600-\u06FF]/, weight: 10 },
  // Spanish
  { lang: "es", pattern: /\b(funcion|clase|metodo|variable|archivo|codigo|depurar|corregir|agregar|eliminar|modificar|crear)\b/i, weight: 4 },
  { lang: "es", pattern: /\b(el|la|los|las|un|una|es|son|con|para|en|este|esta|como|hacer|ser|tener|pero|porque|sino|o|y)\b/i, weight: 1 },
  // German
  { lang: "de", pattern: /\b(Funktion|Klasse|Methode|Variable|Datei|Code|korrigieren|hinzufuegen|entfernen|aendern|erstellen)\b/i, weight: 4 },
  { lang: "de", pattern: /\b(der|die|das|ein|eine|ist|sind|mit|fur|in|wie|warum|machen|sein|haben|aber|denn|nicht|auch)\b/i, weight: 1 },
  // Portuguese
  { lang: "pt", pattern: /\b(funcao|classe|metodo|variavel|arquivo|codigo|corrigir|adicionar|remover|modificar|criar)\b/i, weight: 4 },
  { lang: "pt", pattern: /\b(o|a|os|as|um|uma|e|sao|com|para|em|este|esta|como|fazer|ser|ter|mas|porque|ou)\b/i, weight: 1 },
];

/**
 * Detect the source language of a prompt.
 * Arabic uses Unicode range (unambiguous, weight 10).
 * Other languages require at least one high-weight match (>=2) to avoid
 * false positives from common words like "a", "the", "in" that overlap English.
 */
export function detectLanguage(prompt: string): string {
  // Arabic first — Unicode range is unambiguous
  if (/[\u0600-\u06FF]/.test(prompt)) return "ar";

  const scores: Record<string, number> = {};
  const hasHighWeight: Record<string, boolean> = {};
  for (const { lang, pattern, weight } of LANG_PATTERNS) {
    if (lang === "ar") continue; // already handled
    if (pattern.test(prompt)) {
      scores[lang] = (scores[lang] ?? 0) + weight;
      if (weight >= 2) hasHighWeight[lang] = true;
    }
  }
  let bestLang = "en";
  let bestScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    // Require at least one high-weight match to override English
    if (score > bestScore && hasHighWeight[lang]) {
      bestScore = score;
      bestLang = lang;
    }
  }
  return bestLang;
}

// French -> English task term mappings
// Technical terms first (high confidence), then structural words
const FR_EN: Array<[RegExp, string]> = [
  // Technical verbs
  [/\bcorriger\s+le\b/gi, "fix the"],
  [/\bcorriger\s+la\b/gi, "fix the"],
  [/\bcorriger\b/gi, "fix"],
  [/\bcreer\b/gi, "create"],
  [/\bajouter\b/gi, "add"],
  [/\bsupprimer\b/gi, "remove"],
  [/\bmodifier\b/gi, "modify"],
  [/\brenommer\b/gi, "rename"],
  [/\brefactoriser\b/gi, "refactor"],
  [/\bdebugger\b/gi, "debug"],
  [/\btester\b/gi, "test"],
  [/\bmigrer\b/gi, "migrate"],
  [/\bconfigurer\b/gi, "configure"],
  [/\boptimiser\b/gi, "optimize"],
  [/\bsimplifier\b/gi, "simplify"],
  [/\bnettoyer\b/gi, "clean up"],
  [/\bameliorer\b/gi, "improve"],
  [/\bimplementer\b/gi, "implement"],
  [/\butiliser\b/gi, "use"],
  [/\bremplacer\b/gi, "replace"],
  [/\becrire\b/gi, "write"],
  [/\blire\b/gi, "read"],
  [/\bsauvegarder\b/gi, "save"],
  [/\bactiver\b/gi, "enable"],
  [/\bdesactiver\b/gi, "disable"],
  // Nouns
  [/\bfonction\b/gi, "function"],
  [/\bclasse\b/gi, "class"],
  [/\bmethode\b/gi, "method"],
  [/\bvariable\b/gi, "variable"],
  [/\bfichier\b/gi, "file"],
  [/\bprobleme\b/gi, "issue"],
  [/\bsolution\b/gi, "solution"],
  [/\bpage de landing\b/gi, "landing page"],
  [/\bpage d'atterrissage\b/gi, "landing page"],
  [/\bpage de garde\b/gi, "landing page"],
  // Structural words (translate only in French context)
  [/\bdans le\b/gi, "in the"],
  [/\bdans la\b/gi, "in the"],
  [/\bdans les\b/gi, "in the"],
  [/\bdans un\b/gi, "in a"],
  [/\bdans une\b/gi, "in a"],
  [/\bune page de\b/gi, "a page of"],
  [/\bune\b/gi, "a"],
  [/\bun\b/gi, "a"],
  [/\bcomment\b/gi, "how to"],
  [/\bpourquoi\b/gi, "why"],
  [/\bquel\b/gi, "which"],
  [/\bquelle\b/gi, "which"],
  [/\bfaire\b/gi, "do"],
  [/\bde toute facon\b/gi, "anyway"],
  [/\bcependant\b/gi, "however"],
  [/\bneanmoins\b/gi, "nevertheless"],
  [/\bvoici\b/gi, "here is"],
  [/\bvoila\b/gi, "here is"],
];

// Arabic -> English task term mappings
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
  [/ال/g, "the "],
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

/**
 * Apply term translations to a prompt.
 */
function translateTerms(prompt: string, lang: string): string {
  let result = prompt;
  const mappings = lang === "fr" ? FR_EN : lang === "ar" ? AR_EN : [];
  for (const [pattern, replacement] of mappings) {
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
 */
export function rewritePrompt(prompt: string): RewriteResult {
  const sourceLanguage = detectLanguage(prompt);

  // If already English, just optimize
  if (sourceLanguage === "en") {
    const rewritten = optimizeEnglish(prompt);
    return {
      original: prompt,
      rewritten,
      sourceLanguage,
      wasRewritten: rewritten !== prompt,
    };
  }

  // Translate terms then optimize
  const withTranslatedTerms = translateTerms(prompt, sourceLanguage);
  const rewritten = optimizeEnglish(withTranslatedTerms);

  return {
    original: prompt,
    rewritten,
    sourceLanguage,
    wasRewritten: true,
  };
}
