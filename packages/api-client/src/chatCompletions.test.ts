import { describe, expect, it, vi } from 'vitest';
import { openChatCompletions } from './chatCompletions';

interface MockCompletionsResponse {
  json: string;
}

interface MockCompletionsClient {
  postCompletions: (
    request: { json: string },
    options?: { headers?: HeadersInit; signal?: AbortSignal }
  ) => Promise<MockCompletionsResponse>;
}

describe('openChatCompletions', () => {
  it('appends /connect to the base URL and forwards auth headers', async () => {
    const postCompletions = vi.fn<MockCompletionsClient['postCompletions']>(
      async () => ({
        json: '{"choices":[{"message":{"content":"Remote reply"}}]}'
      })
    );
    const createClient = vi.fn<(connectBaseUrl: string) => MockCompletionsClient>(
      (_connectBaseUrl) => ({
        postCompletions
      })
    );
    const abortController = new AbortController();

    const payload = await openChatCompletions({
      apiBaseUrl: 'http://localhost:5001/v1/',
      body: {
        model: 'model-1',
        messages: [{ role: 'user', content: 'Hello' }]
      },
      token: 'Bearer test-token',
      signal: abortController.signal,
      createClient
    });

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(
      'http://localhost:5001/v1/connect'
    );
    expect(postCompletions).toHaveBeenCalledTimes(1);
    expect(postCompletions).toHaveBeenCalledWith(
      {
        json: JSON.stringify({
          model: 'model-1',
          messages: [{ role: 'user', content: 'Hello' }]
        })
      },
      {
        headers: { Authorization: 'Bearer test-token' },
        signal: abortController.signal
      }
    );
    expect(payload).toEqual({
      choices: [{ message: { content: 'Remote reply' } }]
    });
  });

  it('preserves already-connected base URLs', async () => {
    const postCompletions = vi.fn<MockCompletionsClient['postCompletions']>(
      async () => ({
        json: '{"ok":true}'
      })
    );
    const createClient = vi.fn<(connectBaseUrl: string) => MockCompletionsClient>(
      () => ({
        postCompletions
      })
    );

    await openChatCompletions({
      apiBaseUrl: 'http://localhost:5001/v1/connect',
      body: {},
      createClient
    });

    expect(createClient).toHaveBeenCalledWith(
      'http://localhost:5001/v1/connect'
    );
  });

  it('uses an empty object for undefined bodies', async () => {
    const postCompletions = vi.fn<MockCompletionsClient['postCompletions']>(
      async () => ({
        json: '{"ok":true}'
      })
    );
    const createClient = vi.fn<(connectBaseUrl: string) => MockCompletionsClient>(
      () => ({
        postCompletions
      })
    );

    await openChatCompletions({
      apiBaseUrl: 'http://localhost:5001/v1',
      body: undefined,
      createClient
    });

    expect(postCompletions).toHaveBeenCalledWith(
      { json: '{}' },
      {}
    );
  });

  it('returns an empty object for blank response payloads', async () => {
    const postCompletions = vi.fn<MockCompletionsClient['postCompletions']>(
      async () => ({
        json: '   '
      })
    );
    const createClient = vi.fn<(connectBaseUrl: string) => MockCompletionsClient>(
      () => ({
        postCompletions
      })
    );

    const payload = await openChatCompletions({
      apiBaseUrl: 'http://localhost:5001/v1',
      body: {},
      createClient
    });

    expect(payload).toEqual({});
  });

  it('throws for invalid JSON responses', async () => {
    const postCompletions = vi.fn<MockCompletionsClient['postCompletions']>(
      async () => ({
        json: 'not-json'
      })
    );
    const createClient = vi.fn<(connectBaseUrl: string) => MockCompletionsClient>(
      () => ({
        postCompletions
      })
    );

    await expect(
      openChatCompletions({
        apiBaseUrl: 'http://localhost:5001/v1',
        body: {},
        createClient
      })
    ).rejects.toThrow('Chat completions response was not valid JSON');
  });
});
