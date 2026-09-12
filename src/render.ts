const ESC = "\u001b[";
const RESET = `${ESC}0m`;

const CODES: Record<string, string> = {
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  red: `${ESC}31m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  magenta: `${ESC}35m`,
  cyan: `${ESC}36m`,
  gray: `${ESC}90m`
};

const ANSI = /\u001b\[[0-9;]*m/g;

export type Token = keyof typeof CODES;

export function isTty(): boolean {
  return process.stdout.isTTY === true;
}

function colorEnabled(): boolean {
  if (typeof process.env.NO_COLOR === "string" && process.env.NO_COLOR.length > 0) return false;
  if (typeof process.env.FORCE_COLOR === "string" && process.env.FORCE_COLOR !== "0") return true;
  return isTty();
}

export function style(token: Token, text: string): string {
  if (!colorEnabled()) return text;
  const code = CODES[token];
  if (!code) return text;
  return `${code}${text}${RESET}`;
}

function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

export function width(text: string): number {
  return stripAnsi(text).length;
}

export function bytes(value: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = Math.max(0, value);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size = size / 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(size)} ${units[unit]}`;
  return `${size.toFixed(1)} ${units[unit]}`;
}

export function heading(text: string): string {
  return style("bold", text);
}

export function rule(length = 52): string {
  return style("dim", "-".repeat(length));
}

export function kv(rows: Array<[string, string]>): string {
  const label = Math.max(0, ...rows.map((row) => width(row[0])));
  return rows
    .map(([key, value]) => `${style("dim", key.padEnd(label))}  ${value}`)
    .join("\n");
}

type Align = "left" | "right";

type TableOptions = {
  align?: Align[];
  indent?: number;
};

export function table(headers: string[], rows: string[][], options: TableOptions = {}): string {
  const indent = " ".repeat(options.indent ?? 2);
  const columns = headers.length;
  const align: Align[] = options.align ?? headers.map(() => "left");
  const widths = headers.map((header, index) => {
    const cells = [header, ...rows.map((row) => row[index] ?? "")];
    return Math.max(0, ...cells.map((cell) => width(cell)));
  });
  const line = (cells: string[], paint: (cell: string, index: number) => string): string =>
    indent +
    cells
      .map((cell, index) => {
        const text = paint(cell, index);
        const pad = widths[index] - width(cell);
        if (align[index] === "right") return " ".repeat(pad) + text;
        return text + " ".repeat(pad);
      })
      .join("  ")
      .trimEnd();
  return [
    line(headers, (cell) => style("dim", cell)),
    indent + style("dim", widths.map((size) => "-".repeat(size)).join("  ")),
    ...rows.map((row) => line(row.map((cell) => cell ?? ""), (cell) => cell))
  ].join("\n");
}

export function status(ok: boolean): string {
  return ok ? style("green", "ok") : style("red", "echec");
}
