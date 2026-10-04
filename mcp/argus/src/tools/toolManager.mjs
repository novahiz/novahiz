// Registers the four MCP tools and dispatches tools/call requests.
// Pure JavaScript. Import paths are relative to src/tools/.

import { ScanTool } from "./scanTool.mjs";
import { ListRulesTool } from "./listRulesTool.mjs";
import { CreateRuleTool } from "./createRuleTool.mjs";
import { ExportResultsTool } from "./exportResultsTool.mjs";

export class ToolManager {
  constructor(ruleEngine, scanner) {
    this.tools = new Map();

    // The real Scanner is wired here: scan() executes an actual filesystem
    // walk, never a mock result.
    this.register(new ScanTool(scanner));
    this.register(new ListRulesTool(ruleEngine));
    this.register(new CreateRuleTool(ruleEngine));
    this.register(new ExportResultsTool());
  }

  register(tool) {
    this.tools.set(tool.getName(), tool);
  }

  /** MCP tools/list payload. */
  list() {
    return [...this.tools.values()].map((tool) => tool.getDefinition());
  }

  has(name) {
    return this.tools.has(name);
  }

  /** MCP tools/call dispatch. Returns the tool result object; tool failures
   *  are converted to isError results so one bad call never kills the loop. */
  async call(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      const error = new Error(`Unknown tool: ${name}`);
      error.code = -32602;
      throw error;
    }
    try {
      const result = await tool.execute(args || {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }
}
