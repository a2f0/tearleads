import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock, requestResponseMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  requestResponseMock: vi.fn()
}));

vi.mock('../apiCore', () => ({
  request: requestMock,
  requestResponse: requestResponseMock
}));

import { vfsRoutes } from './vfsRoutes';

function parseQuery(pathWithQuery: string): URLSearchParams {
  const [, query = ''] = pathWithQuery.split('?');
  return new URLSearchParams(query);
}

describe('vfsRoutes', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestResponseMock.mockReset();
    requestMock.mockResolvedValue({});
  });

  it('builds sync endpoints for default and explicit cursor pagination', async () => {
    await vfsRoutes.getSync();
    await vfsRoutes.getSync('cursor-1', 25);
    await vfsRoutes.getCrdtSync();
    await vfsRoutes.getCrdtSync('cursor-2', 15);

    const getSyncDefaultPath = requestMock.mock.calls[0]?.[0];
    const getSyncCursorPath = requestMock.mock.calls[1]?.[0];
    const getCrdtDefaultPath = requestMock.mock.calls[2]?.[0];
    const getCrdtCursorPath = requestMock.mock.calls[3]?.[0];

    expect(getSyncDefaultPath).toBe('/vfs/vfs-sync?limit=500');
    expect(getSyncCursorPath).toBe('/vfs/vfs-sync?limit=25&cursor=cursor-1');
    expect(getCrdtDefaultPath).toBe('/vfs/crdt/vfs-sync?limit=500');
    expect(getCrdtCursorPath).toBe(
      '/vfs/crdt/vfs-sync?limit=15&cursor=cursor-2'
    );
  });

  it('adds optional share-target type only when provided', async () => {
    await vfsRoutes.searchShareTargets('alice');
    await vfsRoutes.searchShareTargets('bob', 'user');

    const defaultPath = requestMock.mock.calls[0]?.[0];
    const typedPath = requestMock.mock.calls[1]?.[0];
    if (typeof defaultPath !== 'string' || typeof typedPath !== 'string') {
      throw new Error('expected searchShareTargets paths');
    }

    const defaultQuery = parseQuery(defaultPath);
    const typedQuery = parseQuery(typedPath);

    expect(defaultPath.startsWith('/vfs/share-targets/search?')).toBe(true);
    expect(defaultQuery.get('q')).toBe('alice');
    expect(defaultQuery.get('type')).toBeNull();

    expect(typedPath.startsWith('/vfs/share-targets/search?')).toBe(true);
    expect(typedQuery.get('q')).toBe('bob');
    expect(typedQuery.get('type')).toBe('user');
  });

  it('builds share policy preview query params for optional filters', async () => {
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

    const baselinePath = requestMock.mock.calls[0]?.[0];
    const fullPath = requestMock.mock.calls[1]?.[0];
    if (typeof baselinePath !== 'string' || typeof fullPath !== 'string') {
      throw new Error('expected share policy preview paths');
    }

    const baselineQuery = parseQuery(baselinePath);
    const fullQuery = parseQuery(fullPath);

    expect(baselineQuery.get('rootItemId')).toBe('root-1');
    expect(baselineQuery.get('principalType')).toBe('user');
    expect(baselineQuery.get('principalId')).toBe('user-1');
    expect(baselineQuery.get('limit')).toBeNull();
    expect(baselineQuery.get('cursor')).toBeNull();
    expect(baselineQuery.get('maxDepth')).toBeNull();
    expect(baselineQuery.get('q')).toBeNull();
    expect(baselineQuery.get('objectType')).toBeNull();

    expect(fullQuery.get('rootItemId')).toBe('root-2');
    expect(fullQuery.get('principalType')).toBe('group');
    expect(fullQuery.get('principalId')).toBe('group-1');
    expect(fullQuery.get('limit')).toBe('20');
    expect(fullQuery.get('cursor')).toBe('cursor-2');
    expect(fullQuery.get('maxDepth')).toBe('4');
    expect(fullQuery.get('q')).toBe('budget');
    expect(fullQuery.get('objectType')).toBe('folder,file');
  });
});
