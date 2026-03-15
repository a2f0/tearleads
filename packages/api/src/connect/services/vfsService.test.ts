import { beforeEach, describe, expect, it, vi } from 'vitest';

const abandonBlobDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const attachBlobDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const commitBlobDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const deleteBlobDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<unknown>>();
const getCrdtSyncDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const deleteEmailDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<unknown>>();
const getBlobDirectMock =
  vi.fn<
    (
      request: unknown,
      context: unknown
    ) => Promise<{ data: Uint8Array; contentType?: string }>
  >();
const getCrdtSnapshotDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const getEmailDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<unknown>>();
const getEmailsDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<unknown>>();
const getMyKeysDirectMock =
  vi.fn<
    (
      request: unknown,
      context: unknown
    ) => Promise<{
      publicEncryptionKey: string;
      publicSigningKey: string;
      encryptedPrivateKeys?: string;
      argon2Salt?: string;
    }>
  >();
const pushCrdtOpsDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const reconcileCrdtDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const runCrdtSessionDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const stageBlobDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const getSyncDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const rekeyItemDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<unknown>>();
const reconcileSyncDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
const registerDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<unknown>>();
const sendEmailDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<unknown>>();
const setupKeysDirectMock =
  vi.fn<
    (request: unknown, context: unknown) => Promise<{ created: boolean }>
  >();
const uploadBlobChunkDirectMock =
  vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>();
vi.mock('./vfsDirectBlobs.js', () => ({
  deleteBlobDirect: (request: unknown, context: unknown) =>
    deleteBlobDirectMock(request, context),
  getBlobDirect: (request: unknown, context: unknown) =>
    getBlobDirectMock(request, context)
}));
vi.mock('./vfsDirectBlobAttach.js', () => ({
  attachBlobDirect: (request: unknown, context: unknown) =>
    attachBlobDirectMock(request, context)
}));
vi.mock('./vfsDirectBlobFinalize.js', () => ({
  abandonBlobDirect: (request: unknown, context: unknown) =>
    abandonBlobDirectMock(request, context),
  commitBlobDirect: (request: unknown, context: unknown) =>
    commitBlobDirectMock(request, context)
}));
vi.mock('./vfsDirectBlobStageUpload.js', () => ({
  stageBlobDirect: (request: unknown, context: unknown) =>
    stageBlobDirectMock(request, context),
  uploadBlobChunkDirect: (request: unknown, context: unknown) =>
    uploadBlobChunkDirectMock(request, context)
}));
vi.mock('./vfsDirectEmails.js', () => ({
  deleteEmailDirect: (request: unknown, context: unknown) =>
    deleteEmailDirectMock(request, context),
  getEmailDirect: (request: unknown, context: unknown) =>
    getEmailDirectMock(request, context),
  getEmailsDirect: (request: unknown, context: unknown) =>
    getEmailsDirectMock(request, context),
  sendEmailDirect: (request: unknown, context: unknown) =>
    sendEmailDirectMock(request, context)
}));
vi.mock('./vfsDirectKeys.js', () => ({
  getMyKeysDirect: (request: unknown, context: unknown) =>
    getMyKeysDirectMock(request, context),
  getUserSigningKeyDirect: () =>
    Promise.resolve({ userId: 'user-2', publicSigningKey: 'ed25519-pub' }),
  setupKeysDirect: (request: unknown, context: unknown) =>
    setupKeysDirectMock(request, context)
}));
vi.mock('./vfsDirectCrdtPush.js', () => ({
  pushCrdtOpsDirect: (request: unknown, context: unknown) =>
    pushCrdtOpsDirectMock(request, context)
}));
vi.mock('./vfsDirectCrdtReconcile.js', () => ({
  reconcileCrdtDirect: (request: unknown, context: unknown) =>
    reconcileCrdtDirectMock(request, context)
}));
vi.mock('./vfsDirectCrdtSession.js', () => ({
  runCrdtSessionDirect: (request: unknown, context: unknown) =>
    runCrdtSessionDirectMock(request, context)
}));
vi.mock('./vfsDirectRegistry.js', () => ({
  registerDirect: (request: unknown, context: unknown) =>
    registerDirectMock(request, context),
  rekeyItemDirect: (request: unknown, context: unknown) =>
    rekeyItemDirectMock(request, context)
}));
vi.mock('./vfsDirectSync.js', () => ({
  getCrdtSyncDirect: (request: unknown, context: unknown) =>
    getCrdtSyncDirectMock(request, context),
  getCrdtSnapshotDirect: (request: unknown, context: unknown) =>
    getCrdtSnapshotDirectMock(request, context),
  getSyncDirect: (request: unknown, context: unknown) =>
    getSyncDirectMock(request, context),
  reconcileSyncDirect: (request: unknown, context: unknown) =>
    reconcileSyncDirectMock(request, context)
}));

import { vfsConnectService } from './vfsService.js';

const directJsonMocks = [
  abandonBlobDirectMock,
  attachBlobDirectMock,
  commitBlobDirectMock,
  getCrdtSyncDirectMock,
  getCrdtSnapshotDirectMock,
  pushCrdtOpsDirectMock,
  reconcileCrdtDirectMock,
  runCrdtSessionDirectMock,
  stageBlobDirectMock,
  getSyncDirectMock,
  reconcileSyncDirectMock,
  uploadBlobChunkDirectMock
];

describe('vfsConnectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBlobDirectMock.mockReset();
    getBlobDirectMock.mockResolvedValue({
      data: new Uint8Array([7, 8, 9]),
      contentType: 'application/octet-stream'
    });
    for (const mock of directJsonMocks) {
      mock.mockReset();
      mock.mockResolvedValue({ json: '{"ok":true}' });
    }

    registerDirectMock.mockReset();
    registerDirectMock.mockResolvedValue({
      id: 'item-1',
      createdAt: '2026-03-03T00:00:00.000Z'
    });
    rekeyItemDirectMock.mockReset();
    rekeyItemDirectMock.mockResolvedValue({
      itemId: 'item-1',
      newEpoch: 2,
      wrapsApplied: 0
    });

    getMyKeysDirectMock.mockReset();
    getMyKeysDirectMock.mockResolvedValue({
      publicEncryptionKey: 'pub-enc',
      publicSigningKey: 'pub-sign',
      encryptedPrivateKeys: 'enc-priv',
      argon2Salt: 'salt-1'
    });

    setupKeysDirectMock.mockReset();
    setupKeysDirectMock.mockResolvedValue({ created: true });

    deleteBlobDirectMock.mockReset();
    deleteBlobDirectMock.mockResolvedValue({
      deleted: true,
      blobId: 'blob-2'
    });

    deleteEmailDirectMock.mockReset();
    deleteEmailDirectMock.mockResolvedValue({ success: true });

    sendEmailDirectMock.mockReset();
    sendEmailDirectMock.mockResolvedValue({
      success: true,
      messageId: 'msg-1'
    });

    getEmailsDirectMock.mockReset();
    getEmailsDirectMock.mockResolvedValue({ emails: [] });

    getEmailDirectMock.mockReset();
    getEmailDirectMock.mockResolvedValue({ id: 'email-1' });
  });

  it('delegates direct methods to vfs direct handlers', async () => {
    const context = {
      requestHeader: new Headers({
        authorization: 'Bearer token-1',
        'x-organization-id': 'org-1'
      })
    };

    const getBlobRequest = { blobId: 'blob/1' };
    const setupKeysRequest = {
      publicEncryptionKey: 'e',
      publicSigningKey: 's',
      encryptedPrivateKeys: 'p',
      argon2Salt: 'salt'
    };
    const registerRequest = {
      id: 'item-1',
      objectType: 'file',
      encryptedSessionKey: 'enc'
    };
    const deleteBlobRequest = { blobId: 'blob-2' };
    const stageBlobRequest = {
      blobId: 'blob-3',
      expiresAt: '2099-01-01T00:00:00.000Z'
    };
    const uploadBlobChunkRequest = {
      stagingId: 'stage-1',
      uploadId: 'u1',
      chunkIndex: 0,
      isFinal: true,
      nonce: 'n',
      aadHash: 'a',
      ciphertextBase64: 'ZGF0YQ==',
      plaintextLength: 4,
      ciphertextLength: 4
    };
    const attachBlobRequest = { stagingId: 'stage-2', itemId: 'item-attach' };
    const abandonBlobRequest = { stagingId: 'stage-3' };
    const commitBlobRequest = {
      stagingId: 'stage-4',
      uploadId: 'u1',
      keyEpoch: 1,
      manifestHash: 'h',
      manifestSignature: 's'
    };
    const rekeyItemRequest = {
      itemId: 'item-1',
      reason: 'manual',
      newEpoch: 2,
      wrappedKeys: []
    };
    const getSyncRequest = {
      cursor: 'sync-cursor',
      limit: 20,
      rootId: 'root-1'
    };
    const getCrdtSyncRequest = {
      cursor: 'crdt-cursor',
      limit: 12,
      rootId: 'root-1'
    };
    const getCrdtSnapshotRequest = { clientId: 'desktop-1' };
    const getEmailsRequest = { offset: 5, limit: 25 };
    const getEmailRequest = { id: 'email-1' };
    const deleteEmailRequest = { id: 'email-2' };
    const sendEmailRequest = {
      to: ['a@example.com'],
      subject: 'Hi',
      body: 'Hello'
    };
    const reconcileSyncRequest = {
      clientId: 'client-1',
      cursor: 'MjAyNi0wMy0wM1QwMDowMDowMC4wMDBafGNoYW5nZS0x'
    };
    const pushCrdtOpsRequest = {
      organizationId: 'org-1',
      clientId: 'client-1',
      operations: []
    };
    const reconcileCrdtRequest = {
      organizationId: 'org-1',
      clientId: 'client-1',
      cursor: 'MjAyNi0wMy0wM1QwMDowMDowMC4wMDBafGNoYW5nZS0x',
      lastReconciledWriteIds: {}
    };
    const runCrdtSessionRequest = {
      organizationId: 'org-1',
      clientId: 'client-1',
      operations: [],
      cursor: 'MjAyNi0wMy0wM1QwMDowMDowMC4wMDBafGNoYW5nZS0x',
      limit: 10,
      lastReconciledWriteIds: {}
    };
    const defaultDirectJsonResponse = { json: '{"ok":true}' };

    const directCases = [
      {
        call: () => vfsConnectService.register(registerRequest, context),
        expectedRequest: registerRequest,
        expectedResponse: {
          id: 'item-1',
          createdAt: '2026-03-03T00:00:00.000Z'
        },
        mock: registerDirectMock
      },
      {
        call: () => vfsConnectService.stageBlob(stageBlobRequest, context),
        expectedRequest: stageBlobRequest,
        mock: stageBlobDirectMock
      },
      {
        call: () =>
          vfsConnectService.uploadBlobChunk(uploadBlobChunkRequest, context),
        expectedRequest: uploadBlobChunkRequest,
        mock: uploadBlobChunkDirectMock
      },
      {
        call: () => vfsConnectService.attachBlob(attachBlobRequest, context),
        expectedRequest: attachBlobRequest,
        mock: attachBlobDirectMock
      },
      {
        call: () => vfsConnectService.abandonBlob(abandonBlobRequest, context),
        expectedRequest: abandonBlobRequest,
        mock: abandonBlobDirectMock
      },
      {
        call: () => vfsConnectService.commitBlob(commitBlobRequest, context),
        expectedRequest: commitBlobRequest,
        mock: commitBlobDirectMock
      },
      {
        call: () => vfsConnectService.rekeyItem(rekeyItemRequest, context),
        expectedRequest: rekeyItemRequest,
        expectedResponse: {
          itemId: 'item-1',
          newEpoch: 2,
          wrapsApplied: 0
        },
        mock: rekeyItemDirectMock
      },
      {
        call: () => vfsConnectService.getSync(getSyncRequest, context),
        expectedRequest: getSyncRequest,
        mock: getSyncDirectMock
      },
      {
        call: () => vfsConnectService.getCrdtSync(getCrdtSyncRequest, context),
        expectedRequest: getCrdtSyncRequest,
        mock: getCrdtSyncDirectMock
      },
      {
        call: () =>
          vfsConnectService.getCrdtSnapshot(getCrdtSnapshotRequest, context),
        expectedRequest: getCrdtSnapshotRequest,
        mock: getCrdtSnapshotDirectMock
      },
      {
        call: () =>
          vfsConnectService.reconcileSync(reconcileSyncRequest, context),
        expectedRequest: reconcileSyncRequest,
        mock: reconcileSyncDirectMock
      },
      {
        call: () => vfsConnectService.pushCrdtOps(pushCrdtOpsRequest, context),
        expectedRequest: pushCrdtOpsRequest,
        mock: pushCrdtOpsDirectMock
      },
      {
        call: () =>
          vfsConnectService.reconcileCrdt(reconcileCrdtRequest, context),
        expectedRequest: reconcileCrdtRequest,
        mock: reconcileCrdtDirectMock
      },
      {
        call: () =>
          vfsConnectService.runCrdtSession(runCrdtSessionRequest, context),
        expectedRequest: runCrdtSessionRequest,
        mock: runCrdtSessionDirectMock
      }
    ];

    for (const testCase of directCases) {
      const response = await testCase.call();
      expect(response).toEqual(
        testCase.expectedResponse ?? defaultDirectJsonResponse
      );
      expect(testCase.mock).toHaveBeenCalledWith(
        testCase.expectedRequest,
        context
      );
    }

    const getMyKeysResponse = await vfsConnectService.getMyKeys({}, context);
    expect(getMyKeysResponse).toEqual({
      publicEncryptionKey: 'pub-enc',
      publicSigningKey: 'pub-sign',
      encryptedPrivateKeys: 'enc-priv',
      argon2Salt: 'salt-1'
    });
    expect(getMyKeysDirectMock).toHaveBeenCalledWith({}, context);

    const setupKeysResponse = await vfsConnectService.setupKeys(
      setupKeysRequest,
      context
    );
    expect(setupKeysResponse).toEqual({ created: true });
    expect(setupKeysDirectMock).toHaveBeenCalledWith(setupKeysRequest, context);

    const deleteBlobResponse = await vfsConnectService.deleteBlob(
      deleteBlobRequest,
      context
    );
    expect(deleteBlobResponse).toEqual({
      deleted: true,
      blobId: 'blob-2'
    });
    expect(deleteBlobDirectMock).toHaveBeenCalledWith(
      deleteBlobRequest,
      context
    );

    const getEmailsResponse = await vfsConnectService.getEmails(
      getEmailsRequest,
      context
    );
    expect(getEmailsResponse).toEqual({ emails: [] });
    expect(getEmailsDirectMock).toHaveBeenCalledWith(getEmailsRequest, context);

    const getEmailResponse = await vfsConnectService.getEmail(
      getEmailRequest,
      context
    );
    expect(getEmailResponse).toEqual({ id: 'email-1' });
    expect(getEmailDirectMock).toHaveBeenCalledWith(getEmailRequest, context);

    const deleteEmailResponse = await vfsConnectService.deleteEmail(
      deleteEmailRequest,
      context
    );
    expect(deleteEmailResponse).toEqual({ success: true });
    expect(deleteEmailDirectMock).toHaveBeenCalledWith(
      deleteEmailRequest,
      context
    );

    const sendEmailResponse = await vfsConnectService.sendEmail(
      sendEmailRequest,
      context
    );
    expect(sendEmailResponse).toEqual({
      success: true,
      messageId: 'msg-1'
    });
    expect(sendEmailDirectMock).toHaveBeenCalledWith(sendEmailRequest, context);

    const getBlobResponse = await vfsConnectService.getBlob(
      getBlobRequest,
      context
    );
    expect(getBlobResponse).toEqual({
      data: new Uint8Array([7, 8, 9]),
      contentType: 'application/octet-stream'
    });
    expect(getBlobDirectMock).toHaveBeenCalledWith(getBlobRequest, context);
  });
});
