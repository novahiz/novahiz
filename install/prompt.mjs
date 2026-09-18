import { createInterface } from "node:readline/promises";

export function createPrompt(input = process.stdin, output = process.stdout) {
  const rl = createInterface({ input, output });
  return {
    async confirm(question, defaultValue = true) {
      const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
      const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();
      if (answer.length === 0) return defaultValue;
      return ["y", "yes", "o"].includes(answer);
    },
    close() {
      rl.close();
    }
  };
}
