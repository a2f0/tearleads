/**
 * Tests for the tool registry.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  executeTool,
  executeTools,
  isToolCallingEnabled,
  toolDefinitions
} from './registry';

// Mock the search tool
vi.mock('./search-tool', () => ({
  executeSearchTool: vi.fn(() =>
    Promise.resolve({
      results: [],
      totalFound: 0,
      query: 'test'
    })
  ),
  searchToolDefinition: {
    type: 'function',
    function: {
      name: 'search_user_data',
      description: 'Test search tool',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' }
        },
        required: ['query']
      }
    }
  }
}));

describe('toolDefinitions', () => {
  it('should contain at least one tool', () => {
    expect(toolDefinitions.length).toBeGreaterThan(0);
  });

  it('should contain the search tool', () => {
    const searchTool = toolDefinitions.find(
      (t) => t.function.name === 'search_user_data'
    );
    expect(searchTool).toBeDefined();
  });
});

describe('executeTool', () => {
  it('should execute search_user_data tool', async () => {
    const result = await executeTool({
      id: 'call-1',
      type: 'function',
      function: {
        name: 'search_user_data',
        arguments: JSON.stringify({ query: 'test' })
      }
    });

    expect(result.tool_call_id).toBe('call-1');
    expect(result.role).toBe('tool');
    expect(JSON.parse(result.content)).toEqual({
      results: [],
      totalFound: 0,
      query: 'test'
    });
  });

  it('should return error for unknown tool', async () => {
    const result = await executeTool({
      id: 'call-2',
      type: 'function',
      function: {
        name: 'unknown_tool',
        arguments: JSON.stringify({})
      }
    });

    expect(result.tool_call_id).toBe('call-2');
    expect(result.role).toBe('tool');
    const content = JSON.parse(result.content);
    expect(content.error).toBe('Unknown tool: unknown_tool');
  });

  it('should handle JSON parse errors', async () => {
    const result = await executeTool({
      id: 'call-3',
      type: 'function',
      function: {
        name: 'search_user_data',
        arguments: 'invalid-json'
      }
    });

    expect(result.tool_call_id).toBe('call-3');
    expect(result.role).toBe('tool');
    const content = JSON.parse(result.content);
    expect(content.error).toContain('Tool execution failed:');
  });

  it('should return error for invalid search arguments', async () => {
    const result = await executeTool({
      id: 'call-4',
      type: 'function',
      function: {
        name: 'search_user_data',
        arguments: JSON.stringify({ notQuery: 'missing query param' })
      }
    });

    expect(result.tool_call_id).toBe('call-4');
    expect(result.role).toBe('tool');
    const content = JSON.parse(result.content);
    expect(content.error).toBe(
      'Invalid arguments: query is required and must be a string'
    );
  });
});

describe('executeTools', () => {
  it('should execute multiple tools in parallel', async () => {
    const results = await executeTools([
      {
        id: 'call-a',
        type: 'function',
        function: {
          name: 'search_user_data',
          arguments: JSON.stringify({ query: 'test1' })
        }
      },
      {
        id: 'call-b',
        type: 'function',
        function: {
          name: 'search_user_data',
          arguments: JSON.stringify({ query: 'test2' })
        }
      }
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.tool_call_id).toBe('call-a');
    expect(results[1]?.tool_call_id).toBe('call-b');
  });

  it('should return empty array for empty input', async () => {
    const results = await executeTools([]);
    expect(results).toEqual([]);
  });
});

describe('isToolCallingEnabled', () => {
  it('should return true', () => {
    expect(isToolCallingEnabled()).toBe(true);
  });
});
