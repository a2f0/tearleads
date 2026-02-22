/**
 * Types for AI tool calling support.
 */

/**
 * OpenRouter/OpenAI function tool definition.
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<
        string,
        {
          type: string;
          description?: string;
          enum?: string[];
          items?: { type?: string; enum?: string[] };
        }
      >;
      required?: string[];
    };
  };
}

/**
 * A tool call from the model's response.
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

/**
 * Result of executing a tool.
 */
export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string; // JSON stringified result
}
