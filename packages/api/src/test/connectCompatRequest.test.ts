import { describe, expect, it, vi } from 'vitest';
import request from './connectCompatRequest.js';

const { executeRouteMock } = vi.hoisted(() => ({
  executeRouteMock: vi.fn<(options: unknown) => Promise<unknown>>()
}));

vi.mock('../connect/services/legacyRouteProxyExecution.js', () => ({
  executeRoute: executeRouteMock
}));

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

describe('connectCompatRequest', () => {
  it('normalizes /v1 route prefixes and forwards query params', async () => {
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: { ok: true }
    });

    const response = await request({})
      .get('/v1/admin/context?cursor=first')
      .query({ limit: 10, active: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    const call = executeRouteMock.mock.calls.at(-1);
    if (!call) {
      throw new Error('Expected executeRoute call');
    }

    const [options] = call;
    if (!isUnknownRecord(options)) {
      throw new Error('Expected options object');
    }
    expect(options['path']).toBe('/admin/context');
    expect(options['method']).toBe('GET');

    const query = options['query'];
    if (!(query instanceof URLSearchParams)) {
      throw new Error('Expected URLSearchParams');
    }
    expect(query.toString()).toBe('limit=10&active=true&cursor=first');
  });

  it('normalizes bare /v1 root to /', async () => {
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: { ok: true }
    });

    await request({}).get('/v1');

    const call = executeRouteMock.mock.calls.at(-1);
    if (!call) {
      throw new Error('Expected executeRoute call');
    }

    const [options] = call;
    if (!isUnknownRecord(options)) {
      throw new Error('Expected options object');
    }
    expect(options['path']).toBe('/');
  });

  it('only forwards string payload when content-type is json', async () => {
    executeRouteMock.mockResolvedValue({ status: 200, body: '{}' });

    await request({})
      .post('/v1/mls/groups')
      .set('content-type', 'application/json; charset=utf-8')
      .send('{"name":"group"}');

    let call = executeRouteMock.mock.calls.at(-1);
    if (!call) {
      throw new Error('Expected executeRoute call');
    }

    let [options] = call;
    if (!isUnknownRecord(options)) {
      throw new Error('Expected options object');
    }
    let optionsRecord = options;
    expect(optionsRecord['jsonBody']).toBe('{"name":"group"}');

    await request({}).post('/v1/mls/groups').send('{"name":"group"}');

    call = executeRouteMock.mock.calls.at(-1);
    if (!call) {
      throw new Error('Expected executeRoute call');
    }
    [options] = call;
    if (!isUnknownRecord(options)) {
      throw new Error('Expected options object');
    }
    optionsRecord = options;
    expect(optionsRecord['jsonBody']).toBeUndefined();

    await request({})
      .post('/v1/mls/groups')
      .send(new Uint8Array([1, 2, 3]));

    call = executeRouteMock.mock.calls.at(-1);
    if (!call) {
      throw new Error('Expected executeRoute call');
    }
    [options] = call;
    if (!isUnknownRecord(options)) {
      throw new Error('Expected options object');
    }
    optionsRecord = options;
    expect(optionsRecord['jsonBody']).toBeUndefined();
    const binaryBody = optionsRecord['binaryBody'];
    if (!isUint8Array(binaryBody)) {
      throw new Error('Expected binaryBody Uint8Array');
    }
    expect(Array.from(binaryBody)).toEqual([1, 2, 3]);

    await request({}).post('/v1/mls/groups').send({ name: 'group' });

    call = executeRouteMock.mock.calls.at(-1);
    if (!call) {
      throw new Error('Expected executeRoute call');
    }
    [options] = call;
    if (!isUnknownRecord(options)) {
      throw new Error('Expected options object');
    }
    optionsRecord = options;
    expect(optionsRecord['jsonBody']).toBe('{"name":"group"}');
  });

  it('returns binary bodies and applies optional parser', async () => {
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: new Uint8Array([65, 66]),
      contentType: 'application/octet-stream'
    });

    const rawResponse = await request({}).get('/v1/vfs/blobs/blob-1');
    expect(Buffer.isBuffer(rawResponse.body)).toBe(true);
    expect(Array.from(rawResponse.body)).toEqual([65, 66]);
    expect(rawResponse.headers['content-type']).toBe(
      'application/octet-stream'
    );
    expect(rawResponse.text).toBe('AB');

    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: new Uint8Array([67, 68])
    });

    const parsedResponse = await request({})
      .get('/v1/vfs/blobs/blob-2')
      .buffer(true)
      .parse((_stream, callback) => {
        callback(null, Buffer.from([1, 2, 3]));
      });

    expect(Array.from(parsedResponse.body)).toEqual([1, 2, 3]);
  });

  it('handles string, empty, and structured route bodies', async () => {
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: '{"ok":true}'
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: '{'
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: 'plain-text'
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 204,
      body: undefined
    });
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: { ok: true }
    });

    const jsonResponse = await request({}).get('/v1/admin/context');
    expect(jsonResponse.body).toEqual({ ok: true });
    expect(jsonResponse.text).toBe('{"ok":true}');

    const plainTextResponse = await request({}).get('/v1/admin/context');
    expect(plainTextResponse.body).toBe('{');
    expect(plainTextResponse.text).toBe('{');

    const stringResponse = await request({}).get('/v1/admin/context');
    expect(stringResponse.body).toBe('plain-text');
    expect(stringResponse.text).toBe('plain-text');

    const emptyResponse = await request({}).delete('/v1/admin/context');
    expect(emptyResponse.body).toEqual({});
    expect(emptyResponse.text).toBe('');

    const structuredResponse = await request({}).get('/v1/admin/context');
    expect(structuredResponse.body).toEqual({ ok: true });
    expect(structuredResponse.text).toBe('{"ok":true}');
  });

  it('supports await thenable parity', async () => {
    executeRouteMock.mockResolvedValueOnce({
      status: 200,
      body: { ok: true }
    });

    const response = await request({})
      .patch('/v1/admin/users/user-1')
      .send({ disabled: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
