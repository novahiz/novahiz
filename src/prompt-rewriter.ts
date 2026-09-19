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
 *
 * Scope: Arabic only. FR/ES/DE/PT are handled natively by the classifier
 * via multilingual keywords in categories.json — no rewriting needed.
 * English prompts are optimized (remove fluff, imperative mood).
 */

export type RewriteResult = {
  original: string;
  rewritten: string;
  sourceLanguage: string;
  wasRewritten: boolean;
};

/**
 * Detect the source language of a prompt.
 * Returns "ar" for Arabic (Unicode range, unambiguous), "en" otherwise.
 * FR/ES/DE/PT are not detected here — the classifier handles them natively.
 */
export function detectLanguage(prompt: string): string {
  if (/[\u0600-\u06FF]/.test(prompt)) return "ar";
  return "en";
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

/**
 * Apply term translations to a prompt. Arabic only.
 */
function translateTerms(prompt: string, lang: string): string {
  if (lang !== "ar") return prompt;
  let result = prompt;
  for (const [pattern, replacement] of AR_EN) {
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
