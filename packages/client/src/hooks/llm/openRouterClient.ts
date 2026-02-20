/**
 * OpenRouter API client for LLM operations.
 */

import { isRecord } from '@tearleads/shared';
import {
  executeTools,
  formatSearchResultsForDisplay,
  isToolCallingEnabled,
  toolDefinitions
} from '@/ai/tools';
import { API_BASE_URL } from '@/lib/api';
import { getAuthHeaderValue } from '@/lib/authStorage';
import { logLLMAnalytics } from './analytics';
import type {
  AssistantToolCallMessage,
  ChatMessage,
  GenerateCallback,
  OpenRouterContentPart,
  OpenRouterMessage,
  OpenRouterResponse,
  ToolCall,
  ToolMessage
} from './types';

const DEV_ERROR_LOGGING = import.meta.env.DEV;

async function readErrorBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    return await response.text();
  } catch {
    return null;
  }
}

function getErrorDetail(body: unknown): string | null {
  if (typeof body === 'string') {
    const trimmed = body.trim();
    return trimmed ? trimmed : null;
  }

  if (isRecord(body)) {
    if (typeof body['message'] === 'string') {
      return body['message'];
    }
    if (typeof body['error'] === 'string') {
      return body['error'];
    }
    if (
      isRecord(body['error']) &&
      typeof body['error']['message'] === 'string'
    ) {
      return body['error']['message'];
    }
  }

  return null;
}

export function extractOpenRouterResponse(
  payload: unknown
): OpenRouterResponse {
  if (!isRecord(payload)) {
    return { content: null, toolCalls: null };
  }
  const choices = payload['choices'];
  if (!Array.isArray(choices) || choices.length === 0) {
    return { content: null, toolCalls: null };
  }
  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    return { content: null, toolCalls: null };
  }
  const message = firstChoice['message'];
  if (!isRecord(message)) {
    return { content: null, toolCalls: null };
  }

  // Extract content
  const content = message['content'];
  const textContent = typeof content === 'string' ? content : null;

  // Extract tool calls
  const toolCalls = message['tool_calls'];
  let parsedToolCalls: ToolCall[] | null = null;

  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    parsedToolCalls = toolCalls
      .filter(
        (tc): tc is ToolCall =>
          isRecord(tc) &&
          typeof tc['id'] === 'string' &&
          tc['type'] === 'function' &&
          isRecord(tc['function']) &&
          typeof tc['function']['name'] === 'string' &&
          typeof tc['function']['arguments'] === 'string'
      )
      .map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments
        }
      }));

    if (parsedToolCalls.length === 0) {
      parsedToolCalls = null;
    }
  }

  return { content: textContent, toolCalls: parsedToolCalls };
}

export function buildOpenRouterMessages(
  messages: ChatMessage[],
  image?: string
): OpenRouterMessage[] {
  if (!image) {
    return messages;
  }

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex < 0) {
    throw new Error('Image attachments require a user message');
  }

  return messages.map((message, index) => {
    if (index !== lastUserIndex) {
      return message;
    }

    const contentParts: OpenRouterContentPart[] = [];
    const trimmedContent = message.content.trim();
    if (trimmedContent.length > 0) {
      contentParts.push({ type: 'text', text: trimmedContent });
    }
    contentParts.push({ type: 'image_url', image_url: { url: image } });

    return {
      role: message.role,
      content: contentParts
    };
  });
}

export async function generateWithOpenRouter(
  modelId: string,
  messages: ChatMessage[],
  onToken: GenerateCallback,
  image?: string
): Promise<void> {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  const start = performance.now();
  const requestUrl = `${API_BASE_URL}/chat/completions`;
  let loggedApiError = false;

  try {
    // Build message history including any tool results
    let conversationMessages: OpenRouterMessage[] = buildOpenRouterMessages(
      messages,
      image
    );

    const authHeader = getAuthHeaderValue();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    // Tool calling loop - max 5 iterations to prevent infinite loops
    const maxToolIterations = 5;
    let iteration = 0;

    while (iteration < maxToolIterations) {
      iteration++;

      // Build request body - include tools only if enabled
      const requestBody: Record<string, unknown> = {
        model: modelId,
        messages: conversationMessages
      };

      // Add tools if enabled and this is the first iteration or we're continuing
      if (isToolCallingEnabled() && toolDefinitions.length > 0) {
        requestBody['tools'] = toolDefinitions;
        requestBody['tool_choice'] = 'auto';
      }

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorBody = await readErrorBody(response);
        if (DEV_ERROR_LOGGING) {
          console.error('OpenRouter chat API error', {
            status: response.status,
            statusText: response.statusText,
            url: requestUrl,
            body: errorBody
          });
        }
        loggedApiError = true;
        const detail = getErrorDetail(errorBody);
        const detailSuffix = detail ? ` ${detail}` : '';
        throw new Error(`API error: ${response.status}${detailSuffix}`);
      }

      const payload = await response.json();
      const { content, toolCalls } = extractOpenRouterResponse(payload);

      // If there are tool calls, execute them and continue the loop
      if (toolCalls && toolCalls.length > 0) {
        // Notify user that tools are being used
        onToken('🔍 Searching your data...\n\n');

        // Add assistant message with tool calls to conversation
        const assistantMessage: AssistantToolCallMessage = {
          role: 'assistant',
          content: content,
          tool_calls: toolCalls
        };
        conversationMessages = [...conversationMessages, assistantMessage];

        // Execute all tool calls
        const toolResults = await executeTools(toolCalls);

        // Add tool results to conversation
        for (const result of toolResults) {
          const toolMessage: ToolMessage = {
            role: 'tool',
            tool_call_id: result.tool_call_id,
            content: result.content
          };
          conversationMessages = [...conversationMessages, toolMessage];

          // Show formatted search results to user
          try {
            const parsed = JSON.parse(result.content);
            if (parsed.results) {
              const formatted = formatSearchResultsForDisplay(parsed);
              onToken(`${formatted}\n\n---\n\n`);
            }
          } catch {
            // Ignore parsing errors
          }
        }

        // Continue loop to get final response
        continue;
      }

      // No tool calls - we have the final response
      if (!content) {
        throw new Error('OpenRouter response missing content');
      }

      onToken(content);
      logLLMAnalytics('llm_prompt_text', performance.now() - start, true);
      return;
    }

    // If we hit max iterations, return what we have
    throw new Error('Tool calling exceeded maximum iterations');
  } catch (error) {
    logLLMAnalytics('llm_prompt_text', performance.now() - start, false);
    if (DEV_ERROR_LOGGING && !loggedApiError) {
      console.error('OpenRouter chat request failed', error);
    }
    throw error;
  }
}
