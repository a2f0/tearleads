import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTokenActor, toBase64 } from './instanceSwitchTestUtils';

describe('toBase64', () => {
  it('encodes utf8 strings', () => {
    expect(toBase64('hello')).toBe('aGVsbG8=');
  });
});

describe('createTokenActor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when token is missing', async () => {
    const actor = createTokenActor({
      baseUrl: 'https://api.example',
      resolveToken: () => null
    });

    await expect(actor.fetchJson('/v1/test')).rejects.toThrow('Missing auth token');
    expect(vi.spyOn(globalThis, 'fetch')).not.toHaveBeenCalled();
  });

  it('adds auth and default content-type for json bodies', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    const actor = createTokenActor({
      baseUrl: 'https://api.example',
      resolveToken: () => 'token-123'
    });

    const result = await actor.fetchJson('/v1/test', {
      method: 'POST',
      body: JSON.stringify({ hello: 'world' })
    });

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe('https://api.example/v1/test');
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-123');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('returns null when response body is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', {
        status: 200
      })
    );
    const actor = createTokenActor({
      baseUrl: 'https://api.example',
      resolveToken: () => 'token-123'
    });

    await expect(actor.fetchJson('/v1/empty')).resolves.toBeNull();
  });

  it('includes parsed response body when request fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad-request' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    const actor = createTokenActor({
      baseUrl: 'https://api.example',
      resolveToken: () => 'token-123'
    });

    await expect(actor.fetchJson('/v1/fail')).rejects.toThrow(
      'Request failed: /v1/fail 400 {"error":"bad-request"}'
    );
  });
});
