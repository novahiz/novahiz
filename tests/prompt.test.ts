import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { createPrompt } from "../install/prompt.mjs";

function withAnswer(text) {
  const input = new PassThrough();
  const output = new PassThrough();
  const prompt = createPrompt(input, output);
  return { prompt, input };
}

test("confirm keeps the default on an empty answer", async () => {
  const { prompt, input } = withAnswer("");
  const pending = prompt.confirm("Q?", true);
  input.write("\n");
  assert.equal(await pending, true);
  prompt.close();
});

test("confirm reads an explicit yes", async () => {
  const { prompt, input } = withAnswer("");
  const pending = prompt.confirm("Q?", false);
  input.write("y\n");
  assert.equal(await pending, true);
  prompt.close();
});

test("confirm reads an explicit no", async () => {
  const { prompt, input } = withAnswer("");
  const pending = prompt.confirm("Q?", true);
  input.write("n\n");
  assert.equal(await pending, false);
  prompt.close();
});

test("confirm accepts french oui", async () => {
  const { prompt, input } = withAnswer("");
  const pending = prompt.confirm("Q?", false);
  input.write("oui\n");
  assert.equal(await pending, true);
  prompt.close();
});
