import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  abandonBlobDirectMock,
  attachBlobDirectMock,
  commitBlobDirectMock,
  deleteBlobDirectMock,
  getCrdtSyncDirectMock,
  deleteEmailDirectMock,
  getBlobDirectMock,
  getCrdtSnapshotDirectMock,
  getEmailDirectMock,
  getEmailsDirectMock,
  getMyKeysDirectMock,
  pushCrdtOpsDirectMock,
  reconcileCrdtDirectMock,
  runCrdtSessionDirectMock,
  stageBlobDirectMock,
  getSyncDirectMock,
  rekeyItemDirectMock,
  reconcileSyncDirectMock,
  registerDirectMock,
  sendEmailDirectMock,
  setupKeysDirectMock,
  uploadBlobChunkDirectMock
} = vi.hoisted(() => ({
  abandonBlobDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  attachBlobDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  commitBlobDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  deleteBlobDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getCrdtSyncDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  deleteEmailDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getBlobDirectMock:
    vi.fn<
      (
        request: unknown,
        context: unknown
      ) => Promise<{ data: Uint8Array; contentType?: string }>
    >(),
  getCrdtSnapshotDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getEmailDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getEmailsDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getMyKeysDirectMock:
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
    >(),
  pushCrdtOpsDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  reconcileCrdtDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  runCrdtSessionDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  stageBlobDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  getSyncDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  rekeyItemDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  reconcileSyncDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  registerDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  sendEmailDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  setupKeysDirectMock:
    vi.fn<
      (
        request: unknown,
        context: unknown
      ) => Promise<{ created: boolean }>
    >(),
  uploadBlobChunkDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>()
}));
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

type DirectJsonMock = {
  mockReset: () => void;
  mockResolvedValue: (value: { json: string }) => void;
  mock: {
    calls: unknown[][];
  };
};

type DirectJsonCallCase = {
  call: () => Promise<{ json: string }>;
  expectedRequest: unknown;
  mock: DirectJsonMock;
};

function createContext() {
  return {
    requestHeader: new Headers({
      authorization: 'Bearer token-1',
      'x-organization-id': 'org-1'
    })
  };
}

function resetDirectJsonMocks(): DirectJsonMock[] {
  return [
    abandonBlobDirectMock,
    attachBlobDirectMock,
    commitBlobDirectMock,
    getCrdtSyncDirectMock,
    deleteBlobDirectMock,
    deleteEmailDirectMock,
    getCrdtSnapshotDirectMock,
    getEmailDirectMock,
    getEmailsDirectMock,
    pushCrdtOpsDirectMock,
    reconcileCrdtDirectMock,
    runCrdtSessionDirectMock,
    stageBlobDirectMock,
    getSyncDirectMock,
    rekeyItemDirectMock,
    reconcileSyncDirectMock,
    registerDirectMock,
    sendEmailDirectMock,
    uploadBlobChunkDirectMock
  ];
}

describe('vfsConnectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getBlobDirectMock.mockReset();
    getBlobDirectMock.mockResolvedValue({
      data: new Uint8Array([7, 8, 9]),
      contentType: 'application/octet-stream'
    });

    for (const mock of resetDirectJsonMocks()) {
      mock.mockReset();
      mock.mockResolvedValue({ json: '{"ok":true}' });
    }

    getMyKeysDirectMock.mockReset();
    getMyKeysDirectMock.mockResolvedValue({
      publicEncryptionKey: 'pub-enc',
      publicSigningKey: 'pub-sign',
      encryptedPrivateKeys: 'enc-priv',
      argon2Salt: 'salt-1'
    });

    setupKeysDirectMock.mockReset();
    setupKeysDirectMock.mockResolvedValue({ created: true });
  });

  it('delegates direct methods to vfs direct handlers', async () => {
    const context = createContext();

    const getBlobRequest = { blobId: 'blob/1' };
    const setupKeysRequest = {
      publicEncryptionKey: 'e',
      publicSigningKey: 's',
      encryptedPrivateKeys: 'p',
      argon2Salt: 'salt'
    };
    const registerRequest = {
      json: '{"id":"item-1","objectType":"file","encryptedSessionKey":"enc"}'
    };
    const deleteBlobRequest = { blobId: 'blob-2' };
    const stageBlobRequest = {
      json: '{"blobId":"blob-3","expiresAt":"2099-01-01T00:00:00.000Z"}'
    };
    const uploadBlobChunkRequest = {
      stagingId: 'stage-1',
      json: '{"uploadId":"u1","chunkIndex":0,"isFinal":true,"nonce":"n","aadHash":"a","ciphertextBase64":"ZGF0YQ==","plaintextLength":4,"ciphertextLength":4}'
    };
    const attachBlobRequest = {
      stagingId: 'stage-2',
      json: '{"itemId":"item-attach"}'
    };
    const abandonBlobRequest = {
      stagingId: 'stage-3',
      json: '{}'
    };
    const commitBlobRequest = {
      stagingId: 'stage-4',
      json: '{"uploadId":"u1","keyEpoch":1,"manifestHash":"h","manifestSignature":"s","chunkCount":1,"totalPlaintextBytes":4,"totalCiphertextBytes":4}'
    };
    const rekeyItemRequest = {
      itemId: 'item-1',
      json: '{"reason":"manual","newEpoch":2,"wrappedKeys":[]}'
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
      json: '{"to":["a@example.com"],"subject":"Hi","body":"Hello"}'
    };
    const reconcileSyncRequest = {
      json: '{"clientId":"client-1","cursor":"MjAyNi0wMy0wM1QwMDowMDowMC4wMDBafGNoYW5nZS0x"}'
    };
    const pushCrdtOpsRequest = {
      organizationId: 'org-1',
      json: '{"clientId":"client-1","operations":[]}'
    };
    const reconcileCrdtRequest = {
      json: '{"clientId":"client-1","cursor":"MjAyNi0wMy0wM1QwMDowMDowMC4wMDBafGNoYW5nZS0x","lastReconciledWriteIds":{}}'
    };
    const runCrdtSessionRequest = {
      organizationId: 'org-1',
      json: '{"clientId":"client-1","operations":[],"cursor":"MjAyNi0wMy0wM1QwMDowMDowMC4wMDBafGNoYW5nZS0x","limit":10}'
    };

    const directCases: DirectJsonCallCase[] = [
      {
        call: () => vfsConnectService.register(registerRequest, context),
        expectedRequest: registerRequest,
        mock: registerDirectMock
      },
      {
        call: () => vfsConnectService.deleteBlob(deleteBlobRequest, context),
        expectedRequest: deleteBlobRequest,
        mock: deleteBlobDirectMock
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
      },
      {
        call: () => vfsConnectService.getEmails(getEmailsRequest, context),
        expectedRequest: getEmailsRequest,
        mock: getEmailsDirectMock
      },
      {
        call: () => vfsConnectService.getEmail(getEmailRequest, context),
        expectedRequest: getEmailRequest,
        mock: getEmailDirectMock
      },
      {
        call: () => vfsConnectService.deleteEmail(deleteEmailRequest, context),
        expectedRequest: deleteEmailRequest,
        mock: deleteEmailDirectMock
      },
      {
        call: () => vfsConnectService.sendEmail(sendEmailRequest, context),
        expectedRequest: sendEmailRequest,
        mock: sendEmailDirectMock
      }
    ];

    for (const testCase of directCases) {
      const response = await testCase.call();
      expect(response).toEqual({ json: '{"ok":true}' });
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
