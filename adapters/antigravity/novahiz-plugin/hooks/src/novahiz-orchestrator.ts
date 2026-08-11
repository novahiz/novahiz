import * as fs from 'fs';

// Note: In a real implementation, this hook intercepts tool calls to spawn
// parallel agents for tasks that are decomposable. This is a placeholder.

async function main() {
  const inputData = fs.readFileSync(0, 'utf-8');
  if (!inputData) {
    console.log(JSON.stringify({ decision: "allow" }));
    return;
  }
  
  // PreToolUse must return { decision: "allow" } if we don't block
  console.log(JSON.stringify({ decision: "allow" }));
}

main().catch(err => {
  console.log(JSON.stringify({ decision: "allow" }));
});
