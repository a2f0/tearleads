import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getRecordedApiRequests,
  resetMockApiServerState,
  server,
  wasApiRequestMade
} from './node.js';

const testHandlers = [
  http.get('http://localhost/ping', () => HttpResponse.json({ ok: true })),
  http.get('http://localhost/v1/ping', () => HttpResponse.json({ ok: true })),
  http.get('http://localhost/admin/redis/dbsize', () =>
    HttpResponse.json({ dbsize: 0 })
  )
];

describe('msw node server', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
    server.use(...testHandlers);
  });

  afterEach(() => {
    server.resetHandlers(...testHandlers);
    resetMockApiServerState();
  });

  afterAll(() => {
    server.close();
  });

  it('supports handlers with and without /v1 prefix', async () => {
    const pingResponse = await fetch('http://localhost/ping');
    const pingV1Response = await fetch('http://localhost/v1/ping');

    expect(pingResponse.ok).toBe(true);
    expect(pingV1Response.ok).toBe(true);
  });

  it('records API requests for assertions', async () => {
    const response = await fetch('http://localhost/admin/redis/dbsize');

    expect(response.ok).toBe(true);
    expect(wasApiRequestMade('GET', '/admin/redis/dbsize')).toBe(true);

    const requests = getRecordedApiRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      method: 'GET',
      pathname: '/admin/redis/dbsize',
      url: 'http://localhost/admin/redis/dbsize'
    });
  });
});
