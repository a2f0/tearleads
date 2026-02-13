import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  getRecordedApiRequests,
  resetMockApiServerState,
  server,
  wasApiRequestMade
} from './node.js';

describe('msw node server', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
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
