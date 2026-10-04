// Scanner: walks files/directories and feeds them to the RuleEngine.
// Pure JavaScript, zero dependencies.

import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.mjs";

const LANGUAGE_BY_EXT = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".php": "php",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".ps1": "powershell",
  ".sql": "sql",
  ".html": "html",
  ".htm": "html",
  ".vue": "vue",
  ".svelte": "svelte",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".toml": "toml",
  ".xml": "xml",
  ".pl": "perl",
  ".lua": "lua",
  ".swift": "swift",
  ".scala": "scala"
};

function languageOf(filePath) {
  return LANGUAGE_BY_EXT[path.extname(filePath).toLowerCase()] || null;
}

/** A file with a NUL byte in its first 8 KB is binary: skip it. */
function looksBinary(buffer) {
  const limit = Math.min(buffer.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

export class Scanner {
  constructor(ruleEngine) {
    this.ruleEngine = ruleEngine;
  }

  /** Scan a file or directory. Always returns a result object — a single
   *  unreadable file is reported in `errors`, never thrown away silently. */
  scan(params) {
    const started = Date.now();
    if (!params || typeof params.path !== "string" || params.path.trim().length === 0) {
      throw new Error("Invalid params: path must be a non-empty string");
    }
    if (params.path.length > CONFIG.maxPathLength) {
      throw new Error(`Invalid params: path exceeds ${CONFIG.maxPathLength} characters`);
    }

    const target = path.resolve(params.path);
    const options = {
      rules: Array.isArray(params.rules) ? params.rules : null,
      languages: Array.isArray(params.languages) ? params.languages : null
    };

    const findings = [];
    const errors = [];
    const files = [];

    let stat;
    try {
      stat = fs.statSync(target);
    } catch {
      throw new Error(`Invalid params: path does not exist: ${target}`);
    }

    if (stat.isFile()) {
      this.#scanOne(target, options, findings, errors, files);
    } else if (stat.isDirectory()) {
      this.#walk(target, options, findings, errors, files, 0);
    } else {
      throw new Error(`Invalid params: not a file or directory: ${target}`);
    }

    // Deterministic output: same input, same order, byte-identical response.
    findings.sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule)
    );

    return {
      findings,
      scanned_files: files.length,
      scanned_paths: files,
      errors,
      scan_time: Date.now() - started
    };
  }

  #walk(dir, options, findings, errors, files, depth) {
    if (depth > 32 || files.length + findings.length > 50000) return; // cycle/size guards
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      errors.push(`${dir}: ${error.message}`);
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (CONFIG.ignoredDirs.includes(entry.name)) continue;
        this.#walk(full, options, findings, errors, files, depth + 1);
      } else if (entry.isFile()) {
        this.#scanOne(full, options, findings, errors, files);
      }
    }
  }

  #scanOne(filePath, options, findings, errors, files) {
    if (options.languages && options.languages.length > 0) {
      const lang = languageOf(filePath);
      if (!lang || !options.languages.includes(lang)) return;
    }

    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch (error) {
      errors.push(`${filePath}: ${error.message}`);
      return;
    }
    if (stat.size > CONFIG.maxFileSize || stat.size === 0) return;

    // Read order matters: stat -> size gate -> 8 KB peek -> full read.
    // A large binary gets exactly one 8 KB read, never a full read.
    let buffer;
    let fd;
    try {
      fd = fs.openSync(filePath, "r");
      const head = Buffer.allocUnsafe(Math.min(stat.size, 8192));
      const headRead = fs.readSync(fd, head, 0, head.length, 0);
      if (looksBinary(head.subarray(0, headRead))) {
        fs.closeSync(fd);
        return;
      }
      const whole = Buffer.allocUnsafe(stat.size);
      const read = fs.readSync(fd, whole, 0, stat.size, 0);
      fs.closeSync(fd);
      fd = null;
      buffer = whole.subarray(0, read); // file may have shrunk since stat
    } catch (error) {
      if (fd !== null && fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* already closed */
        }
      }
      errors.push(`${filePath}: ${error.message}`);
      return;
    }

    const content = buffer.toString("utf8");
    files.push(filePath);
    findings.push(...this.ruleEngine.scanContent(filePath, content, options));
  }
}
