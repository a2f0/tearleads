import { describe, expect, it, vi } from 'vitest';
import { ensureVfsKeysExist, loginApiActor } from './apiActorAuth.js';

function mockFetchResponse(body: unknown, status = 200, ok = true): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
    redirected: false,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic',
    url: '',
    clone: () => mockFetchResponse(body, status, ok),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    json: async () => body,
    bytes: async () => new Uint8Array()
  };
}

describe('loginApiActor', () => {
  it('returns an authenticated actor on successful login', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockFetchResponse({
        accessToken: 'tok-123',
        user: { id: 'user-1', email: 'bob@test.com' }
      })
    );

    const actor = await loginApiActor({
      baseUrl: 'http://localhost:3000',
      email: 'bob@test.com',
      password: 'secret'
    });

    expect(actor.userId).toBe('user-1');
    expect(actor.userEmail).toBe('bob@test.com');
    expect(typeof actor.fetchJson).toBe('function');

    fetchSpy.mockRestore();
  });

  it('throws on login failure', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockFetchResponse({ error: 'bad creds' }, 401, false)
      );

    await expect(
      loginApiActor({
        baseUrl: 'http://localhost:3000',
        email: 'bob@test.com',
        password: 'wrong'
      })
    ).rejects.toThrow('Failed to login');

    fetchSpy.mockRestore();
  });

  it('throws on malformed auth response', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockFetchResponse({ unexpected: true }));

    await expect(
      loginApiActor({
        baseUrl: 'http://localhost:3000',
        email: 'bob@test.com',
        password: 'secret'
      })
    ).rejects.toThrow('Unexpected auth response shape');

    fetchSpy.mockRestore();
  });

  it('throws when auth response fields are not strings', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      mockFetchResponse({
        accessToken: 123,
        user: { id: 'user-1', email: 'bob@test.com' }
      })
    );

    await expect(
      loginApiActor({
        baseUrl: 'http://localhost:3000',
        email: 'bob@test.com',
        password: 'secret'
      })
    ).rejects.toThrow('missing required fields');

    fetchSpy.mockRestore();
  });

  it('authenticated actor makes requests with bearer token', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockFetchResponse({
          accessToken: 'tok-abc',
          user: { id: 'u1', email: 'a@b.com' }
        })
      )
      .mockResolvedValueOnce(mockFetchResponse({ data: 'ok' }));

    const actor = await loginApiActor({
      baseUrl: 'http://localhost:3000',
      email: 'a@b.com',
      password: 'pw'
    });

    const result = await actor.fetchJson('/test');
    expect(result).toEqual({ data: 'ok' });

    const secondCall = fetchSpy.mock.calls[1];
    expect(secondCall?.[0]).toBe('http://localhost:3000/test');
    const headers = secondCall?.[1]?.headers;
    expect(headers).toHaveProperty('Authorization', 'Bearer tok-abc');

    fetchSpy.mockRestore();
  });

  it('authenticated actor throws on non-ok response', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        mockFetchResponse({
          accessToken: 'tok-abc',
          user: { id: 'u1', email: 'a@b.com' }
        })
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ error: 'not found' }, 404, false)
      );

    const actor = await loginApiActor({
      baseUrl: 'http://localhost:3000',
      email: 'a@b.com',
      password: 'pw'
    });

    await expect(actor.fetchJson('/missing')).rejects.toThrow(
      'API request failed'
    );

    fetchSpy.mockRestore();
  });
});

describe('ensureVfsKeysExist', () => {
  it('posts VFS keys without error', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue({ publicEncryptionKey: 'key' })
    };

    await ensureVfsKeysExist({ actor, keyPrefix: 'test' });
    expect(actor.fetchJson).toHaveBeenCalledWith(
      '/vfs/keys',
      expect.any(Object)
    );
  });

  it('ignores 409 conflict errors', async () => {
    const actor = {
      fetchJson: vi.fn().mockRejectedValue(new Error('409 Conflict'))
    };

    await expect(
      ensureVfsKeysExist({ actor, keyPrefix: 'test' })
    ).resolves.toBeUndefined();
  });

  it('rethrows non-409 errors', async () => {
    const actor = {
      fetchJson: vi.fn().mockRejectedValue(new Error('500 Internal'))
    };

    await expect(
      ensureVfsKeysExist({ actor, keyPrefix: 'test' })
    ).rejects.toThrow('500 Internal');
  });
});
