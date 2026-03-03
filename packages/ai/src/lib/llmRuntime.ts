import type { ChatModelAdapter } from '@assistant-ui/react';
import type {
  ChatMessage,
  GenerateCallback,
  GenerateFunction
} from '../context';

interface LLMAdapterPersistenceOptions {
  onUserMessage?: (content: string) => Promise<void>;
  onAssistantMessage?: (content: string) => Promise<void>;
  canPersist?: () => boolean;
}

interface ContentPartWithType {
  type: string;
}

interface TextContentPart extends ContentPartWithType {
  type: 'text';
  text: string;
}

function extractTextContent(content: readonly ContentPartWithType[]): string {
  return content
    .filter((part): part is TextContentPart => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

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
 * Clears the attached image.
 * Called when switching instances to prevent image leakage between instances.
 */
export function clearAttachedImage(): void {
  attachedImage = null;
}

/**
 * Creates a ChatModelAdapter that bridges assistant-ui with our LLM worker.
 * This adapter enables streaming chat completions from local LLM inference.
 */
export function createLLMAdapter(
  generate: GenerateFunction,
  persistence?: LLMAdapterPersistenceOptions
): ChatModelAdapter {
  const persistedUserMessageIds = new Set<string>();
  const persistedAssistantMessageIds = new Set<string>();

  return {
    async *run({ messages, abortSignal, unstable_assistantMessageId }) {
      // Map assistant-ui message format to our ChatMessage format
      const formattedMessages: ChatMessage[] = messages.map((m) => ({
        role: m.role,
        content: extractTextContent(m.content)
      }));

      const canPersist = persistence?.canPersist
        ? persistence.canPersist()
        : true;
      const latestUserMessage = [...messages]
        .reverse()
        .find((message) => message.role === 'user');
      const latestUserMessageText = latestUserMessage
        ? extractTextContent(latestUserMessage.content)
        : '';

      if (
        canPersist &&
        persistence?.onUserMessage &&
        latestUserMessage?.id &&
        latestUserMessageText.length > 0 &&
        !persistedUserMessageIds.has(latestUserMessage.id)
      ) {
        try {
          await persistence.onUserMessage(latestUserMessageText);
          persistedUserMessageIds.add(latestUserMessage.id);
        } catch (error) {
          console.error('Failed to persist user AI message:', error);
        }
      }

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

      if (
        canPersist &&
        persistence?.onAssistantMessage &&
        textContent.trim().length > 0
      ) {
        const assistantMessageKey =
          unstable_assistantMessageId ??
          `assistant:${latestUserMessage?.id ?? 'unknown'}:${textContent.length}`;

        if (!persistedAssistantMessageIds.has(assistantMessageKey)) {
          try {
            await persistence.onAssistantMessage(textContent);
            persistedAssistantMessageIds.add(assistantMessageKey);
          } catch (persistError) {
            console.error(
              'Failed to persist assistant AI message:',
              persistError
            );
          }
        }
      }
    }
  };
}
