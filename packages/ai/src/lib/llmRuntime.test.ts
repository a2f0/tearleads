import { describe, expect, it, vi } from 'vitest';
import { createLLMAdapter } from './llmRuntime';

type AdapterRunOptions = Parameters<ReturnType<typeof createLLMAdapter>['run']>[0];

function createRunOptions(params: {
  userMessageId: string;
  userText: string;
  assistantMessageId: string;
}): AdapterRunOptions {
  const userMessage = {
    id: params.userMessageId,
    role: 'user',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    content: [{ type: 'text', text: params.userText }],
    attachments: [],
    metadata: { custom: {} }
  } satisfies AdapterRunOptions['messages'][number];

  return {
    messages: [userMessage],
    runConfig: {},
    abortSignal: new AbortController().signal,
    context: {},
    config: {},
    unstable_assistantMessageId: params.assistantMessageId,
    unstable_getMessage: () => userMessage
  };
}

async function collectAssistantText(
  adapter: ReturnType<typeof createLLMAdapter>,
  options: AdapterRunOptions
): Promise<string[]> {
  const runResult = adapter.run(options);
  if (!(Symbol.asyncIterator in runResult)) {
    throw new Error('Expected adapter.run to return an async generator');
  }

  const outputs: string[] = [];
  for await (const update of runResult) {
    const text =
      update.content
        ?.filter((part): part is { type: 'text'; text: string } => {
          return part.type === 'text';
        })
        .map((part) => part.text)
        .join('') ?? '';
    outputs.push(text);
  }

  return outputs;
}

describe('createLLMAdapter persistence', () => {
  it('persists user and assistant messages once for a run', async () => {
    const onUserMessage = vi.fn(async () => {});
    const onAssistantMessage = vi.fn(async () => {});
    const generate = vi.fn(
      async (
        _messages: unknown,
        onToken: (text: string) => void
      ): Promise<void> => {
        onToken('Hello');
        onToken(' world');
      }
    );

    const adapter = createLLMAdapter(generate, {
      onUserMessage,
      onAssistantMessage,
      canPersist: () => true
    });

    const outputs = await collectAssistantText(
      adapter,
      createRunOptions({
        userMessageId: 'user-1',
        userText: 'How are you?',
        assistantMessageId: 'assistant-1'
      })
    );

    expect(outputs).not.toHaveLength(0);
    expect(outputs[outputs.length - 1]).toBe('Hello world');
    expect(onUserMessage).toHaveBeenCalledWith('How are you?');
    expect(onAssistantMessage).toHaveBeenCalledWith('Hello world');
  });

  it('does not persist duplicate user message ids across runs', async () => {
    const onUserMessage = vi.fn(async () => {});
    const onAssistantMessage = vi.fn(async () => {});
    const generate = vi.fn(
      async (
        _messages: unknown,
        onToken: (text: string) => void
      ): Promise<void> => {
        onToken('ok');
      }
    );

    const adapter = createLLMAdapter(generate, {
      onUserMessage,
      onAssistantMessage,
      canPersist: () => true
    });

    await collectAssistantText(
      adapter,
      createRunOptions({
        userMessageId: 'same-user',
        userText: 'repeat',
        assistantMessageId: 'assistant-a'
      })
    );
    await collectAssistantText(
      adapter,
      createRunOptions({
        userMessageId: 'same-user',
        userText: 'repeat',
        assistantMessageId: 'assistant-b'
      })
    );

    expect(onUserMessage).toHaveBeenCalledTimes(1);
    expect(onAssistantMessage).toHaveBeenCalledTimes(2);
  });
});
