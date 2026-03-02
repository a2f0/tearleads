import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callRouteBinaryHandlerMock, callRouteJsonHandlerMock } = vi.hoisted(
  () => ({
    callRouteJsonHandlerMock: vi.fn<(options: unknown) => Promise<string>>(),
    callRouteBinaryHandlerMock:
      vi.fn<
        (
          options: unknown
        ) => Promise<{ data: Uint8Array; contentType?: string }>
      >()
  })
);

vi.mock('./legacyRouteProxy.js', async () => {
  const actual = await vi.importActual<typeof import('./legacyRouteProxy.js')>(
    './legacyRouteProxy.js'
  );

  return {
    ...actual,
    callRouteJsonHandler: callRouteJsonHandlerMock,
    callRouteBinaryHandler: callRouteBinaryHandlerMock
  };
});

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

type BinaryCallExpectation = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
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

function expectLastBinaryCall(
  context: ReturnType<typeof createContext>,
  expectation: BinaryCallExpectation
): void {
  const call = callRouteBinaryHandlerMock.mock.calls.at(-1);
  if (!call) {
    throw new Error('Expected callRouteBinaryHandler to be called');
  }

  const [options] = call;
  expect(options).toEqual({
    context,
    method: expectation.method,
    path: expectation.path
  });
}

describe('vfsConnectService', () => {
  beforeEach(() => {
    callRouteJsonHandlerMock.mockReset();
    callRouteBinaryHandlerMock.mockReset();
    callRouteJsonHandlerMock.mockResolvedValue('{"ok":true}');
    callRouteBinaryHandlerMock.mockResolvedValue({
      data: new Uint8Array([7, 8, 9]),
      contentType: 'application/octet-stream'
    });
  });

  it('routes blob reads through the binary handler', async () => {
    const context = createContext();

    const response = await vfsConnectService.getBlob(
      {
        blobId: 'blob/1'
      },
      context
    );

    expect(response).toEqual({
      data: new Uint8Array([7, 8, 9]),
      contentType: 'application/octet-stream'
    });

    expectLastBinaryCall(context, {
      method: 'GET',
      path: '/vfs/blobs/blob%2F1'
    });
  });

  it('omits content type when binary response does not provide one', async () => {
    const context = createContext();
    callRouteBinaryHandlerMock.mockResolvedValueOnce({
      data: new Uint8Array([10])
    });

    const response = await vfsConnectService.getBlob(
      {
        blobId: 'blob-no-content-type'
      },
      context
    );

    expect(response).toEqual({
      data: new Uint8Array([10])
    });

    expectLastBinaryCall(context, {
      method: 'GET',
      path: '/vfs/blobs/blob-no-content-type'
    });
  });

  it('routes vfs json handlers to the expected route handlers', async () => {
    const context = createContext();

    const cases: JsonCallCase[] = [
      {
        call: () => vfsConnectService.getMyKeys({}, context),
        method: 'GET',
        path: '/vfs/keys/me'
      },
      {
        call: () => vfsConnectService.setupKeys({ json: '{"k":1}' }, context),
        method: 'POST',
        path: '/vfs/keys',
        jsonBody: '{"k":1}'
      },
      {
        call: () =>
          vfsConnectService.register({ json: '{"id":"i1"}' }, context),
        method: 'POST',
        path: '/vfs/register',
        jsonBody: '{"id":"i1"}'
      },
      {
        call: () => vfsConnectService.deleteBlob({ blobId: 'blob-1' }, context),
        method: 'DELETE',
        path: '/vfs/blobs/blob-1'
      },
      {
        call: () =>
          vfsConnectService.stageBlob({ json: '{"blobId":"b1"}' }, context),
        method: 'POST',
        path: '/vfs/blobs/stage',
        jsonBody: '{"blobId":"b1"}'
      },
      {
        call: () =>
          vfsConnectService.uploadBlobChunk(
            {
              stagingId: 'stage-1',
              json: '{"chunk":1}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/blobs/stage/stage-1/chunks',
        jsonBody: '{"chunk":1}'
      },
      {
        call: () =>
          vfsConnectService.attachBlob(
            {
              stagingId: 'stage-2',
              json: '{"name":"f"}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/blobs/stage/stage-2/attach',
        jsonBody: '{"name":"f"}'
      },
      {
        call: () =>
          vfsConnectService.abandonBlob(
            {
              stagingId: 'stage-3',
              json: '{}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/blobs/stage/stage-3/abandon',
        jsonBody: '{}'
      },
      {
        call: () =>
          vfsConnectService.commitBlob(
            {
              stagingId: 'stage-4',
              json: '{}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/blobs/stage/stage-4/commit',
        jsonBody: '{}'
      },
      {
        call: () =>
          vfsConnectService.rekeyItem(
            {
              itemId: 'item-1',
              json: '{"encryptedSessionKey":"x"}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/items/item-1/rekey',
        jsonBody: '{"encryptedSessionKey":"x"}'
      },
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
          vfsConnectService.reconcileSync(
            {
              json: '{"cursor":"s"}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/sync/reconcile',
        jsonBody: '{"cursor":"s"}'
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
          vfsConnectService.getSync(
            {
              cursor: 'sync-cursor',
              limit: 25,
              rootId: 'root-1'
            },
            context
          ),
        method: 'GET',
        path: '/vfs/vfs-sync',
        query: 'cursor=sync-cursor&limit=25&rootId=root-1'
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
      },
      {
        call: () =>
          vfsConnectService.getCrdtSnapshot(
            {
              clientId: 'desktop'
            },
            context
          ),
        method: 'GET',
        path: '/vfs/crdt/snapshot',
        query: 'clientId=desktop'
      },
      {
        call: () =>
          vfsConnectService.getEmails(
            {
              offset: 10,
              limit: 30
            },
            context
          ),
        method: 'GET',
        path: '/vfs/emails',
        query: 'offset=10&limit=30'
      },
      {
        call: () => vfsConnectService.getEmail({ id: 'email-1' }, context),
        method: 'GET',
        path: '/vfs/emails/email-1'
      },
      {
        call: () => vfsConnectService.deleteEmail({ id: 'email-2' }, context),
        method: 'DELETE',
        path: '/vfs/emails/email-2'
      },
      {
        call: () =>
          vfsConnectService.sendEmail(
            {
              json: '{"to":["a@example.com"]}'
            },
            context
          ),
        method: 'POST',
        path: '/vfs/emails/send',
        jsonBody: '{"to":["a@example.com"]}'
      }
    ];

    for (const testCase of cases) {
      const response = await testCase.call();
      expect(response).toEqual({ json: '{"ok":true}' });
      expectLastJsonCall(context, testCase);
    }
  });

  it('omits optional query params for empty values', async () => {
    const context = createContext();

    await vfsConnectService.getSync(
      {
        cursor: '',
        limit: 0,
        rootId: ' '
      },
      context
    );
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/vfs/vfs-sync'
    });

    await vfsConnectService.getCrdtSnapshot(
      {
        clientId: ''
      },
      context
    );
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/vfs/crdt/snapshot'
    });

    await vfsConnectService.getEmails(
      {
        offset: -1,
        limit: 0
      },
      context
    );
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/vfs/emails'
    });

    await vfsConnectService.getEmails(
      {
        offset: 0,
        limit: 0
      },
      context
    );
    expectLastJsonCall(context, {
      method: 'GET',
      path: '/vfs/emails',
      query: 'offset=0'
    });
  });
});
