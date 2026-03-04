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
  getPostgresInfo?: AdminV2Client['getPostgresInfo'];
  getTables?: AdminV2Client['getTables'];
  getColumns?: AdminV2Client['getColumns'];
  getRows?: AdminV2Client['getRows'];
  getRedisKeys?: AdminV2Client['getRedisKeys'];
  getRedisValue?: AdminV2Client['getRedisValue'];
  getRedisDbSize?: AdminV2Client['getRedisDbSize'];
}

function createAdminV2ClientStub(
  overrides: AdminV2ClientOverrides = {}
): AdminV2Client {
  return {
    getPostgresInfo:
      overrides.getPostgresInfo ??
      vi.fn(async () => ({ info: undefined, serverVersion: undefined })),
    getTables: overrides.getTables ?? vi.fn(async () => ({ tables: [] })),
    getColumns: overrides.getColumns ?? vi.fn(async () => ({ columns: [] })),
    getRows:
      overrides.getRows ??
      vi.fn(async () => ({
        rowsJson: [],
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
      { schema: 'public', table: 'users' },
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
      rowsJson: ['{"id":"user-1","email":"user@example.com"}'],
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
      {
        schema: 'public',
        table: 'users',
        limit: 10,
        offset: 20,
        sortColumn: 'id',
        sortDirection: 'desc'
      },
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

  it('maps redis key/value/dbsize responses and forwards request args', async () => {
    const getRedisKeys = vi.fn(async () => ({
      keys: [{ key: 'session:1', type: 'string', ttl: 120n }],
      cursor: '8',
      hasMore: true
    }));
    const getRedisValue = vi.fn(async () => ({
      key: 'config',
      type: 'hash',
      ttl: 10n,
      value: {
        value: {
          case: 'mapValue',
          value: {
            entries: { mode: 'strict' }
          }
        }
      }
    }));
    const getRedisDbSize = vi.fn(async () => ({ count: 12n }));
    const client = createAdminV2ClientStub({
      getRedisKeys,
      getRedisValue,
      getRedisDbSize
    });
    const { routes, logEvent, buildHeaders } = createRoutesForTest(client);

    const keysResponse = await routes.redis.getKeys('5', 10);
    const valueResponse = await routes.redis.getValue('config');
    const dbSizeResponse = await routes.redis.getDbSize();

    expect(keysResponse).toEqual({
      keys: [{ key: 'session:1', type: 'string', ttl: 120 }],
      cursor: '8',
      hasMore: true
    });
    expect(valueResponse).toEqual({
      key: 'config',
      type: 'hash',
      ttl: 10,
      value: { mode: 'strict' }
    });
    expect(dbSizeResponse).toEqual({ count: 12 });
    expect(getRedisKeys.mock.calls[0]?.[0].cursor).toBe('5');
    expect(getRedisKeys.mock.calls[0]?.[0].limit).toBe(10);
    expect(getRedisValue.mock.calls[0]?.[0].key).toBe('config');
    expect(buildHeaders).toHaveBeenCalledTimes(3);
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_redis_keys',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_redis_key',
      expect.any(Number),
      true
    );
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_redis_dbsize',
      expect.any(Number),
      true
    );
  });

  it('maps redis string and list value variants', async () => {
    const getRedisValue = vi
      .fn()
      .mockResolvedValueOnce({
        key: 'feature:flag',
        type: 'string',
        ttl: 60n,
        value: {
          value: {
            case: 'stringValue',
            value: 'enabled'
          }
        }
      })
      .mockResolvedValueOnce({
        key: 'jobs:queue',
        type: 'list',
        ttl: 30n,
        value: {
          value: {
            case: 'listValue',
            value: {
              values: ['job-1', 'job-2']
            }
          }
        }
      });
    const client = createAdminV2ClientStub({ getRedisValue });
    const { routes, logEvent } = createRoutesForTest(client);

    const stringResponse = await routes.redis.getValue('feature:flag');
    const listResponse = await routes.redis.getValue('jobs:queue');

    expect(stringResponse).toEqual({
      key: 'feature:flag',
      type: 'string',
      ttl: 60,
      value: 'enabled'
    });
    expect(listResponse).toEqual({
      key: 'jobs:queue',
      type: 'list',
      ttl: 30,
      value: ['job-1', 'job-2']
    });
    expect(logEvent).toHaveBeenCalledWith(
      'api_get_admin_redis_key',
      expect.any(Number),
      true
    );
  });
});
