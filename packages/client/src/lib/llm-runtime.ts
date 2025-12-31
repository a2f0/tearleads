import type { ChatModelAdapter } from '@assistant-ui/react';
import type { MLCEngineInterface } from '@mlc-ai/web-llm';

/**
 * Creates a ChatModelAdapter that bridges assistant-ui with MLC WebLLM.
 * This adapter enables streaming chat completions from local LLM inference.
 */
export function createWebLLMAdapter(
  engine: MLCEngineInterface
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      // Map assistant-ui message format to OpenAI-compatible format
      const formattedMessages = messages.map((m) => ({
        role: m.role,
        content:
          m.content
            .filter(
              (c): c is { type: 'text'; text: string } => c.type === 'text'
            )
            .map((c) => c.text)
            .join('') || ''
      }));

      const stream = await engine.chat.completions.create({
        messages: formattedMessages,
        stream: true
      });

      let textContent = '';

      for await (const chunk of stream) {
        if (abortSignal?.aborted) {
          break;
        }

        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          textContent += delta;
          yield {
            content: [{ type: 'text' as const, text: textContent }]
          };
        }
      }
    }
  };
}
