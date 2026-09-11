import { test } from "node:test";
import assert from "node:assert/strict";
import { changeText, hasProse, hasStyle, isTrivial } from "../src/content.ts";

test("detects prose in comments and strings", () => {
  assert.equal(hasProse("// Ce commentaire explique le calcul du total pour le client"), true);
  assert.equal(hasProse('const message = "Votre commande a bien ete enregistree";'), true);
  assert.equal(hasProse("const n = compute(a, b);"), false);
});

test("detects style in css and jsx", () => {
  assert.equal(hasStyle(".card { color: red; }"), true);
  assert.equal(hasStyle("className={styles.card}"), true);
  assert.equal(hasStyle("const n = compute(a, b);"), false);
});

test("extracts change text from several tool payloads", () => {
  assert.equal(changeText("edit", { newString: "abc" }), "abc");
  assert.equal(changeText("write", { content: "body" }), "body");
  assert.equal(changeText("patch", { patchText: "+line" }), "+line");
  assert.equal(changeText("bash", { command: "echo hi" }), "echo hi");
  assert.equal(changeText("edit", { oldString: "old" }), "");
});

test("treats whitespace-only changes as trivial", () => {
  assert.equal(isTrivial("   \n  "), true);
  assert.equal(isTrivial("const x = 1;"), false);
  assert.equal(isTrivial("abc", 10), true);
});

test("reads new_string inside MultiEdit edits", () => {
  assert.equal(changeText("edit", { edits: [{ new_string: "prose here" }] }), "prose here");
  assert.equal(changeText("edit", { edits: [{ newString: "camel" }] }), "camel");
});

test("does not treat a type annotation as style", () => {
  assert.equal(hasStyle("const x: number;"), false);
  assert.equal(hasStyle("interface P { name: string; }"), false);
  assert.equal(hasStyle(".card { color: red; }"), true);
});

test("detects class selectors but not object literals", () => {
  assert.equal(hasStyle(".card { color: red; }"), true);
  assert.equal(hasStyle("key: value,"), false);
  assert.equal(hasStyle("const flex = 1;"), false);
});
