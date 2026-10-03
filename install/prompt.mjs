import { createInterface } from "node:readline/promises";

export function createPrompt(input = process.stdin, output = process.stdout) {
  const rl = createInterface({ input, output });
  return {
    async confirm(question, defaultValue = true) {
      const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
      const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
      if (answer.length === 0) return defaultValue;
      return ["y", "yes", "o", "oui"].includes(answer);
    },
    // Multi-select over a fixed list of choices. Numbers toggle ("1 3"),
    // "a" selects everything, Enter keeps the checked defaults. Always
    // returns at least one choice so a run can never end up harness-less.
    async select(question, choices, defaults = []) {
      const selected = new Set(defaults.filter((value) => choices.includes(value)));
      let text = `\n${question}\n`;
      for (let index = 0; index < choices.length; index += 1) {
        const marker = selected.has(choices[index]) ? "x" : " ";
        text += `  [${marker}] ${index + 1}) ${choices[index]}\n`;
      }
      text += "Numbers (e.g. 1 3), 'a' for all, Enter to accept the checked ones:";
      const answer = (await rl.question(`${text} `)).trim().toLowerCase();
      if (answer.length > 0) {
        selected.clear();
        if (answer === "a" || answer === "all") {
          for (const choice of choices) selected.add(choice);
        } else {
          for (const token of answer.split(/[\s,;]+/)) {
            const index = Number.parseInt(token, 10);
            if (Number.isInteger(index) && index >= 1 && index <= choices.length) {
              selected.add(choices[index - 1]);
            }
          }
        }
      }
      const result = choices.filter((choice) => selected.has(choice));
      if (result.length > 0) return result;
      if (defaults.length > 0) return defaults;
      return choices.length > 0 ? [choices[0]] : [];
    },
    close() {
      rl.close();
    }
  };
}
