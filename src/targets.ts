export function extractTargetPaths(tool: string, args: unknown): string[] {
  const paths: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0 && !paths.includes(value)) paths.push(value);
  };
  const record = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  push(record.filePath);
  push(record.path);
  push(record.file);

  const patchText =
    typeof record.patchText === "string"
      ? record.patchText
      : typeof record.patch === "string"
        ? record.patch
        : "";
  if (patchText.length > 0) {
    for (const line of patchText.split(/\r?\n/)) {
      const match = line.match(/^\*\*\*\s+(?:Update|Add|Delete|Move)\s+File:\s+(.+?)\s*$/);
      if (match) push(match[1]);
    }
  }

  return paths;
}
