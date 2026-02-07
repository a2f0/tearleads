/**
 * Tool registry - manages available tools and their execution.
 */

import {
  executeSearchTool,
  type SearchToolArgs,
  searchToolDefinition
} from './search-tool';
import type { ToolCall, ToolDefinition, ToolResult } from './types';

/**
 * All available tool definitions.
 */
export const toolDefinitions: ToolDefinition[] = [searchToolDefinition];

/**
 * Execute a tool call and return the result.
 */
export async function executeTool(toolCall: ToolCall): Promise<ToolResult> {
  const { name, arguments: argsJson } = toolCall.function;

  try {
    const args = JSON.parse(argsJson);

    let result: unknown;

    switch (name) {
      case 'search_user_data':
        result = await executeSearchTool(args as SearchToolArgs);
        break;

      default:
        result = { error: `Unknown tool: ${name}` };
    }

    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      content: JSON.stringify(result)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      tool_call_id: toolCall.id,
      role: 'tool',
      content: JSON.stringify({ error: `Tool execution failed: ${message}` })
    };
  }
}

/**
 * Execute multiple tool calls in parallel.
 */
export async function executeTools(
  toolCalls: ToolCall[]
): Promise<ToolResult[]> {
  return Promise.all(toolCalls.map(executeTool));
}

/**
 * Check if tool calling is enabled.
 * Currently enabled for all OpenRouter models.
 */
export function isToolCallingEnabled(): boolean {
  // Tool calling is available for OpenRouter models
  // We could add a feature flag or model-specific checks here
  return true;
}
