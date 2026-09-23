---
name: prompt-rewriter
description: |
  prompt-rewriter translates non-English prompts into optimized English before classification.
  The agent always responds in the user's original language. No external dependencies.
  Built into the plugin adapter.
license: Apache-2.0
compatibility: |
  Implemented in src/prompt-rewriter.ts and inlined in adapters/opencode/novahiz.ts;
  no external dependencies.
metadata:
  author: Novahiz
  organization: Novahiz
  version: "2.0.0"
---

# prompt-rewriter

## What it does

Every user message is intercepted before classification and rewritten into optimized English:

1. Detect the source language (FR, AR, ES, DE, PT, or EN).
2. Translate task terms into English equivalents.
3. Tighten the English prompt into imperative mood and drop filler.
4. Classify the English version for tier and skill assignment.
5. Respond in the user's original language.

## Why English for classification

Models see mostly English during training, technical vocabulary already lives in English (refactor, debug, migrate), and imperative English classifies more precisely than a polite request in any language.

## How it works

The rewriter sits in `src/prompt-rewriter.ts` and is wired into the plugin adapter at `adapters/opencode/novahiz.ts`.

### Language detection

Heuristic scoring: each language has weighted patterns of common words, technical terms, and multi-word phrases. The highest score wins. No external dependency is involved.

### Term translation

French and Arabic have dedicated term maps of forty and thirty patterns. Examples:

| FR term | EN equivalent |
|---------|---------------|
| corriger | fix |
| creer | create |
| ajouter | add |
| refactoriser | refactor |
| migrer | migrate |
| optimiser | optimize |

### English optimization

Politeness markers are stripped and the prompt becomes imperative:

- "I want to implement X" becomes "implement X".
- "Can you fix the bug?" becomes "fix the bug".
- "Please add a comment" becomes "add a comment".

## Integration

The plugin adapter calls `rewritePrompt(text)` before `classify`. When a rewrite happens:

1. The enforcement block carries `User language: XX, respond in this language`.
2. A log entry records the rewrite.
3. Classification runs on the English version.

## Response language

The agent MUST respond in the user's original language. The enforcement block includes:

```
User language: fr, respond in this language, not English.
```

That line overrides any default to English.

## Adding a language

1. Add detection patterns to `LANG_PATTERNS` in `src/prompt-rewriter.ts`.
2. Create a `XX_EN` term mapping array.
3. Handle the new language in `translateTerms()`.
4. Test with sample prompts in that language.
