import { Tool } from "./tool.mjs";

export class ScanTool extends Tool {
  constructor(scanner) {
    super();
    this.scanner = scanner;
  }

  getName() {
    return "scan";
  }

  getTitle() {
    return "Scan code for security issues";
  }

  getDescription() {
    return "Scan a file or directory for security vulnerabilities and code quality issues. Returns findings with rule id, severity, file:line:column and the matched code. Deterministic: the same input always produces the same output.";
  }

  getInputSchema() {
    return {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File or directory path to scan."
        },
        rules: {
          type: "array",
          items: { type: "string" },
          description: "Optional: only apply these rule ids."
        },
        languages: {
          type: "array",
          items: { type: "string" },
          description: "Optional: only scan files of these languages (e.g. python, javascript)."
        }
      },
      required: ["path"]
    };
  }

  getOutputSchema() {
    return {
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rule: { type: "string" },
              name: { type: "string" },
              severity: { type: "string", enum: ["error", "warning", "info"] },
              file: { type: "string" },
              line: { type: "number" },
              column: { type: "number" },
              message: { type: "string" },
              code: { type: "string" }
            }
          }
        },
        scanned_files: { type: "number" },
        scan_time: { type: "number" },
        errors: { type: "array", items: { type: "string" } }
      }
    };
  }

  async execute(params) {
    return this.scanner.scan(params);
  }
}
