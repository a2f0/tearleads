import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultMlsV2Client,
  createMlsV2Routes,
  type MlsV2Client
} from './mlsV2Routes';

const connectMocks = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createGrpcWebTransportMock: vi.fn()
}));

vi.mock('@connectrpc/connect', async () => {
  const actual = await vi.importActual<typeof import('@connectrpc/connect')>(
    '@connectrpc/connect'
  );
  return {
    ...actual,
    createClient: connectMocks.createClientMock
  };
});

vi.mock('@connectrpc/connect-web', async () => {
  const actual = await vi.importActual<
    typeof import('@connectrpc/connect-web')
  >('@connectrpc/connect-web');
  return {
    ...actual,
    createGrpcWebTransport: connectMocks.createGrpcWebTransportMock
  };
});

interface MlsV2ClientOverrides {
  listGroups?: MlsV2Client['listGroups'];
  getGroup?: MlsV2Client['getGroup'];
  createGroup?: MlsV2Client['createGroup'];
  updateGroup?: MlsV2Client['updateGroup'];
  deleteGroup?: MlsV2Client['deleteGroup'];
  getGroupMembers?: MlsV2Client['getGroupMembers'];
  addGroupMember?: MlsV2Client['addGroupMember'];
  removeGroupMember?: MlsV2Client['removeGroupMember'];
  getGroupMessages?: MlsV2Client['getGroupMessages'];
  sendGroupMessage?: MlsV2Client['sendGroupMessage'];
  getGroupState?: MlsV2Client['getGroupState'];
  uploadGroupState?: MlsV2Client['uploadGroupState'];
  getMyKeyPackages?: MlsV2Client['getMyKeyPackages'];
  getUserKeyPackages?: MlsV2Client['getUserKeyPackages'];
  uploadKeyPackages?: MlsV2Client['uploadKeyPackages'];
  deleteKeyPackage?: MlsV2Client['deleteKeyPackage'];
  getWelcomeMessages?: MlsV2Client['getWelcomeMessages'];
  acknowledgeWelcome?: MlsV2Client['acknowledgeWelcome'];
}

function createMlsV2ClientStub(
  overrides: MlsV2ClientOverrides = {}
): MlsV2Client {
  return {
    listGroups:
      overrides.listGroups ?? vi.fn(async () => ({ payload: { groups: [] } })),
    getGroup:
      overrides.getGroup ?? vi.fn(async () => ({ payload: { group: null } })),
    createGroup:
      overrides.createGroup ??
      vi.fn(async () => ({ payload: { group: { id: 'group-1' } } })),
    updateGroup:
      overrides.updateGroup ??
      vi.fn(async () => ({ payload: { group: { id: 'group-1' } } })),
    deleteGroup: overrides.deleteGroup ?? vi.fn(async () => ({ payload: {} })),
    getGroupMembers:
      overrides.getGroupMembers ??
      vi.fn(async () => ({ payload: { members: [] } })),
    addGroupMember:
      overrides.addGroupMember ??
      vi.fn(async () => ({ payload: { member: { userId: 'user-1' } } })),
    removeGroupMember:
      overrides.removeGroupMember ?? vi.fn(async () => ({ payload: {} })),
    getGroupMessages:
      overrides.getGroupMessages ??
      vi.fn(async () => ({ payload: { messages: [], hasMore: false } })),
    sendGroupMessage:
      overrides.sendGroupMessage ??
      vi.fn(async () => ({ payload: { message: { id: 'message-1' } } })),
    getGroupState:
      overrides.getGroupState ??
      vi.fn(async () => ({ payload: { state: null } })),
    uploadGroupState:
      overrides.uploadGroupState ??
      vi.fn(async () => ({ payload: { state: { id: 'state-1' } } })),
    getMyKeyPackages:
      overrides.getMyKeyPackages ??
      vi.fn(async () => ({ payload: { keyPackages: [] } })),
    getUserKeyPackages:
      overrides.getUserKeyPackages ??
      vi.fn(async () => ({ payload: { keyPackages: [] } })),
    uploadKeyPackages:
      overrides.uploadKeyPackages ??
      vi.fn(async () => ({ payload: { keyPackages: [] } })),
    deleteKeyPackage:
      overrides.deleteKeyPackage ?? vi.fn(async () => ({ payload: {} })),
    getWelcomeMessages:
      overrides.getWelcomeMessages ??
      vi.fn(async () => ({ payload: { welcomes: [] } })),
    acknowledgeWelcome:
      overrides.acknowledgeWelcome ??
      vi.fn(async () => ({ payload: { acknowledged: true } }))
  };
}

function createRoutesForTest(
  client: MlsV2Client,
  logEvent = vi.fn(async () => undefined),
  buildHeaders = vi.fn(async () => ({ authorization: 'Bearer token-123' }))
) {
  const routes = createMlsV2Routes({
    resolveApiBaseUrl: () => 'https://api.example.test',
    normalizeConnectBaseUrl: async (apiBaseUrl) => `${apiBaseUrl}/connect`,
    buildHeaders,
    getAuthHeaderValue: () => 'Bearer token-123',
    createClient: () => client,
    logEvent
  });

  return {
    routes,
    logEvent,
    buildHeaders
  };
}

describe('mlsV2Routes', () => {
  beforeEach(() => {
    connectMocks.createClientMock.mockReset();
    connectMocks.createGrpcWebTransportMock.mockReset();
  });

  it('creates default gRPC-web binary transport client', () => {
    const transport = { kind: 'transport' };
    const client = createMlsV2ClientStub();
    connectMocks.createGrpcWebTransportMock.mockReturnValue(transport);
    connectMocks.createClientMock.mockReturnValue(client);

    const createdClient = createDefaultMlsV2Client(
      'https://api.example.test/connect'
    );

    expect(createdClient).toBe(client);
    expect(connectMocks.createGrpcWebTransportMock).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.test/connect',
      useBinaryFormat: true
    });
    expect(connectMocks.createClientMock).toHaveBeenCalledTimes(1);
  });

  it('maps listGroups payload and logs success', async () => {
    const listGroups = vi.fn(async () => ({
      payload: {
        groups: [
          {
            id: 'group-1',
            name: 'MLS Group'
          }
        ]
      }
    }));
    const client = createMlsV2ClientStub({ listGroups });
    const { routes, logEvent } = createRoutesForTest(client);

    const response = await routes.listGroups();

    expect(response).toEqual({
      groups: [
        {
          id: 'group-1',
          name: 'MLS Group'
        }
      ]
    });
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_mls_groups',
      expect.any(Number),
      true
    );
  });

  it('encodes payload requests and forwards auth headers', async () => {
    const createGroup = vi.fn(async () => ({
      payload: {
        group: {
          id: 'group-1'
        }
      }
    }));
    const client = createMlsV2ClientStub({ createGroup });
    const { routes, buildHeaders } = createRoutesForTest(client);

    const response = await routes.createGroup({
      name: 'MLS Group',
      groupIdMls: 'group-id-mls',
      cipherSuite: 3
    });

    expect(response).toEqual({
      group: {
        id: 'group-1'
      }
    });
    expect(createGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          name: 'MLS Group',
          groupIdMls: 'group-id-mls',
          cipherSuite: 3
        }
      }),
      {
        headers: {
          authorization: 'Bearer token-123'
        }
      }
    );
    expect(buildHeaders).toHaveBeenCalledTimes(1);
  });

  it('forwards getGroupMessages cursor and limit defaults', async () => {
    const getGroupMessages = vi.fn(async () => ({
      payload: {
        messages: [],
        hasMore: false
      }
    }));
    const client = createMlsV2ClientStub({ getGroupMessages });
    const { routes } = createRoutesForTest(client);

    await routes.getGroupMessages('group-1');
    await routes.getGroupMessages('group-1', { cursor: '5', limit: 25 });

    expect(getGroupMessages).toHaveBeenCalledTimes(2);
    expect(getGroupMessages.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        groupId: 'group-1',
        cursor: '',
        limit: 0
      })
    );
    expect(getGroupMessages.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        groupId: 'group-1',
        cursor: '5',
        limit: 25
      })
    );
  });

  it('maps delete RPCs to undefined responses', async () => {
    const deleteGroup = vi.fn(async () => ({ payload: {} }));
    const deleteKeyPackage = vi.fn(async () => ({ payload: {} }));
    const removeGroupMember = vi.fn(async () => ({ payload: {} }));
    const client = createMlsV2ClientStub({
      deleteGroup,
      deleteKeyPackage,
      removeGroupMember
    });
    const { routes } = createRoutesForTest(client);

    await expect(routes.leaveGroup('group-1')).resolves.toBeUndefined();
    await expect(routes.deleteKeyPackage('key-1')).resolves.toBeUndefined();
    await expect(
      routes.removeGroupMember('group-1', 'user-1', {
        commit: 'commit-data',
        newEpoch: 2
      })
    ).resolves.toBeUndefined();
    expect(deleteGroup).toHaveBeenCalledTimes(1);
    expect(deleteKeyPackage).toHaveBeenCalledTimes(1);
    expect(removeGroupMember).toHaveBeenCalledTimes(1);
  });

  it('reuses one memoized client across route calls', async () => {
    const client = createMlsV2ClientStub();
    const createClient = vi.fn(() => client);
    const buildHeaders = vi.fn(async () => ({
      authorization: 'Bearer token-123'
    }));
    const routes = createMlsV2Routes({
      resolveApiBaseUrl: () => 'https://api.example.test',
      normalizeConnectBaseUrl: async (apiBaseUrl) => `${apiBaseUrl}/connect`,
      buildHeaders,
      getAuthHeaderValue: () => 'Bearer token-123',
      createClient,
      logEvent: vi.fn(async () => undefined)
    });

    await routes.listGroups();
    await routes.getMyKeyPackages();
    await routes.getWelcomeMessages();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(buildHeaders).toHaveBeenCalledTimes(3);
  });
});
