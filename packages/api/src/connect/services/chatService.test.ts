import { create } from '@bufbuild/protobuf';
import {
  Code,
  createContextValues,
  createHandlerContext
} from '@connectrpc/connect';
import { DEFAULT_OPENROUTER_MODEL_ID, isRecord } from '@tearleads/shared';
import { ChatService } from '@tearleads/shared/gen/tearleads/v1/chat_pb';
import { JsonRequestSchema } from '@tearleads/shared/gen/tearleads/v1/common_pb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_AUTH_CONTEXT_KEY } from '../context.js';
import { chatConnectService } from './chatService.js';

const fetchMock = vi.fn<typeof fetch>();

function createAuthContext(
  method: (typeof ChatService.method)[keyof typeof ChatService.method]
) {
  const contextValues = createContextValues();
  contextValues.set(CONNECT_AUTH_CONTEXT_KEY, {
    claims: {
      sub: 'user-1',
      email: 'user-1@example.com',
      jti: 'session-1'
    },
    session: {
      userId: 'user-1',
      email: 'user-1@example.com',
      admin: false,
      createdAt: '2026-03-02T00:00:00.000Z',
      lastActiveAt: '2026-03-02T00:00:00.000Z',
      ipAddress: '127.0.0.1'
    }
  });

  return createHandlerContext({
    service: ChatService,
    method,
    protocolName: 'connect',
    requestMethod: 'POST',
    url: `http://localhost/v1/connect/tearleads.v1.ChatService/${method.name}`,
    contextValues
  });
}

function createUnauthenticatedContext(
  method: (typeof ChatService.method)[keyof typeof ChatService.method]
) {
  return createHandlerContext({
    service: ChatService,
    method,
    protocolName: 'connect',
    requestMethod: 'POST',
    url: `http://localhost/v1/connect/tearleads.v1.ChatService/${method.name}`
  });
}

describe('chatConnectService', () => {
  let previousApiKey: string | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    previousApiKey = process.env['OPENROUTER_API_KEY'];
    process.env['OPENROUTER_API_KEY'] = 'test-key';
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (previousApiKey === undefined) {
      delete process.env['OPENROUTER_API_KEY'];
    } else {
      process.env['OPENROUTER_API_KEY'] = previousApiKey;
    }
    vi.unstubAllGlobals();
  });

  it('returns json payload for successful upstream completions', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'chat-1',
          choices: [{ message: { role: 'assistant', content: 'hello' } }]
        }),
        { status: 200 }
      )
    );

    const response = await chatConnectService.postCompletions(
      create(JsonRequestSchema, {
        json: JSON.stringify({
          messages: [{ role: 'user', content: 'Hello' }]
        })
      }),
      createAuthContext(ChatService.method.postCompletions)
    );

    expect(JSON.parse(response.json)).toEqual({
      id: 'chat-1',
      choices: [{ message: { role: 'assistant', content: 'hello' } }]
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    if (!call) {
      throw new Error('Expected fetch to be called');
    }

    expect(call[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    const requestInit = call[1];
    if (!requestInit || typeof requestInit !== 'object') {
      throw new Error('Expected fetch options to be present');
    }
    if (typeof requestInit.body !== 'string') {
      throw new Error('Expected request body to be a string');
    }

    const parsedBody: unknown = JSON.parse(requestInit.body);
    if (!isRecord(parsedBody)) {
      throw new Error('Expected JSON object request body');
    }
    expect(parsedBody['model']).toBe(DEFAULT_OPENROUTER_MODEL_ID);
    expect(parsedBody['messages']).toEqual([
      { role: 'user', content: 'Hello' }
    ]);
  });

  it('returns invalid argument for invalid payload', async () => {
    await expect(
      chatConnectService.postCompletions(
        create(JsonRequestSchema, {
          json: JSON.stringify({ messages: [] })
        }),
        createAuthContext(ChatService.method.postCompletions)
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns invalid argument for malformed json payload', async () => {
    await expect(
      chatConnectService.postCompletions(
        create(JsonRequestSchema, {
          json: '{'
        }),
        createAuthContext(ChatService.method.postCompletions)
      )
    ).rejects.toMatchObject({
      code: Code.InvalidArgument
    });
  });

  it('returns unauthenticated when auth context is missing', async () => {
    await expect(
      chatConnectService.postCompletions(
        create(JsonRequestSchema, {
          json: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello' }]
          })
        }),
        createUnauthenticatedContext(ChatService.method.postCompletions)
      )
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('returns internal when OPENROUTER_API_KEY is missing', async () => {
    delete process.env['OPENROUTER_API_KEY'];

    await expect(
      chatConnectService.postCompletions(
        create(JsonRequestSchema, {
          json: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello' }]
          })
        }),
        createAuthContext(ChatService.method.postCompletions)
      )
    ).rejects.toMatchObject({
      code: Code.Internal
    });
  });

  it('maps upstream auth failures to unauthenticated connect errors', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid API key' }), {
        status: 401
      })
    );

    await expect(
      chatConnectService.postCompletions(
        create(JsonRequestSchema, {
          json: JSON.stringify({
            messages: [{ role: 'user', content: 'Hello' }]
          })
        }),
        createAuthContext(ChatService.method.postCompletions)
      )
    ).rejects.toMatchObject({
      code: Code.Unauthenticated
    });
  });

  it('maps network failures to internal connect errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error('network down'));

    try {
      await expect(
        chatConnectService.postCompletions(
          create(JsonRequestSchema, {
            json: JSON.stringify({
              messages: [{ role: 'user', content: 'Hello' }]
            })
          }),
          createAuthContext(ChatService.method.postCompletions)
        )
      ).rejects.toMatchObject({
        code: Code.Internal
      });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});
