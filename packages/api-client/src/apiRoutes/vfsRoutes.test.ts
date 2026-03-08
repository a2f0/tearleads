import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn()
}));

vi.mock('../apiCore', () => ({
  request: requestMock
}));

import { vfsRoutes } from './vfsRoutes';

describe('vfsRoutes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

    expect(getSyncDefaultPath).toBe('/connect/tearleads.v2.VfsService/GetSync');
    expect(getSyncDefaultParams?.fetchOptions?.body).toBe(
      JSON.stringify({ limit: 500 })
    );

    expect(getSyncCursorPath).toBe('/connect/tearleads.v2.VfsService/GetSync');
    expect(getSyncCursorParams?.fetchOptions?.body).toBe(
      JSON.stringify({ limit: 25, cursor: 'cursor-1' })
    );

    expect(getCrdtDefaultPath).toBe(
      '/connect/tearleads.v2.VfsService/GetCrdtSync'
    );
    expect(getCrdtDefaultParams?.fetchOptions?.body).toBe(
      JSON.stringify({ limit: 500 })
    );

    expect(getCrdtCursorPath).toBe(
      '/connect/tearleads.v2.VfsService/GetCrdtSync'
    );
    expect(getCrdtCursorParams?.fetchOptions?.body).toBe(
      JSON.stringify({ limit: 15, cursor: 'cursor-2' })
    );
  });

  it('returns typed GetSync responses directly', async () => {
    requestMock.mockResolvedValueOnce({
      items: [],
      nextCursor: null,
      hasMore: false
    });

    await expect(vfsRoutes.getSync()).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false
    });
  });

  it('normalizes omitted sync pagination defaults from connect responses', async () => {
    requestMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        lastReconciledWriteIds: {
          desktop: 4,
          mobile: 0,
          '  ': 2
        }
      });

    await expect(vfsRoutes.getSync()).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false
    });

    await expect(vfsRoutes.getCrdtSync()).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {
        desktop: 4
      }
    });
  });

  it('returns typed GetCrdtSync responses directly', async () => {
    requestMock.mockResolvedValueOnce({
      items: [
        {
          opId: 'desktop-1',
          itemId: 'item-1',
          opType: 'acl_add',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read',
          parentId: null,
          childId: null,
          actorId: 'user-1',
          sourceTable: 'vfs_crdt_client_push',
          sourceId: 'user-1:desktop:1:desktop-1',
          occurredAt: '2026-03-08T00:00:00.000Z'
        }
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {
        desktop: 1
      }
    });

    await expect(vfsRoutes.getCrdtSync()).resolves.toEqual({
      items: [
        expect.objectContaining({
          opId: 'desktop-1',
          itemId: 'item-1',
          opType: 'acl_add'
        })
      ],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {
        desktop: 1
      }
    });
  });

  it('accepts direct connect payloads for sync and share routes', async () => {
    requestMock
      .mockResolvedValueOnce({
        items: [{ itemId: 'note-1' }],
        hasMore: true,
        nextCursor: 'cursor-1'
      })
      .mockResolvedValueOnce({
        items: [{ itemId: 'note-1', opType: 'item_upsert' }],
        hasMore: false,
        nextCursor: null,
        lastReconciledWriteIds: {
          desktop: 3
        }
      })
      .mockResolvedValueOnce({
        targets: [
          {
            id: 'user-1',
            type: 'user',
            displayName: 'Alice'
          }
        ]
      });

    await expect(vfsRoutes.getSync()).resolves.toEqual({
      items: [{ itemId: 'note-1' }],
      nextCursor: 'cursor-1',
      hasMore: true
    });

    await expect(vfsRoutes.getCrdtSync()).resolves.toEqual({
      items: [{ itemId: 'note-1', opType: 'item_upsert' }],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {
        desktop: 3
      }
    });

    await expect(vfsRoutes.searchShareTargets('alice')).resolves.toEqual({
      targets: [
        {
          id: 'user-1',
          type: 'user',
          displayName: 'Alice'
        }
      ]
    });
  });

  it('routes share-target search through Connect', async () => {
    await vfsRoutes.searchShareTargets('alice');
    await vfsRoutes.searchShareTargets('bob', 'user');

    const [defaultPath, defaultParams] = requestMock.mock.calls[0] ?? [];
    const [typedPath, typedParams] = requestMock.mock.calls[1] ?? [];

    expect(defaultPath).toBe(
      '/connect/tearleads.v2.VfsSharesService/SearchShareTargets'
    );
    expect(defaultParams?.fetchOptions?.body).toBe(
      JSON.stringify({ q: 'alice' })
    );

    expect(typedPath).toBe(
      '/connect/tearleads.v2.VfsSharesService/SearchShareTargets'
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
      '/connect/tearleads.v2.VfsSharesService/GetSharePolicyPreview'
    );
    expect(baselineParams?.fetchOptions?.body).toBe(
      JSON.stringify({
        rootItemId: 'root-1',
        principalType: 'user',
        principalId: 'user-1'
      })
    );

    expect(fullPath).toBe(
      '/connect/tearleads.v2.VfsSharesService/GetSharePolicyPreview'
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

  it('requests GetMyKeys with typed response payload', async () => {
    requestMock.mockResolvedValueOnce({
      publicEncryptionKey: 'enc-key',
      publicSigningKey: 'sign-key',
      encryptedPrivateKeys: 'private-keys',
      argon2Salt: 'salt-1'
    });

    await expect(vfsRoutes.getMyKeys()).resolves.toEqual({
      publicEncryptionKey: 'enc-key',
      publicSigningKey: 'sign-key',
      encryptedPrivateKeys: 'private-keys',
      argon2Salt: 'salt-1'
    });

    const [path, params] = requestMock.mock.calls[0] ?? [];
    expect(path).toBe('/connect/tearleads.v2.VfsService/GetMyKeys');
    expect(params?.fetchOptions?.body).toBe(JSON.stringify({}));
  });

  it('sends typed SetupKeys request and returns created flag', async () => {
    requestMock.mockResolvedValueOnce({ created: true });

    await expect(
      vfsRoutes.setupKeys({
        publicEncryptionKey: 'enc',
        publicSigningKey: 'sign',
        encryptedPrivateKeys: 'priv',
        argon2Salt: 'salt'
      })
    ).resolves.toEqual({ created: true });

    const [path, params] = requestMock.mock.calls[0] ?? [];
    expect(path).toBe('/connect/tearleads.v2.VfsService/SetupKeys');
    expect(params?.fetchOptions?.body).toBe(
      JSON.stringify({
        publicEncryptionKey: 'enc',
        publicSigningKey: 'sign',
        encryptedPrivateKeys: 'priv',
        argon2Salt: 'salt'
      })
    );
  });

  it('routes register and rekey through typed Connect responses', async () => {
    requestMock
      .mockResolvedValueOnce({
        id: 'item-1',
        createdAt: '2026-03-03T00:00:00.000Z'
      })
      .mockResolvedValueOnce({
        itemId: 'item-1',
        newEpoch: 3,
        wrapsApplied: 2
      });

    await expect(
      vfsRoutes.register({
        id: 'item-1',
        objectType: 'file',
        encryptedSessionKey: 'enc'
      })
    ).resolves.toEqual({
      id: 'item-1',
      createdAt: '2026-03-03T00:00:00.000Z'
    });
    await expect(
      vfsRoutes.rekeyItem('item-1', {
        reason: 'manual',
        newEpoch: 3,
        wrappedKeys: []
      })
    ).resolves.toEqual({
      itemId: 'item-1',
      newEpoch: 3,
      wrapsApplied: 2
    });

    const [registerPath, registerParams] = requestMock.mock.calls[0] ?? [];
    const [rekeyPath, rekeyParams] = requestMock.mock.calls[1] ?? [];
    expect(registerPath).toBe('/connect/tearleads.v2.VfsService/Register');
    expect(registerParams?.fetchOptions?.body).toBe(
      JSON.stringify({
        json: JSON.stringify({
          id: 'item-1',
          objectType: 'file',
          encryptedSessionKey: 'enc'
        })
      })
    );
    expect(rekeyPath).toBe('/connect/tearleads.v2.VfsService/RekeyItem');
    expect(rekeyParams?.fetchOptions?.body).toBe(
      JSON.stringify({
        itemId: 'item-1',
        json: JSON.stringify({
          reason: 'manual',
          newEpoch: 3,
          wrappedKeys: []
        })
      })
    );
  });

  it('decodes blob responses from array and base64 payloads', async () => {
    requestMock.mockResolvedValueOnce({
      data: [65, 66, 67],
      contentType: 'text/plain'
    });
    requestMock.mockResolvedValueOnce({
      data: 'encoded',
      contentType: undefined
    });

    const atobMock = vi.fn(() => 'XYZ');
    vi.stubGlobal('atob', atobMock);

    const arrayBlob = await vfsRoutes.getBlob('blob-array');
    const encodedBlob = await vfsRoutes.getBlob('blob-encoded');

    expect(Array.from(arrayBlob.data)).toEqual([65, 66, 67]);
    expect(arrayBlob.contentType).toBe('text/plain');
    expect(Array.from(encodedBlob.data)).toEqual([88, 89, 90]);
    expect(encodedBlob.contentType).toBeNull();
    expect(atobMock).toHaveBeenCalledWith('encoded');

    const [arrayPath, arrayParams] = requestMock.mock.calls[0] ?? [];
    const [encodedPath, encodedParams] = requestMock.mock.calls[1] ?? [];
    expect(arrayPath).toBe('/connect/tearleads.v2.VfsService/GetBlob');
    expect(arrayParams?.fetchOptions?.body).toBe(
      JSON.stringify({ blobId: 'blob-array' })
    );
    expect(encodedPath).toBe('/connect/tearleads.v2.VfsService/GetBlob');
    expect(encodedParams?.fetchOptions?.body).toBe(
      JSON.stringify({ blobId: 'blob-encoded' })
    );
  });

  it('returns empty blob data when payload is empty and throws without atob', async () => {
    requestMock.mockResolvedValueOnce({ data: '', contentType: undefined });

    const emptyBlob = await vfsRoutes.getBlob('blob-empty');
    expect(Array.from(emptyBlob.data)).toEqual([]);
    expect(emptyBlob.contentType).toBeNull();

    requestMock.mockResolvedValueOnce({
      data: 'QQ==',
      contentType: 'text/plain'
    });
    vi.stubGlobal('atob', undefined);

    await expect(vfsRoutes.getBlob('blob-error')).rejects.toThrow(
      'Unable to decode blob payload'
    );
  });

  it('routes deleteBlob through Connect and returns typed payload', async () => {
    requestMock.mockResolvedValueOnce({
      deleted: true,
      blobId: 'blob-1'
    });

    await expect(vfsRoutes.deleteBlob('blob-1')).resolves.toEqual({
      deleted: true,
      blobId: 'blob-1'
    });

    const [path, params] = requestMock.mock.calls[0] ?? [];
    expect(path).toBe('/connect/tearleads.v2.VfsService/DeleteBlob');
    expect(params?.fetchOptions?.body).toBe(
      JSON.stringify({ blobId: 'blob-1' })
    );
  });
});
