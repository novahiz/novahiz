---
name: prompt-rewriter
description: >
  Automatic prompt rewriting that translates non-English prompts into optimized
  English before classification. The agent always responds in the user's original
  language. No external dependencies. Built into the plugin adapter.
---

# Prompt Rewriter

## What it does

Intercepts every user message before classification and rewrites it into optimized English:

1. **Detects** the source language (FR, AR, ES, DE, PT, or EN)
2. **Translates** task-specific terms into English equivalents
3. **Optimizes** the English prompt (imperative mood, remove fluff)
4. **Classifies** the English prompt for accurate tier/skill assignment
5. **Responds** in the user's original language

## Why English for classification

- LLMs are trained predominantly on English data
- Technical terms are natively English (refactor, debug, migrate)
- English prompts produce more precise classifications
- Imperative mood is clearer in English

## How it works

The rewriter is in `src/prompt-rewriter.ts` and is integrated into the plugin adapter at `adapters/opencode/skillenforce.ts`.

### Language detection

Simple heuristic scoring: each language has weighted patterns (common words, technical terms, multi-word phrases). The language with the highest score wins. No external dependencies.

### Term translation

French and Arabic have dedicated term mappings (40+ and 30+ patterns respectively). Example:

| FR term | EN equivalent |
|---------|---------------|
| corriger | fix |
| creer | create |
| ajouter | add |
| refactoriser | refactor |
| migrer | migrate |
| optimiser | optimize |

### English optimization

Strips politeness markers and converts to imperative mood:

- "I want to implement X" → "implement X"
- "Can you fix the bug?" → "fix the bug"
- "Please add a comment" → "add a comment"

## Integration

The plugin adapter calls `rewritePrompt(text)` before `classify`. When a rewrite occurs:

1. The enforcement block includes `User language: XX — respond in this language`
2. A log entry records the rewrite
3. The classification uses the English version

## Response language

The agent MUST respond in the user's original language. The enforcement block includes:

```
User language: fr — respond in this language, not English.
```

This overrides any default English response behavior.

## Adding a new language

1. Add detection patterns to `LANG_PATTERNS` in `src/prompt-rewriter.ts`
2. Create a `XX_EN` term mapping array
3. Update `translateTerms()` to handle the new language
4. Test with sample prompts in that language
