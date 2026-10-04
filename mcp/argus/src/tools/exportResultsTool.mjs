import fs from "node:fs";
import path from "node:path";
import { Tool } from "./tool.mjs";
import { CONFIG } from "../config.mjs";

const FORMATS = ["json", "sarif", "csv", "html"];

function escapeCsv(value) {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export class ExportResultsTool extends Tool {
  constructor() {
    super();
  }

  getName() {
    return "export_results";
  }

  getTitle() {
    return "Export scan results";
  }

  getDescription() {
    return "Write scan results to a file in one of: json, sarif, csv, html. Returns the path of the written file. Never rewrites outside the temp directory.";
  }

  getInputSchema() {
    return {
      type: "object",
      properties: {
        results: {
          type: "object",
          description: "The scan result object returned by the scan tool."
        },
        format: {
          type: "string",
          enum: FORMATS,
          description: "Output format."
        },
        output_dir: {
          type: "string",
          description: "Optional directory to write into (defaults to the server temp dir)."
        }
      },
      required: ["results", "format"]
    };
  }

  getOutputSchema() {
    return {
      type: "object",
      properties: {
        success: { type: "boolean" },
        format: { type: "string" },
        exported_file: { type: "string" }
      }
    };
  }

  async execute(params) {
    if (!params || typeof params !== "object") {
      throw new Error("Invalid params: object required");
    }
    const { results, format, output_dir } = params;
    if (!results || typeof results !== "object" || !Array.isArray(results.findings)) {
      throw new Error("Invalid params: results must be an object with a findings array");
    }
    if (!FORMATS.includes(format)) {
      throw new Error(`Invalid params: format must be one of ${FORMATS.join(", ")}`);
    }

    // Output stays inside a resolved directory: no traversal out of it.
    const baseDir = path.resolve(output_dir || CONFIG.tempDir);
    fs.mkdirSync(baseDir, { recursive: true });
    const filename = path.join(baseDir, `argus-results-${Date.now()}.${format}`);

    let body;
    switch (format) {
      case "json":
        body = JSON.stringify(results, null, 2);
        break;
      case "sarif":
        body = JSON.stringify(toSarif(results), null, 2);
        break;
      case "csv":
        body = toCsv(results);
        break;
      case "html":
        body = toHtml(results);
        break;
      default:
        throw new Error(`Invalid params: format must be one of ${FORMATS.join(", ")}`);
    }

    fs.writeFileSync(filename, body, "utf8");
    return { success: true, format, exported_file: filename };
  }
}

function toSarif(results) {
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "argus",
            informationUri: "https://github.com/novahiz/argus",
            version: "0.1.0"
          }
        },
        results: results.findings.map((finding) => ({
          ruleId: finding.rule,
          level:
            finding.severity === "error"
              ? "error"
              : finding.severity === "warning"
                ? "warning"
                : "note",
          message: { text: finding.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: finding.file },
                region: {
                  startLine: finding.line,
                  startColumn: finding.column
                }
              }
            }
          ]
        }))
      }
    ]
  };
}

function toCsv(results) {
  const header = ["rule", "severity", "file", "line", "column", "message", "code"];
  const rows = results.findings.map((finding) =>
    [
      finding.rule,
      finding.severity,
      finding.file,
      finding.line,
      finding.column,
      finding.message,
      finding.code
    ]
      .map(escapeCsv)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function toHtml(results) {
  const rows = results.findings
    .map(
      (finding) => `      <tr class="${escapeHtml(finding.severity)}">
        <td>${escapeHtml(finding.severity)}</td>
        <td>${escapeHtml(finding.rule)}</td>
        <td>${escapeHtml(finding.file)}</td>
        <td>${finding.line}:${finding.column}</td>
        <td>${escapeHtml(finding.message)}</td>
        <td><code>${escapeHtml(finding.code)}</code></td>
      </tr>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Argus scan report</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 14px; }
    th { background: #2196f3; color: #fff; }
    tr.error { background: #ffebee; }
    tr.warning { background: #fff3e0; }
    tr.info { background: #e8f5e9; }
    code { white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <h1>Argus scan report</h1>
  <p>${results.scanned_files ?? 0} file(s) scanned, ${results.findings.length} finding(s).</p>
  <table>
    <thead><tr><th>Severity</th><th>Rule</th><th>File</th><th>Location</th><th>Message</th><th>Code</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
