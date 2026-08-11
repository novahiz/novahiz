import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';

const FORMATTABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.md'];

async function main() {
  const inputData = fs.readFileSync(0, 'utf-8');
  if (!inputData) {
    console.log(JSON.stringify({}));
    return;
  }

  try {
    const payload = JSON.parse(inputData);
    const toolName = payload.toolCall?.name;
    const targetFile = payload.toolCall?.args?.TargetFile;

    if ((toolName === 'write_to_file' || toolName === 'replace_file_content') && targetFile) {
      const ext = path.extname(targetFile).toLowerCase();
      if (FORMATTABLE_EXTENSIONS.includes(ext) && fs.existsSync(targetFile)) {
        // Run prettier quietly in the background without blocking the pipeline
        exec(`npx prettier --write "${targetFile}"`, { timeout: 4000 }, () => {
          // background completion
        });
      }
    }
  } catch (e) {
    // Ignore error
  }

  // PostToolUse must return empty object {}
  console.log(JSON.stringify({}));
}

main().catch(() => {
  console.log(JSON.stringify({}));
});
