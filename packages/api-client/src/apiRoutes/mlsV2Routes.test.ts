import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultMlsV2Client,
  createMlsV2Routes,
  type MlsV2Client
} from './mlsV2Routes';

const connectMocks = {
  createClientMock: vi.fn(),
  createGrpcWebTransportMock: vi.fn()
};

function createContextKey<T>(
  defaultValue: T,
  options?: { description?: string }
) {
  return {
    id: Symbol(options?.description ?? 'connect-context-key'),
    defaultValue,
    description: options?.description ?? ''
  };
}

vi.mock('@connectrpc/connect', () => ({
  Code: {
    Internal: 13,
    Unauthenticated: 16
  },
  ConnectError: class TestConnectError extends Error {
    code: number;

    constructor(message: string, code: number) {
      super(message);
      this.name = 'ConnectError';
      this.code = code;
    }
  },
  createClient: (service: unknown, transport: unknown) =>
    connectMocks.createClientMock(service, transport),
  createContextKey
}));

vi.mock('@connectrpc/connect-web', () => ({
  createGrpcWebTransport: (options: unknown) =>
    connectMocks.createGrpcWebTransportMock(options)
}));

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

function makeProtoGroup(overrides: Record<string, unknown> = {}) {
  return {
    id: 'group-1',
    groupIdMls: 'mls-id',
    name: 'MLS Group',
    description: '',
    creatorUserId: 'user-1',
    currentEpoch: BigInt(0),
    cipherSuite: 3,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    lastMessageAt: '',
    memberCount: 0,
    role: 0,
    ...overrides
  };
}

function createMlsV2ClientStub(
  overrides: MlsV2ClientOverrides = {}
): MlsV2Client {
  return {
    listGroups: overrides.listGroups ?? vi.fn(async () => ({ groups: [] })),
    getGroup:
      overrides.getGroup ??
      vi.fn(async () => ({ group: makeProtoGroup(), members: [] })),
    createGroup:
      overrides.createGroup ?? vi.fn(async () => ({ group: makeProtoGroup() })),
    updateGroup:
      overrides.updateGroup ?? vi.fn(async () => ({ group: makeProtoGroup() })),
    deleteGroup: overrides.deleteGroup ?? vi.fn(async () => ({})),
    getGroupMembers:
      overrides.getGroupMembers ?? vi.fn(async () => ({ members: [] })),
    addGroupMember:
      overrides.addGroupMember ??
      vi.fn(async () => ({
        member: {
          userId: 'user-1',
          email: '',
          leafIndex: 0,
          role: 2,
          joinedAt: '',
          joinedAtEpoch: BigInt(0),
          leafIndexPresent: false
        }
      })),
    removeGroupMember: overrides.removeGroupMember ?? vi.fn(async () => ({})),
    getGroupMessages:
      overrides.getGroupMessages ??
      vi.fn(async () => ({ messages: [], hasMore: false, cursor: '' })),
    sendGroupMessage:
      overrides.sendGroupMessage ??
      vi.fn(async () => ({
        message: {
          id: 'message-1',
          groupId: 'group-1',
          senderUserId: '',
          senderEmail: '',
          epoch: BigInt(0),
          ciphertext: '',
          messageType: 1,
          contentType: '',
          sequenceNumber: BigInt(0),
          sentAt: '',
          createdAt: ''
        }
      })),
    getGroupState: overrides.getGroupState ?? vi.fn(async () => ({})),
    uploadGroupState:
      overrides.uploadGroupState ??
      vi.fn(async () => ({
        state: {
          id: 'state-1',
          groupId: 'group-1',
          epoch: BigInt(0),
          encryptedState: '',
          stateHash: '',
          createdAt: ''
        }
      })),
    getMyKeyPackages:
      overrides.getMyKeyPackages ?? vi.fn(async () => ({ keyPackages: [] })),
    getUserKeyPackages:
      overrides.getUserKeyPackages ?? vi.fn(async () => ({ keyPackages: [] })),
    uploadKeyPackages:
      overrides.uploadKeyPackages ?? vi.fn(async () => ({ keyPackages: [] })),
    deleteKeyPackage: overrides.deleteKeyPackage ?? vi.fn(async () => ({})),
    getWelcomeMessages:
      overrides.getWelcomeMessages ?? vi.fn(async () => ({ welcomes: [] })),
    acknowledgeWelcome: overrides.acknowledgeWelcome ?? vi.fn(async () => ({}))
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

  it('maps listGroups response and logs success', async () => {
    const listGroups = vi.fn(async () => ({
      groups: [makeProtoGroup()]
    }));
    const client = createMlsV2ClientStub({ listGroups });
    const { routes, logEvent } = createRoutesForTest(client);

    const response = await routes.listGroups();

    expect(response.groups).toHaveLength(1);
    expect(response.groups[0]?.name).toBe('MLS Group');
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_mls_groups',
      expect.any(Number),
      true
    );
  });

  it('encodes createGroup request and maps response', async () => {
    const createGroup = vi.fn(async () => ({
      group: makeProtoGroup({ id: 'group-1', name: 'MLS Group' })
    }));
    const client = createMlsV2ClientStub({ createGroup });
    const { routes, buildHeaders } = createRoutesForTest(client);

    const response = await routes.createGroup({
      name: 'MLS Group',
      groupIdMls: 'group-id-mls',
      cipherSuite: 3
    });

    expect(response.group?.id).toBe('group-1');
    expect(response.group?.name).toBe('MLS Group');
    expect(createGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'MLS Group',
        groupIdMls: 'group-id-mls',
        cipherSuite: 3
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
      messages: [],
      hasMore: false,
      cursor: ''
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
    const deleteGroup = vi.fn(async () => ({}));
    const deleteKeyPackage = vi.fn(async () => ({}));
    const removeGroupMember = vi.fn(async () => ({}));
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

  it('decodes uploadKeyPackages transport payloads to proto bytes', async () => {
    const uploadKeyPackages = vi.fn(async () => ({ keyPackages: [] }));
    const client = createMlsV2ClientStub({ uploadKeyPackages });
    const { routes } = createRoutesForTest(client);
    const keyPackageBytes = new TextEncoder().encode('key-data');
    const encodedKeyPackageData = btoa(
      String.fromCharCode(...Array.from(keyPackageBytes))
    );

    await routes.uploadKeyPackages({
      keyPackages: [
        {
          keyPackageData: encodedKeyPackageData,
          keyPackageRef: 'ref-1',
          cipherSuite: 3
        }
      ]
    });

    const uploadRequest = uploadKeyPackages.mock.calls[0]?.[0];
    const uploadCallOptions = uploadKeyPackages.mock.calls[0]?.[1];
    expect(
      Array.from(uploadRequest?.keyPackages[0]?.keyPackageData ?? [])
    ).toEqual(Array.from(new TextEncoder().encode('key-data')));
    expect(uploadRequest?.keyPackages[0]?.keyPackageRef).toBe('ref-1');
    expect(uploadRequest?.keyPackages[0]?.cipherSuite).toBe(3);
    expect(uploadCallOptions).toEqual({
      headers: {
        authorization: 'Bearer token-123'
      }
    });
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
