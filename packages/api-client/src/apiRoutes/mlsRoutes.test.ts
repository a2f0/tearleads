import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn()
}));

vi.mock('../apiCore', () => ({
  request: requestMock
}));

import { mlsRoutes } from './mlsRoutes';

describe('mlsRoutes', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
  });

  it('builds group messages route without query params when options are omitted', async () => {
    await mlsRoutes.getGroupMessages('group-1');

    const routePath = requestMock.mock.calls[0]?.[0];
    expect(routePath).toBe('/mls/groups/group-1/messages');
  });

  it('builds group messages route with cursor and limit query params', async () => {
    await mlsRoutes.getGroupMessages('group 2', {
      cursor: 'cursor-5',
      limit: 50
    });

    const routePath = requestMock.mock.calls[0]?.[0];
    expect(routePath).toBe(
      '/mls/groups/group%202/messages?cursor=cursor-5&limit=50'
    );
  });
});
