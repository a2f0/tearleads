import { describe, expect, it } from 'vitest';
import {
  fetchWithRetryableWriteValidationError,
  isRetryableWriteValidationError
} from './apiScenarioHarness.js';

describe('isRetryableWriteValidationError', () => {
  it('retries share requests with transient required-field validation failures', () => {
    expect(
      isRetryableWriteValidationError(
        '/connect/tearleads.v2.VfsSharesService/CreateShare',
        { method: 'POST' },
        400,
        '{"error":"shareType, targetId, and permissionLevel are required"}'
      )
    ).toBe(true);
    expect(
      isRetryableWriteValidationError(
        '/connect/tearleads.v2.VfsSharesService/UpdateShare',
        { method: 'POST' },
        400,
        '{"error":"shareType, targetId, and permissionLevel are required"}'
      )
    ).toBe(true);
  });

  it('retries register requests with transient required-field validation failures', () => {
    expect(
      isRetryableWriteValidationError(
        '/connect/tearleads.v2.VfsService/Register',
        { method: 'POST' },
        400,
        '{"error":"id, objectType, and encryptedSessionKey are required"}'
      )
    ).toBe(true);
  });

  it('does not retry unrelated request failures', () => {
    expect(
      isRetryableWriteValidationError(
        '/connect/tearleads.v2.VfsService/Register',
        { method: 'GET' },
        400,
        '{"error":"id, objectType, and encryptedSessionKey are required"}'
      )
    ).toBe(false);

    expect(
      isRetryableWriteValidationError(
        '/connect/tearleads.v2.VfsSharesService/CreateShare',
        { method: 'POST' },
        500,
        '{"error":"shareType, targetId, and permissionLevel are required"}'
      )
    ).toBe(false);

    expect(
      isRetryableWriteValidationError(
        '/connect/tearleads.v2.VfsService/Register',
        { method: 'POST' },
        400,
        '{"error":"unexpected payload"}'
      )
    ).toBe(false);
  });
});

describe('fetchWithRetryableWriteValidationError', () => {
  it('retries transient register validation failures until success', async () => {
    const responses = [
      new Response(
        '{"error":"id, objectType, and encryptedSessionKey are required"}',
        { status: 400, statusText: 'Bad Request' }
      ),
      new Response(
        '{"error":"id, objectType, and encryptedSessionKey are required"}',
        { status: 400, statusText: 'Bad Request' }
      ),
      new Response('{"ok":true}', { status: 200, statusText: 'OK' })
    ];
    let callCount = 0;
    const sleeps: number[] = [];
    const fallbackSuccess = new Response('{"ok":true}', {
      status: 200,
      statusText: 'OK'
    });
    const actorFetch = async (): Promise<Response> => {
      const response = responses[callCount];
      callCount += 1;
      return response ?? fallbackSuccess;
    };

    const response = await fetchWithRetryableWriteValidationError(
      actorFetch,
      '/connect/tearleads.v2.VfsService/Register',
      { method: 'POST' },
      {
        sleep: async (ms: number): Promise<void> => {
          sleeps.push(ms);
        }
      }
    );

    expect(response.ok).toBe(true);
    expect(callCount).toBe(3);
    expect(sleeps).toEqual([25, 50]);
  });

  it('throws after the retry limit is reached', async () => {
    const retries = [
      new Response(
        '{"error":"id, objectType, and encryptedSessionKey are required"}',
        { status: 400, statusText: 'Bad Request' }
      ),
      new Response(
        '{"error":"id, objectType, and encryptedSessionKey are required"}',
        { status: 400, statusText: 'Bad Request' }
      ),
      new Response(
        '{"error":"id, objectType, and encryptedSessionKey are required"}',
        { status: 400, statusText: 'Bad Request' }
      )
    ];
    let callCount = 0;
    const sleeps: number[] = [];
    const fallbackFailure = new Response(
      '{"error":"id, objectType, and encryptedSessionKey are required"}',
      {
        status: 400,
        statusText: 'Bad Request'
      }
    );
    const actorFetch = async (): Promise<Response> => {
      const response = retries[callCount];
      callCount += 1;
      return response ?? fallbackFailure;
    };

    await expect(
      fetchWithRetryableWriteValidationError(
        actorFetch,
        '/connect/tearleads.v2.VfsService/Register',
        { method: 'POST' },
        {
          maxRetryAttempts: 2,
          sleep: async (ms: number): Promise<void> => {
            sleeps.push(ms);
          }
        }
      )
    ).rejects.toThrow(
      /API error 400 Bad Request: \{"error":"id, objectType, and encryptedSessionKey are required"\}/
    );
    expect(callCount).toBe(3);
    expect(sleeps).toEqual([25, 50]);
  });

  it('normalizes stream request bodies so retries keep the payload', async () => {
    const payload = JSON.stringify({
      id: 'note-stream',
      objectType: 'note',
      encryptedSessionKey: 'stream-key'
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload));
        controller.close();
      }
    });
    const seenBodies: string[] = [];
    let callCount = 0;
    const actorFetch = async (
      _path: string,
      init?: RequestInit
    ): Promise<Response> => {
      seenBodies.push(
        typeof init?.body === 'string' ? init.body : String(init?.body)
      );
      callCount += 1;
      if (callCount === 1) {
        return new Response(
          '{"error":"id, objectType, and encryptedSessionKey are required"}',
          { status: 400, statusText: 'Bad Request' }
        );
      }
      return new Response('{"ok":true}', { status: 200, statusText: 'OK' });
    };

    const response = await fetchWithRetryableWriteValidationError(
      actorFetch,
      '/connect/tearleads.v2.VfsService/Register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream
      },
      {
        sleep: async (): Promise<void> => {}
      }
    );

    expect(response.ok).toBe(true);
    expect(seenBodies).toEqual([payload, payload]);
  });

  it('rebuilds RequestInit per retry when fetch mutates init', async () => {
    const payload = JSON.stringify({
      id: 'note-retry-init',
      objectType: 'note',
      encryptedSessionKey: 'retry-init-key'
    });
    const seenBodies: string[] = [];
    let callCount = 0;

    const actorFetch = async (
      _path: string,
      init?: RequestInit
    ): Promise<Response> => {
      seenBodies.push(
        typeof init?.body === 'string' ? init.body : String(init?.body)
      );
      if (init) {
        Reflect.set(init, 'body', undefined);
      }

      callCount += 1;
      if (callCount === 1) {
        return new Response(
          '{"error":"id, objectType, and encryptedSessionKey are required"}',
          { status: 400, statusText: 'Bad Request' }
        );
      }

      return new Response('{"ok":true}', { status: 200, statusText: 'OK' });
    };

    const response = await fetchWithRetryableWriteValidationError(
      actorFetch,
      '/connect/tearleads.v2.VfsService/Register',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      },
      {
        sleep: async (): Promise<void> => {}
      }
    );

    expect(response.ok).toBe(true);
    expect(callCount).toBe(2);
    expect(seenBodies).toEqual([payload, payload]);
  });
});
