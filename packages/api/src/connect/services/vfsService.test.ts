import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  abandonBlobDirectMock,
  attachBlobDirectMock,
  callRouteJsonHandlerMock,
  commitBlobDirectMock,
  deleteBlobDirectMock,
  deleteEmailDirectMock,
  getBlobDirectMock,
  getCrdtSnapshotDirectMock,
  getEmailDirectMock,
  getEmailsDirectMock,
  getMyKeysDirectMock,
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
  callRouteJsonHandlerMock: vi.fn<(options: unknown) => Promise<string>>(),
  commitBlobDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  deleteBlobDirectMock:
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
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>(),
  uploadBlobChunkDirectMock:
    vi.fn<(request: unknown, context: unknown) => Promise<{ json: string }>>()
}));

vi.mock('./legacyRouteProxy.js', async () => {
  const actual = await vi.importActual<typeof import('./legacyRouteProxy.js')>(
    './legacyRouteProxy.js'
  );

  return {
    ...actual,
    callRouteJsonHandler: callRouteJsonHandlerMock
  };
});

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

vi.mock('./vfsDirectRegistry.js', () => ({
  registerDirect: (request: unknown, context: unknown) =>
    registerDirectMock(request, context),
  rekeyItemDirect: (request: unknown, context: unknown) =>
    rekeyItemDirectMock(request, context)
}));

vi.mock('./vfsDirectSync.js', () => ({
  getCrdtSnapshotDirect: (request: unknown, context: unknown) =>
    getCrdtSnapshotDirectMock(request, context),
  getSyncDirect: (request: unknown, context: unknown) =>
    getSyncDirectMock(request, context),
  reconcileSyncDirect: (request: unknown, context: unknown) =>
    reconcileSyncDirectMock(request, context)
}));

import { vfsConnectService } from './vfsService.js';

type JsonCallExpectation = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  jsonBody?: string;
  query?: string;
};

type JsonCallCase = JsonCallExpectation & {
  call: () => Promise<{ json: string }>;
};

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

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function expectLastJsonCall(
  context: ReturnType<typeof createContext>,
  expectation: JsonCallExpectation
): void {
  const call = callRouteJsonHandlerMock.mock.calls.at(-1);
  if (!call) {
    throw new Error('Expected callRouteJsonHandler to be called');
  }

  const [options] = call;
  if (!isUnknownRecord(options)) {
    throw new Error('Expected options object');
  }
  expect(options['context']).toBe(context);
  expect(options['method']).toBe(expectation.method);
  expect(options['path']).toBe(expectation.path);

  if (expectation.jsonBody === undefined) {
    expect(options['jsonBody']).toBeUndefined();
  } else {
    expect(options['jsonBody']).toBe(expectation.jsonBody);
  }

  const query = options['query'];
  if (query !== undefined && !(query instanceof URLSearchParams)) {
    throw new Error('Expected query to be URLSearchParams when present');
  }

  expect(query?.toString() ?? '').toBe(expectation.query ?? '');
}

function resetDirectJsonMocks(): DirectJsonMock[] {
  return [
    abandonBlobDirectMock,
    attachBlobDirectMock,
    commitBlobDirectMock,
    deleteBlobDirectMock,
    deleteEmailDirectMock,
    getCrdtSnapshotDirectMock,
    getEmailDirectMock,
    getEmailsDirectMock,
    getMyKeysDirectMock,
    stageBlobDirectMock,
    getSyncDirectMock,
    rekeyItemDirectMock,
    reconcileSyncDirectMock,
    registerDirectMock,
    sendEmailDirectMock,
    setupKeysDirectMock,
    uploadBlobChunkDirectMock
  ];
}

describe('vfsConnectService', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    callRouteJsonHandlerMock.mockReset();
    callRouteJsonHandlerMock.mockResolvedValue('{"ok":true}');

    getBlobDirectMock.mockReset();
    getBlobDirectMock.mockResolvedValue({
      data: new Uint8Array([7, 8, 9]),
      contentType: 'application/octet-stream'
    });

    for (const mock of resetDirectJsonMocks()) {
      mock.mockReset();
      mock.mockResolvedValue({ json: '{"ok":true}' });
    }
  });

  it('delegates direct methods to vfs direct handlers', async () => {
    const context = createContext();

    const getBlobRequest = { blobId: 'blob/1' };
    const setupKeysRequest = {
      json: '{"publicEncryptionKey":"e","publicSigningKey":"s","encryptedPrivateKeys":"p","argon2Salt":"salt"}'
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

    const directCases: DirectJsonCallCase[] = [
      {
        call: () => vfsConnectService.getMyKeys({}, context),
        expectedRequest: {},
        mock: getMyKeysDirectMock
      },
      {
        call: () => vfsConnectService.setupKeys(setupKeysRequest, context),
        expectedRequest: setupKeysRequest,
        mock: setupKeysDirectMock
      },
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

    const getBlobResponse = await vfsConnectService.getBlob(
      getBlobRequest,
      context
    );
    expect(getBlobResponse).toEqual({
      data: new Uint8Array([7, 8, 9]),
      contentType: 'application/octet-stream'
    });
    expect(getBlobDirectMock).toHaveBeenCalledWith(getBlobRequest, context);

    expect(callRouteJsonHandlerMock).not.toHaveBeenCalled();
  });

  it('routes remaining CRDT methods through legacy route handlers', async () => {
    const context = createContext();

    const cases: JsonCallCase[] = [
      {
        call: () =>
          vfsConnectService.pushCrdtOps({ json: '{"ops":[]}' }, context),
        method: 'POST',
        path: '/vfs/crdt/push',
        jsonBody: '{"ops":[]}'
      },
      {
        call: () =>
          vfsConnectService.reconcileCrdt(
            {
              json: '{"cursor":"c"}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/crdt/reconcile',
        jsonBody: '{"cursor":"c"}'
      },
      {
        call: () =>
          vfsConnectService.runCrdtSession(
            {
              json: '{"clientId":"m"}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/crdt/session',
        jsonBody: '{"clientId":"m"}'
      },
      {
        call: () =>
          vfsConnectService.getCrdtSync(
            {
              cursor: 'crdt-cursor',
              limit: 12,
              rootId: ''
            },
            context
          ),
        method: 'GET',
        path: '/vfs/crdt/vfs-sync',
        query: 'cursor=crdt-cursor&limit=12'
      }
    ];

    for (const testCase of cases) {
      const response = await testCase.call();
      expect(response).toEqual({ json: '{"ok":true}' });
      expectLastJsonCall(context, testCase);
    }
  });

  it('omits optional query params for empty getCrdtSync values', async () => {
    const context = createContext();

    await vfsConnectService.getCrdtSync(
      {
        cursor: '',
        limit: 0,
        rootId: ' '
      },
      context
    );

    expectLastJsonCall(context, {
      method: 'GET',
      path: '/vfs/crdt/vfs-sync'
    });
  });
});
