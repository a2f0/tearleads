import type { ChatModelAdapter } from '@assistant-ui/react';
import type { ChatMessage, GenerateCallback } from '@/hooks/useLLM';

type GenerateFunction = (
  messages: ChatMessage[],
  onToken: GenerateCallback,
  image?: string
) => Promise<void>;

// Store for the current attached image (base64 data URL)
let attachedImage: string | null = null;

/**
 * Sets the image to be attached to the next message.
 * The image should be a base64 data URL.
 */
export function setAttachedImage(image: string | null): void {
  attachedImage = image;
}

/**
 * Gets the currently attached image.
 */
export function getAttachedImage(): string | null {
  return attachedImage;
}

/**
 * Creates a ChatModelAdapter that bridges assistant-ui with our LLM worker.
 * This adapter enables streaming chat completions from local LLM inference.
 */
export function createLLMAdapter(generate: GenerateFunction): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      // Map assistant-ui message format to our ChatMessage format
      const formattedMessages: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content:
          m.content
            .filter(
              (c): c is { type: 'text'; text: string } => c.type === 'text'
            )
            .map((c) => c.text)
            .join('') || ''
      }));

      // Capture and clear the attached image
      const imageToSend = attachedImage;
      attachedImage = null;

      // Collect streamed text
      let textContent = '';
      let resolveNext: ((value: { done: boolean }) => void) | null = null;
      let hasNewToken = false;

      const onToken: GenerateCallback = (text: string) => {
        // TextStreamer sends individual tokens (deltas), accumulate them
        textContent += text;
        hasNewToken = true;
        if (resolveNext) {
          resolveNext({ done: false });
          resolveNext = null;
        }
      };

      // Start generation in background (with optional image)
      const generatePromise = generate(
        formattedMessages,
        onToken,
        imageToSend ?? undefined
      );

      // Track completion
      let isComplete = false;
      let error: Error | null = null;

      generatePromise
        .then(() => {
          isComplete = true;
          if (resolveNext) {
            resolveNext({ done: true });
          }
        })
        .catch((e) => {
          error = e instanceof Error ? e : new Error(String(e));
          isComplete = true;
          if (resolveNext) {
            resolveNext({ done: true });
          }
        });

      // Yield tokens as they come
      while (!isComplete && !abortSignal?.aborted) {
        // Wait for next token or completion
        await new Promise<{ done: boolean }>((resolve) => {
          if (isComplete || hasNewToken) {
            hasNewToken = false;
            resolve({ done: isComplete });
          } else {
            resolveNext = resolve;
          }
        });

        if (abortSignal?.aborted) {
          break;
        }

        if (textContent) {
          const content = [{ type: 'text', text: textContent }] satisfies {
            type: 'text';
            text: string;
          }[];
          yield {
            content
          };
        }
      }

      // Rethrow any errors
      if (error) {
        throw error;
      }
    }
  };
}
