import { Tool } from "./tool.mjs";

export class CreateRuleTool extends Tool {
  constructor(ruleEngine) {
    super();
    this.ruleEngine = ruleEngine;
  }

  getName() {
    return "create_rule";
  }

  getTitle() {
    return "Create a custom analysis rule";
  }

  getDescription() {
    return "Register a custom analysis rule. The pattern is a JavaScript regular expression, validated and compiled safely (nested quantifiers are rejected to prevent ReDoS).";
  }

  getInputSchema() {
    return {
      type: "object",
      properties: {
        rule: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Rule identifier, matches [A-Za-z0-9][A-Za-z0-9._-]* (max 128 chars)."
            },
            name: { type: "string", description: "Human-readable rule name." },
            severity: {
              type: "string",
              enum: ["error", "warning", "info"],
              description: "Rule severity."
            },
            description: { type: "string", description: "What the rule detects." },
            pattern: { type: "string", description: "Regular expression pattern to match." },
            languages: {
              type: "array",
              items: { type: "string" },
              description: "Languages this rule applies to."
            },
            examples: {
              type: "array",
              items: { type: "string" },
              description: "Example snippets that should match."
            }
          },
          required: ["id", "name", "severity", "description", "pattern"]
        }
      },
      required: ["rule"]
    };
  }

  getOutputSchema() {
    return {
      type: "object",
      properties: {
        success: { type: "boolean" },
        rule_id: { type: "string" }
      }
    };
  }

  async execute(params) {
    if (!params || typeof params !== "object" || !params.rule) {
      throw new Error("Invalid params: rule object is required");
    }
    const stored = this.ruleEngine.addRule(params.rule);
    return { success: true, rule_id: stored.id };
  }
}
