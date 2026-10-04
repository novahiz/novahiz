import { Tool } from "./tool.mjs";

export class ListRulesTool extends Tool {
  constructor(ruleEngine) {
    super();
    this.ruleEngine = ruleEngine;
  }

  getName() {
    return "list_rules";
  }

  getTitle() {
    return "List analysis rules";
  }

  getDescription() {
    return "List the registered security and code analysis rules, optionally filtered by category (security|quality) or language.";
  }

  getInputSchema() {
    return {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["security", "quality", "all"],
          description: "Optional rule category filter."
        },
        language: {
          type: "string",
          description: "Optional language filter, e.g. python."
        }
      }
    };
  }

  getOutputSchema() {
    return {
      type: "object",
      properties: {
        count: { type: "number" },
        rules: { type: "array", items: { type: "object" } }
      }
    };
  }

  async execute(params) {
    const rules = this.ruleEngine.listRules(params || {});
    return { count: rules.length, rules };
  }
}
