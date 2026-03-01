import { describe, expect, it } from 'vitest';
import {
  createTestContext,
  useProxyFetchMock
} from './proxyServiceTestHelpers.js';
import { vfsConnectService } from './vfsService.js';
import { vfsSharesConnectService } from './vfsSharesService.js';

describe('vfs proxy services', () => {
  const { fetchMock, mockJsonResponse, expectLastFetch } = useProxyFetchMock();

  it('routes vfs service methods to expected legacy endpoints', async () => {
    const context = createTestContext();

    mockJsonResponse();
    await vfsConnectService.getMyKeys({}, context);
    expectLastFetch('http://127.0.0.1:55661/v1/vfs/keys/me', 'GET');

    mockJsonResponse();
    await vfsConnectService.setupKeys({ json: '{"k":1}' }, context);
    expectLastFetch('http://127.0.0.1:55661/v1/vfs/keys', 'POST', '{"k":1}');

    mockJsonResponse();
    await vfsConnectService.register({ json: '{"id":"i1"}' }, context);
    expectLastFetch(
      'http://127.0.0.1:55661/v1/vfs/register',
      'POST',
      '{"id":"i1"}'
    );

    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream'
        }
      })
    );
    const blobResponse = await vfsConnectService.getBlob(
      { blobId: 'blob/1' },
      context
    );
    expect(Array.from(blobResponse.data)).toEqual([7, 8, 9]);
    expect(blobResponse.contentType).toBe('application/octet-stream');
    expectLastFetch('http://127.0.0.1:55661/v1/vfs/blobs/blob%2F1', 'GET');

    const jsonCases = [
      {
        call: () => vfsConnectService.deleteBlob({ blobId: 'blob-1' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/blobs/blob-1',
        method: 'DELETE'
      },
      {
        call: () =>
          vfsConnectService.stageBlob({ json: '{"blobId":"b1"}' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/blobs/stage',
        method: 'POST',
        body: '{"blobId":"b1"}'
      },
      {
        call: () =>
          vfsConnectService.uploadBlobChunk(
            { stagingId: 'stage-1', json: '{"chunk":1}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/blobs/stage/stage-1/chunks',
        method: 'POST',
        body: '{"chunk":1}'
      },
      {
        call: () =>
          vfsConnectService.attachBlob(
            { stagingId: 'stage-2', json: '{"name":"f"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/blobs/stage/stage-2/attach',
        method: 'POST',
        body: '{"name":"f"}'
      },
      {
        call: () =>
          vfsConnectService.abandonBlob(
            { stagingId: 'stage-3', json: '{}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/blobs/stage/stage-3/abandon',
        method: 'POST',
        body: '{}'
      },
      {
        call: () =>
          vfsConnectService.commitBlob(
            { stagingId: 'stage-4', json: '{}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/blobs/stage/stage-4/commit',
        method: 'POST',
        body: '{}'
      },
      {
        call: () =>
          vfsConnectService.rekeyItem(
            { itemId: 'item-1', json: '{"encryptedSessionKey":"x"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/items/item-1/rekey',
        method: 'POST',
        body: '{"encryptedSessionKey":"x"}'
      },
      {
        call: () =>
          vfsConnectService.pushCrdtOps({ json: '{"ops":[]}' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/crdt/push',
        method: 'POST',
        body: '{"ops":[]}'
      },
      {
        call: () =>
          vfsConnectService.reconcileCrdt({ json: '{"cursor":"c"}' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/crdt/reconcile',
        method: 'POST',
        body: '{"cursor":"c"}'
      },
      {
        call: () =>
          vfsConnectService.reconcileSync({ json: '{"cursor":"s"}' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/sync/reconcile',
        method: 'POST',
        body: '{"cursor":"s"}'
      },
      {
        call: () =>
          vfsConnectService.runCrdtSession(
            { json: '{"clientId":"m"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/crdt/session',
        method: 'POST',
        body: '{"clientId":"m"}'
      },
      {
        call: () =>
          vfsConnectService.getSync(
            { cursor: 'sync-cursor', limit: 25, rootId: 'root-1' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/vfs-sync?cursor=sync-cursor&limit=25&rootId=root-1',
        method: 'GET'
      },
      {
        call: () =>
          vfsConnectService.getCrdtSync(
            { cursor: 'crdt-cursor', limit: 12, rootId: '' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/crdt/vfs-sync?cursor=crdt-cursor&limit=12',
        method: 'GET'
      },
      {
        call: () =>
          vfsConnectService.getCrdtSnapshot({ clientId: 'desktop' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/crdt/snapshot?clientId=desktop',
        method: 'GET'
      },
      {
        call: () =>
          vfsConnectService.getEmails({ offset: 10, limit: 30 }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/emails?offset=10&limit=30',
        method: 'GET'
      },
      {
        call: () => vfsConnectService.getEmail({ id: 'email-1' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/emails/email-1',
        method: 'GET'
      },
      {
        call: () => vfsConnectService.deleteEmail({ id: 'email-2' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/emails/email-2',
        method: 'DELETE'
      },
      {
        call: () =>
          vfsConnectService.sendEmail(
            { json: '{"to":["a@example.com"]}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/emails/send',
        method: 'POST',
        body: '{"to":["a@example.com"]}'
      }
    ];

    for (const testCase of jsonCases) {
      mockJsonResponse();
      await testCase.call();
      expectLastFetch(testCase.url, testCase.method, testCase.body);
    }
  });

  it('routes vfs shares service methods', async () => {
    const context = createTestContext();

    const cases = [
      {
        call: () =>
          vfsSharesConnectService.getItemShares({ itemId: 'item-1' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/items/item-1/shares',
        method: 'GET'
      },
      {
        call: () =>
          vfsSharesConnectService.createShare(
            { itemId: 'item-1', json: '{"targetId":"u1"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/items/item-1/shares',
        method: 'POST',
        body: '{"targetId":"u1"}'
      },
      {
        call: () =>
          vfsSharesConnectService.updateShare(
            { shareId: 'share-1', json: '{"permissionLevel":"view"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/shares/share-1',
        method: 'PATCH',
        body: '{"permissionLevel":"view"}'
      },
      {
        call: () =>
          vfsSharesConnectService.deleteShare({ shareId: 'share-2' }, context),
        url: 'http://127.0.0.1:55661/v1/vfs/shares/share-2',
        method: 'DELETE'
      },
      {
        call: () =>
          vfsSharesConnectService.createOrgShare(
            { itemId: 'item-2', json: '{"targetOrgId":"org-2"}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/items/item-2/org-shares',
        method: 'POST',
        body: '{"targetOrgId":"org-2"}'
      },
      {
        call: () =>
          vfsSharesConnectService.deleteOrgShare(
            { shareId: 'org-share-1' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/org-shares/org-share-1',
        method: 'DELETE'
      },
      {
        call: () =>
          vfsSharesConnectService.searchShareTargets(
            { q: 'ali', type: 'user' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/share-targets/search?q=ali&type=user',
        method: 'GET'
      },
      {
        call: () =>
          vfsSharesConnectService.getSharePolicyPreview(
            {
              rootItemId: 'root-1',
              principalType: 'user',
              principalId: 'user-1',
              limit: 50,
              cursor: 'cur-1',
              maxDepth: 4,
              q: 'note',
              objectType: ['folder', 'note']
            },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/vfs/share-policies/preview?rootItemId=root-1&principalType=user&principalId=user-1&limit=50&cursor=cur-1&maxDepth=4&q=note&objectType=folder%2Cnote',
        method: 'GET'
      }
    ];

    for (const testCase of cases) {
      mockJsonResponse();
      await testCase.call();
      expectLastFetch(testCase.url, testCase.method, testCase.body);
    }
  });

  it('omits optional query params for empty values in vfs and shares services', async () => {
    const context = createTestContext();

    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array([10]), { status: 200 }));
    const blobResponse = await vfsConnectService.getBlob(
      { blobId: 'blob-no-content-type' },
      context
    );
    expect(blobResponse.contentType).toBeUndefined();
    expectLastFetch(
      'http://127.0.0.1:55661/v1/vfs/blobs/blob-no-content-type',
      'GET'
    );

    mockJsonResponse();
    await vfsConnectService.getSync({ cursor: '', limit: 0, rootId: '  ' }, context);
    expectLastFetch('http://127.0.0.1:55661/v1/vfs/vfs-sync', 'GET');

    mockJsonResponse();
    await vfsConnectService.getCrdtSnapshot({ clientId: '' }, context);
    expectLastFetch('http://127.0.0.1:55661/v1/vfs/crdt/snapshot', 'GET');

    mockJsonResponse();
    await vfsConnectService.getEmails({ offset: -1, limit: 0 }, context);
    expectLastFetch('http://127.0.0.1:55661/v1/vfs/emails', 'GET');

    mockJsonResponse();
    await vfsSharesConnectService.getSharePolicyPreview(
      {
        rootItemId: '',
        principalType: '',
        principalId: '',
        limit: 0,
        cursor: ' ',
        maxDepth: 0,
        q: '',
        objectType: []
      },
      context
    );
    expectLastFetch('http://127.0.0.1:55661/v1/vfs/share-policies/preview', 'GET');
  });
});
