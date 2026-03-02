import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn()
}));

vi.mock('../apiCore', () => ({
  request: requestMock
}));

import { vfsRoutes } from './vfsRoutes';

describe('vfsRoutes', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({});
  });

  it('routes sync calls through Connect with expected request bodies', async () => {
    await vfsRoutes.getSync();
    await vfsRoutes.getSync('cursor-1', 25);
    await vfsRoutes.getCrdtSync();
    await vfsRoutes.getCrdtSync('cursor-2', 15);

    const [getSyncDefaultPath, getSyncDefaultParams] =
      requestMock.mock.calls[0] ?? [];
    const [getSyncCursorPath, getSyncCursorParams] =
      requestMock.mock.calls[1] ?? [];
    const [getCrdtDefaultPath, getCrdtDefaultParams] =
      requestMock.mock.calls[2] ?? [];
    const [getCrdtCursorPath, getCrdtCursorParams] =
      requestMock.mock.calls[3] ?? [];

    expect(getSyncDefaultPath).toBe('/connect/tearleads.v1.VfsService/GetSync');
    expect(getSyncDefaultParams?.fetchOptions?.body).toBe(
      JSON.stringify({ limit: 500 })
    );

    expect(getSyncCursorPath).toBe('/connect/tearleads.v1.VfsService/GetSync');
    expect(getSyncCursorParams?.fetchOptions?.body).toBe(
      JSON.stringify({ limit: 25, cursor: 'cursor-1' })
    );

    expect(getCrdtDefaultPath).toBe(
      '/connect/tearleads.v1.VfsService/GetCrdtSync'
    );
    expect(getCrdtDefaultParams?.fetchOptions?.body).toBe(
      JSON.stringify({ limit: 500 })
    );

    expect(getCrdtCursorPath).toBe(
      '/connect/tearleads.v1.VfsService/GetCrdtSync'
    );
    expect(getCrdtCursorParams?.fetchOptions?.body).toBe(
      JSON.stringify({ limit: 15, cursor: 'cursor-2' })
    );
  });

  it('routes share-target search through Connect', async () => {
    await vfsRoutes.searchShareTargets('alice');
    await vfsRoutes.searchShareTargets('bob', 'user');

    const [defaultPath, defaultParams] = requestMock.mock.calls[0] ?? [];
    const [typedPath, typedParams] = requestMock.mock.calls[1] ?? [];

    expect(defaultPath).toBe(
      '/connect/tearleads.v1.VfsSharesService/SearchShareTargets'
    );
    expect(defaultParams?.fetchOptions?.body).toBe(JSON.stringify({ q: 'alice' }));

    expect(typedPath).toBe(
      '/connect/tearleads.v1.VfsSharesService/SearchShareTargets'
    );
    expect(typedParams?.fetchOptions?.body).toBe(
      JSON.stringify({ q: 'bob', type: 'user' })
    );
  });

  it('routes share policy preview through Connect with optional filters', async () => {
    await vfsRoutes.getSharePolicyPreview({
      rootItemId: 'root-1',
      principalType: 'user',
      principalId: 'user-1',
      objectType: [],
      maxDepth: null
    });

    await vfsRoutes.getSharePolicyPreview({
      rootItemId: 'root-2',
      principalType: 'group',
      principalId: 'group-1',
      limit: 20,
      cursor: 'cursor-2',
      maxDepth: 4,
      q: 'budget',
      objectType: ['folder', 'file']
    });

    const [baselinePath, baselineParams] = requestMock.mock.calls[0] ?? [];
    const [fullPath, fullParams] = requestMock.mock.calls[1] ?? [];

    expect(baselinePath).toBe(
      '/connect/tearleads.v1.VfsSharesService/GetSharePolicyPreview'
    );
    expect(baselineParams?.fetchOptions?.body).toBe(
      JSON.stringify({
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'user-1'
      })
    );

    expect(fullPath).toBe(
      '/connect/tearleads.v1.VfsSharesService/GetSharePolicyPreview'
    );
    expect(fullParams?.fetchOptions?.body).toBe(
      JSON.stringify({
        rootItemId: 'root-2',
        principalType: 'group',
        principalId: 'group-1',
        limit: 20,
        cursor: 'cursor-2',
        maxDepth: 4,
        q: 'budget',
        objectType: ['folder', 'file']
      })
    );
  });
});
