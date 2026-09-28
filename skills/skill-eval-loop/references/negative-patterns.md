# Negative prompt patterns

Add rows here whenever a false trigger is found in production or eval.

| Skill | Prompt that must NOT trigger | Why it looked related | Fix applied |
|---|---|---|---|
| skill-eval-loop | "write a new skill from scratch" | same "skill" word | description steers authoring to skill-authoring |
| openapi-mcp-server | "explain what MCP is" | MCP keyword | description is build-oriented |
| browser-session | "install playwright" | playwright keyword | description is session/automation oriented |
| skill-authoring | "measure skill quality" | skill keyword | description points eval work to skill-eval-loop |

Keep this file next to the prompt set (`prompts.csv`). One row per false positive; re-run the negative set after every description edit.
