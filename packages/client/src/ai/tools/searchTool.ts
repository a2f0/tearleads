/**
 * Search tool for AI - allows the AI to search user's data.
 */

import { getCurrentInstanceId } from '@/db';
import type { SearchableEntityType } from '@/search';
import { getSearchStoreForInstance } from '@/search';
import type { ToolDefinition } from './types';

/**
 * Search tool definition for OpenRouter/OpenAI function calling.
 */
export const searchToolDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_user_data',
    description:
      "Search across the user's apps, contacts, notes, emails, files, playlists, albums, and AI conversations. " +
      'Use this tool when the user asks about their data, wants to find something, or references information ' +
      'that might be stored in their database. Returns relevant results with titles and previews.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant items'
        },
        entityTypes: {
          type: 'array',
          description:
            'Optional filter to search only specific types. If not provided, searches all types.',
          items: {
            type: 'string',
            enum: [
              'app',
              'contact',
              'note',
              'email',
              'file',
              'playlist',
              'album',
              'ai_conversation'
            ]
          }
        },
        limit: {
          type: 'number',
          description:
            'Maximum number of results to return (default: 5, max: 20)'
        }
      },
      required: ['query']
    }
  }
};

/**
 * Arguments for the search tool.
 */
export interface SearchToolArgs {
  query: string;
  entityTypes?: SearchableEntityType[];
  limit?: number;
}

/**
 * A single search result item.
 */
interface SearchToolResultItem {
  id: string;
  type: SearchableEntityType;
  title: string;
  preview?: string;
  score: number;
}

/**
 * Result of the search tool execution.
 */
interface SearchToolResult {
  results: SearchToolResultItem[];
  totalFound: number;
  query: string;
}

/**
 * Execute the search tool.
 */
export async function executeSearchTool(
  args: SearchToolArgs
): Promise<SearchToolResult> {
  const instanceId = getCurrentInstanceId();

  if (!instanceId) {
    return {
      results: [],
      totalFound: 0,
      query: args.query
    };
  }

  const store = getSearchStoreForInstance(instanceId);
  const state = store.getState();

  if (!state.isInitialized) {
    return {
      results: [],
      totalFound: 0,
      query: args.query
    };
  }

  // Clamp limit to reasonable bounds
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);

  // Build search options, only including entityTypes if provided
  const searchOptions: { limit: number; entityTypes?: SearchableEntityType[] } =
    { limit };
  if (args.entityTypes) {
    searchOptions.entityTypes = args.entityTypes;
  }

  const { hits: searchResults, count: totalCount } = await store.search(
    args.query,
    searchOptions
  );

  const results: SearchToolResultItem[] = searchResults.map((r) => {
    // Create a preview from content or metadata
    let preview: string | undefined;
    if (r.document.content) {
      preview = r.document.content.slice(0, 150);
      if (r.document.content.length > 150) {
        preview += '...';
      }
    } else if (r.document.metadata) {
      preview = r.document.metadata.slice(0, 100);
    }

    const item: SearchToolResultItem = {
      id: r.id,
      type: r.entityType,
      title: r.document.title,
      score: r.score
    };

    if (preview) {
      item.preview = preview;
    }

    return item;
  });

  return {
    results,
    totalFound: totalCount,
    query: args.query
  };
}

/**
 * Format search results for display to the user.
 */
export function formatSearchResultsForDisplay(
  result: SearchToolResult
): string {
  if (result.results.length === 0) {
    return `No results found for "${result.query}".`;
  }

  const lines = [
    `Found ${result.totalFound} result(s) for "${result.query}":\n`
  ];

  for (const item of result.results) {
    const typeLabel = formatEntityType(item.type);
    lines.push(`• **${item.title}** (${typeLabel})`);
    if (item.preview) {
      lines.push(`  ${item.preview}`);
    }
  }

  return lines.join('\n');
}

const ENTITY_TYPE_LABELS: Record<SearchableEntityType, string> = {
  app: 'App',
  help_doc: 'Help Doc',
  contact: 'Contact',
  note: 'Note',
  email: 'Email',
  file: 'File',
  playlist: 'Playlist',
  album: 'Album',
  ai_conversation: 'AI Chat'
};

function formatEntityType(type: SearchableEntityType): string {
  return ENTITY_TYPE_LABELS[type] || type;
}
