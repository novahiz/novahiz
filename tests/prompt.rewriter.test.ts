import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, rewritePrompt } from "../src/prompt-rewriter.ts";

test("detects Arabic and translates the keyword map", () => {
  const result = rewritePrompt("اصلاح مشكلة في قاعدة البيانات");
  assert.equal(result.sourceLanguage, "ar");
  assert.equal(result.rewritten, "fix issue in database");
  assert.equal(result.wasRewritten, true);
});

test("detects French and translates nouns/verbs for classification", () => {
  const result = rewritePrompt("corriger le bug de login dans la page");
  assert.equal(result.sourceLanguage, "fr");
  assert.match(result.rewritten, /\bfix\b/);
  assert.match(result.rewritten, /\bin\b/);
  assert.equal(result.wasRewritten, true);
});

test("detects French with a weight-3 marker alone", () => {
  assert.equal(detectLanguage("refactoriser ce truc"), "fr");
  assert.equal(detectLanguage("expliquer pourquoi ça casse"), "fr");
});

test("detects Spanish without translating (documented limitation)", () => {
  const result = rewritePrompt("hacer un refactor del servidor");
  assert.equal(result.sourceLanguage, "es");
  assert.equal(result.rewritten, "hacer un refactor del servidor");
  assert.equal(result.wasRewritten, false);
});

test("detects German without translating (documented limitation)", () => {
  const result = rewritePrompt("bitte den fehler beheben");
  assert.equal(result.sourceLanguage, "de");
  assert.equal(result.rewritten, "bitte den fehler beheben");
});

test("detects Portuguese without translating (documented limitation)", () => {
  assert.equal(detectLanguage("criar uma pagina de login"), "pt");
});

test("keeps clean English untouched", () => {
  const result = rewritePrompt("fix the login bug on the page");
  assert.equal(result.sourceLanguage, "en");
  assert.equal(result.rewritten, "fix the login bug on the page");
  assert.equal(result.wasRewritten, false);
});

test("strips English politeness prefixes and trailing punctuation", () => {
  const result = rewritePrompt("Please add a unit test for the parser.");
  assert.equal(result.sourceLanguage, "en");
  assert.equal(result.rewritten, "add a unit test for the parser");
  assert.equal(result.wasRewritten, true);
});

test("does not flag optimized English as a foreign language", () => {
  // The enforcement prompt must never say "respond in en, not English".
  assert.equal(detectLanguage("add a unit test for the parser"), "en");
  assert.equal(detectLanguage("refactor the server code for performance"), "en");
});

test("cognates do not push an English prompt into another language", () => {
  assert.equal(detectLanguage("design the interface and review the code"), "en");
  assert.equal(detectLanguage("the responsive page needs a security review"), "en");
});
