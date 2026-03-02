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

  it('routes group messages through Connect without optional fields', async () => {
    await mlsRoutes.getGroupMessages('group-1');

    const [routePath, params] = requestMock.mock.calls[0] ?? [];
    expect(routePath).toBe('/connect/tearleads.v1.MlsService/GetGroupMessages');
    expect(params?.fetchOptions?.method).toBe('POST');
    expect(params?.fetchOptions?.body).toBe(JSON.stringify({ groupId: 'group-1' }));
  });

  it('routes group messages through Connect with cursor and limit', async () => {
    await mlsRoutes.getGroupMessages('group 2', {
      cursor: 'cursor-5',
      limit: 50
    });

    const [routePath, params] = requestMock.mock.calls[0] ?? [];
    expect(routePath).toBe('/connect/tearleads.v1.MlsService/GetGroupMessages');
    expect(params?.fetchOptions?.method).toBe('POST');
    expect(params?.fetchOptions?.body).toBe(
      JSON.stringify({
        groupId: 'group 2',
        cursor: 'cursor-5',
        limit: 50
      })
    );
  });
});
