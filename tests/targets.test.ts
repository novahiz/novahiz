import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTargetPaths } from "../src/targets.ts";

test("extracts filePath from edit and write args", () => {
  assert.deepEqual(extractTargetPaths("edit", { filePath: "src/a.ts", oldString: "x" }), ["src/a.ts"]);
  assert.deepEqual(extractTargetPaths("write", { filePath: "src/b.ts", content: "x" }), ["src/b.ts"]);
});

test("extracts paths from a patch payload", () => {
  const patchText = [
    "*** Begin Patch",
    "*** Update File: src/one.ts",
    "@@",
    "-a",
    "+b",
    "*** Add File: src/two.ts",
    "+new",
    "*** Delete File: src/three.ts",
    "*** End Patch"
  ].join("\n");
  assert.deepEqual(extractTargetPaths("patch", { patchText }), ["src/one.ts", "src/two.ts", "src/three.ts"]);
});

test("returns no paths for unrelated args", () => {
  assert.deepEqual(extractTargetPaths("edit", { oldString: "x" }), []);
  assert.deepEqual(extractTargetPaths("edit", null), []);
});
