import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AdminV2Client,
  createAdminV2Routes,
  createDefaultAdminV2Client
} from './adminV2Routes';

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

interface AdminV2ClientOverrides {
  getContext?: AdminV2Client['getContext'];
  listGroups?: AdminV2Client['listGroups'];
  getGroup?: AdminV2Client['getGroup'];
  createGroup?: AdminV2Client['createGroup'];
  updateGroup?: AdminV2Client['updateGroup'];
  deleteGroup?: AdminV2Client['deleteGroup'];
  getGroupMembers?: AdminV2Client['getGroupMembers'];
  addGroupMember?: AdminV2Client['addGroupMember'];
  removeGroupMember?: AdminV2Client['removeGroupMember'];
  listOrganizations?: AdminV2Client['listOrganizations'];
  getOrganization?: AdminV2Client['getOrganization'];
  getOrgUsers?: AdminV2Client['getOrgUsers'];
  getOrgGroups?: AdminV2Client['getOrgGroups'];
  listUsers?: AdminV2Client['listUsers'];
  getUser?: AdminV2Client['getUser'];
  getPostgresInfo?: AdminV2Client['getPostgresInfo'];
  getTables?: AdminV2Client['getTables'];
  getColumns?: AdminV2Client['getColumns'];
  getRows?: AdminV2Client['getRows'];
  getRedisKeys?: AdminV2Client['getRedisKeys'];
  getRedisValue?: AdminV2Client['getRedisValue'];
  deleteRedisKey?: AdminV2Client['deleteRedisKey'];
  getRedisDbSize?: AdminV2Client['getRedisDbSize'];
}

function createAdminV2ClientStub(
  overrides: AdminV2ClientOverrides = {}
): AdminV2Client {
  return {
    getContext:
      overrides.getContext ??
      vi.fn(async () => ({
        isRootAdmin: false,
        organizations: [],
        defaultOrganizationId: undefined
      })),
    listGroups: overrides.listGroups ?? vi.fn(async () => ({ groups: [] })),
    getGroup:
      overrides.getGroup ??
      vi.fn(async () => ({ group: undefined, members: [] })),
    createGroup:
      overrides.createGroup ?? vi.fn(async () => ({ group: undefined })),
    updateGroup:
      overrides.updateGroup ?? vi.fn(async () => ({ group: undefined })),
    deleteGroup:
      overrides.deleteGroup ?? vi.fn(async () => ({ deleted: false })),
    getGroupMembers:
      overrides.getGroupMembers ?? vi.fn(async () => ({ members: [] })),
    addGroupMember:
      overrides.addGroupMember ?? vi.fn(async () => ({ added: false })),
    removeGroupMember:
      overrides.removeGroupMember ?? vi.fn(async () => ({ removed: false })),
    listOrganizations:
      overrides.listOrganizations ?? vi.fn(async () => ({ organizations: [] })),
    getOrganization:
      overrides.getOrganization ??
      vi.fn(async () => ({ organization: undefined })),
    getOrgUsers: overrides.getOrgUsers ?? vi.fn(async () => ({ users: [] })),
    getOrgGroups: overrides.getOrgGroups ?? vi.fn(async () => ({ groups: [] })),
    listUsers: overrides.listUsers ?? vi.fn(async () => ({ users: [] })),
    getUser: overrides.getUser ?? vi.fn(async () => ({ user: undefined })),
    getPostgresInfo:
      overrides.getPostgresInfo ??
      vi.fn(async () => ({ info: undefined, serverVersion: undefined })),
    getTables: overrides.getTables ?? vi.fn(async () => ({ tables: [] })),
    getColumns: overrides.getColumns ?? vi.fn(async () => ({ columns: [] })),
    getRows:
      overrides.getRows ??
      vi.fn(async () => ({
        rows: [],
        totalCount: 0n,
        limit: 0,
        offset: 0
      })),
    getRedisKeys:
      overrides.getRedisKeys ??
      vi.fn(async () => ({ keys: [], cursor: '0', hasMore: false })),
    getRedisValue:
      overrides.getRedisValue ??
      vi.fn(async () => ({ key: '', type: '', ttl: 0n, value: undefined })),
    deleteRedisKey:
      overrides.deleteRedisKey ?? vi.fn(async () => ({ deleted: false })),
    getRedisDbSize:
      overrides.getRedisDbSize ?? vi.fn(async () => ({ count: 0n }))
  };
}

function createRoutesForTest(
  client: AdminV2Client,
  logEvent = vi.fn(async () => undefined),
  buildHeaders = vi.fn(async () => ({ authorization: 'Bearer token-123' }))
) {
  const routes = createAdminV2Routes({
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

describe('adminV2Routes', () => {
  beforeEach(() => {
    connectMocks.createClientMock.mockReset();
    connectMocks.createGrpcWebTransportMock.mockReset();
  });

  it('creates default gRPC-web binary transport client', () => {
    const transport = { kind: 'transport' };
    const client = createAdminV2ClientStub();
    connectMocks.createGrpcWebTransportMock.mockReturnValue(transport);
    connectMocks.createClientMock.mockReturnValue(client);

    const createdClient = createDefaultAdminV2Client(
      'https://api.example.test/connect'
    );

    expect(createdClient).toBe(client);
    expect(connectMocks.createGrpcWebTransportMock).toHaveBeenCalledWith({
      baseUrl: 'https://api.example.test/connect',
      useBinaryFormat: true
    });
    expect(connectMocks.createClientMock).toHaveBeenCalledTimes(1);
  });

  it('maps postgres info response and logs success', async () => {
    const getPostgresInfo = vi.fn(async () => ({
      info: {
        host: 'localhost',
        port: 5432,
        database: 'tearleads',
        user: 'admin'
      },
      serverVersion: 'PostgreSQL 16.7'
    }));
    const client = createAdminV2ClientStub({ getPostgresInfo });
    const { routes, logEvent } = createRoutesForTest(client);

    const response = await routes.postgres.getInfo();

    expect(response).toEqual({
      status: 'ok',
      info: {
        host: 'localhost',
        port: 5432,
        database: 'tearleads',
        user: 'admin'
      },
      serverVersion: 'PostgreSQL 16.7'
    });
    expect(getPostgresInfo).toHaveBeenCalledTimes(1);
    expect(getPostgresInfo.mock.calls[0]?.[1]).toEqual({
      headers: {
        authorization: 'Bearer token-123'
      }
    });
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_postgres_info',
      expect.any(Number),
      true
    );
  });

  it('maps admin context response and logs success', async () => {
    const getContext = vi.fn(async () => ({
      isRootAdmin: false,
      organizations: [{ id: 'org-1', name: 'Alpha' }],
      defaultOrganizationId: 'org-1'
    }));
    const client = createAdminV2ClientStub({ getContext });
    const { routes, logEvent } = createRoutesForTest(client);

    const response = await routes.getContext();

    expect(response).toEqual({
      isRootAdmin: false,
      organizations: [{ id: 'org-1', name: 'Alpha' }],
      defaultOrganizationId: 'org-1'
    });
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext.mock.calls[0]?.[1]).toEqual({
      headers: {
        authorization: 'Bearer token-123'
      }
    });
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_organizations',
      expect.any(Number),
      true
    );
  });

  it('maps postgres table bigints and rejects unsafe integer values', async () => {
    const getTables = vi
      .fn()
      .mockResolvedValueOnce({
        tables: [
          {
            schema: 'public',
            name: 'users',
            rowCount: 42n,
            totalBytes: 2048n,
            tableBytes: 1024n,
            indexBytes: 1024n
          }
        ]
      })
      .mockResolvedValueOnce({
        tables: [
          {
            schema: 'public',
            name: 'oversized',
            rowCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
            totalBytes: 1n,
            tableBytes: 1n,
            indexBytes: 0n
          }
        ]
      });
    const client = createAdminV2ClientStub({ getTables });
    const { routes, logEvent } = createRoutesForTest(client);

    const safeResponse = await routes.postgres.getTables();
    expect(safeResponse).toEqual({
      tables: [
        {
          schema: 'public',
          name: 'users',
          rowCount: 42,
          totalBytes: 2048,
          tableBytes: 1024,
          indexBytes: 1024
        }
      ]
    });

    await expect(routes.postgres.getTables()).rejects.toThrow(
      'rowCount exceeded Number safe integer range'
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_postgres_tables',
      expect.any(Number),
      false
    );
  });

  it('maps postgres columns response and forwards schema/table args', async () => {
    const getColumns = vi.fn(async () => ({
      columns: [
        {
          name: 'id',
          type: 'uuid',
          nullable: false,
          defaultValue: undefined,
          ordinalPosition: 1
        },
        {
          name: 'display_name',
          type: 'text',
          nullable: true,
          defaultValue: 'guest',
          ordinalPosition: 2
        }
      ]
    }));
    const client = createAdminV2ClientStub({ getColumns });
    const { routes, logEvent } = createRoutesForTest(client);

    const response = await routes.postgres.getColumns('public', 'users');

    expect(response).toEqual({
      columns: [
        {
          name: 'id',
          type: 'uuid',
          nullable: false,
          defaultValue: null,
          ordinalPosition: 1
        },
        {
          name: 'display_name',
          type: 'text',
          nullable: true,
          defaultValue: 'guest',
          ordinalPosition: 2
        }
      ]
    });
    expect(getColumns).toHaveBeenCalledWith(
      expect.objectContaining({ schema: 'public', table: 'users' }),
      {
        headers: {
          authorization: 'Bearer token-123'
        }
      }
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_postgres_columns',
      expect.any(Number),
      true
    );
  });

  it('maps postgres rows response and forwards pagination/sort args', async () => {
    const getRows = vi.fn(async () => ({
      rows: [{ id: 'user-1', email: 'user@example.com' }],
      totalCount: 1n,
      limit: 10,
      offset: 20
    }));
    const client = createAdminV2ClientStub({ getRows });
    const { routes, logEvent } = createRoutesForTest(client);

    const response = await routes.postgres.getRows('public', 'users', {
      limit: 10,
      offset: 20,
      sortColumn: 'id',
      sortDirection: 'desc'
    });

    expect(response).toEqual({
      rows: [{ id: 'user-1', email: 'user@example.com' }],
      totalCount: 1,
      limit: 10,
      offset: 20
    });
    expect(getRows).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: 'public',
        table: 'users',
        limit: 10,
        offset: 20,
        sortColumn: 'id',
        sortDirection: 'desc'
      }),
      {
        headers: {
          authorization: 'Bearer token-123'
        }
      }
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_postgres_rows',
      expect.any(Number),
      true
    );
  });
});
