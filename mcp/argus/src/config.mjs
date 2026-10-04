// Central configuration — imported by every module to avoid circular imports.
// (cli.mjs previously exported CONFIG while importing scanner.mjs, which
// imported CONFIG back from cli.mjs: a cycle that breaks ESM evaluation.)

export const CONFIG = {
  // MCP stdio transport: no HTTP port is used. Kept for future transports.
  port: 8080,
  workspaceRoot: process.cwd(),
  tempDir: "./tmp/argus",
  // Skip files larger than 10 MB: regex scanning them burns CPU for nothing.
  maxFileSize: 10 * 1024 * 1024,
  // Soft budget for a whole scan call.
  timeout: 30000,
  // Hard caps (input validation — the server is a security tool itself).
  maxPathLength: 4096,
  maxPatternLength: 2000,
  maxRuleCount: 500,
  // Directories never worth scanning.
  ignoredDirs: [
    "node_modules",
    "dist",
    "build",
    "coverage",
    "vendor",
    ".git",
    "tmp",
    "__pycache__",
    ".next",
    ".cache"
  ]
};
