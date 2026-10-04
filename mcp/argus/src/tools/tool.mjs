// Base class for every MCP tool. Pure JavaScript (no TypeScript syntax):
// these files are executed directly by Node, so any TS annotation is a
// SyntaxError at load time.

export class Tool {
  // Subclasses override these four.
  getName() {
    throw new Error("Tool subclass must implement getName()");
  }

  getTitle() {
    return this.getName();
  }

  getDescription() {
    return "";
  }

  getInputSchema() {
    return { type: "object", properties: {} };
  }

  getOutputSchema() {
    return undefined;
  }

  /** MCP tools/list entry. outputSchema is omitted when undefined so the
   *  client never sees a key with value null. */
  getDefinition() {
    const definition = {
      name: this.getName(),
      title: this.getTitle(),
      description: this.getDescription(),
      inputSchema: this.getInputSchema()
    };
    const outputSchema = this.getOutputSchema();
    if (outputSchema !== undefined) definition.outputSchema = outputSchema;
    return definition;
  }

  /** Subclasses implement the actual work. Must return a plain object. */
  async execute(_params) {
    throw new Error("Tool subclass must implement execute()");
  }
}
