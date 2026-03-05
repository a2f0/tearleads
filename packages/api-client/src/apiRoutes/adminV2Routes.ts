import { create } from '@bufbuild/protobuf';
import {
  type CallOptions,
  type Client,
  createClient
} from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import type {
  PostgresAdminInfoResponse,
  PostgresColumnsResponse,
  PostgresRowsResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@tearleads/shared';
import {
  AdminDeleteRedisKeyRequestSchema,
  AdminGetColumnsRequestSchema,
  type AdminGetColumnsResponse,
  AdminGetPostgresInfoRequestSchema,
  type AdminGetPostgresInfoResponse,
  AdminGetRedisDbSizeRequestSchema,
  type AdminGetRedisDbSizeResponse,
  AdminGetRedisKeysRequestSchema,
  type AdminGetRedisKeysResponse,
  AdminGetRedisValueRequestSchema,
  type AdminGetRedisValueResponse,
  AdminGetRowsRequestSchema,
  type AdminGetRowsResponse,
  AdminGetTablesRequestSchema,
  type AdminGetTablesResponse,
  AdminService
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { API_BASE_URL } from '../apiCore';
import { type ApiEventSlug, logApiEvent } from '../apiLogger';
import {
  type ApiV2RequestHeaderOptions,
  buildApiV2RequestHeaders,
  normalizeApiV2ConnectBaseUrl
} from '../apiV2ClientWasm';
import { getAuthHeaderValue } from '../authStorage';

const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type AdminV2CallOptions = Pick<CallOptions, 'headers'>;

interface AdminGetRowsOptions {
  limit?: number;
  offset?: number;
  sortColumn?: string;
  sortDirection?: 'asc' | 'desc';
}

export type AdminV2Client = Client<typeof AdminService>;

interface AdminV2RoutesDependencies {
  resolveApiBaseUrl: () => string;
  normalizeConnectBaseUrl: (apiBaseUrl: string) => Promise<string>;
  buildHeaders: (
    options: ApiV2RequestHeaderOptions
  ) => Promise<Record<string, string>>;
  getAuthHeaderValue: () => string | null;
  createClient: (connectBaseUrl: string) => AdminV2Client;
  logEvent: (
    eventName: ApiEventSlug,
    durationMs: number,
    success: boolean
  ) => Promise<void>;
}

function createDefaultDependencies(): AdminV2RoutesDependencies {
  return {
    resolveApiBaseUrl: () => {
      if (!API_BASE_URL) {
        throw new Error('VITE_API_URL environment variable is not set');
      }
      return API_BASE_URL;
    },
    normalizeConnectBaseUrl: normalizeApiV2ConnectBaseUrl,
    buildHeaders: buildApiV2RequestHeaders,
    getAuthHeaderValue,
    createClient: createDefaultAdminV2Client,
    logEvent: logApiEvent
  };
}

function toCallOptions(headers: Record<string, string>): AdminV2CallOptions {
  if (Object.keys(headers).length === 0) {
    return {};
  }
  return { headers };
}

function toSafeNumber(value: bigint, fieldName: string): number {
  if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) {
    throw new Error(`${fieldName} exceeded Number safe integer range`);
  }
  return Number(value);
}

function mapPostgresInfoResponse(
  response: AdminGetPostgresInfoResponse
): PostgresAdminInfoResponse {
  return {
    status: 'ok',
    info: {
      host: response.info?.host ?? null,
      port: response.info?.port ?? null,
      database: response.info?.database ?? null,
      user: response.info?.user ?? null
    },
    serverVersion: response.serverVersion ?? null
  };
}

function mapPostgresTablesResponse(
  response: AdminGetTablesResponse
): PostgresTablesResponse {
  return {
    tables: response.tables.map((table) => ({
      schema: table.schema,
      name: table.name,
      rowCount: toSafeNumber(table.rowCount, 'rowCount'),
      totalBytes: toSafeNumber(table.totalBytes, 'totalBytes'),
      tableBytes: toSafeNumber(table.tableBytes, 'tableBytes'),
      indexBytes: toSafeNumber(table.indexBytes, 'indexBytes')
    }))
  };
}

function mapPostgresColumnsResponse(
  response: AdminGetColumnsResponse
): PostgresColumnsResponse {
  return {
    columns: response.columns.map((column) => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      defaultValue: column.defaultValue ?? null,
      ordinalPosition: column.ordinalPosition
    }))
  };
}

function mapPostgresRowsResponse(
  response: AdminGetRowsResponse
): PostgresRowsResponse {
  return {
    rows: response.rows.map((row) => ({ ...row })),
    totalCount: toSafeNumber(response.totalCount, 'totalCount'),
    limit: response.limit,
    offset: response.offset
  };
}

function mapRedisKeysResponse(
  response: AdminGetRedisKeysResponse
): RedisKeysResponse {
  return {
    keys: response.keys.map((keyRecord) => ({
      key: keyRecord.key,
      type: keyRecord.type,
      ttl: toSafeNumber(keyRecord.ttl, 'ttl')
    })),
    cursor: response.cursor,
    hasMore: response.hasMore
  };
}

function mapRedisValue(
  response: AdminGetRedisValueResponse
): RedisKeyValueResponse['value'] {
  const redisValue = response.value?.value;
  if (!redisValue) {
    return null;
  }

  switch (redisValue.case) {
    case 'stringValue':
      return redisValue.value;
    case 'listValue':
      return redisValue.value.values;
    case 'mapValue':
      return redisValue.value.entries;
    case undefined:
      return null;
    default: {
      const unexpectedRedisValueCase: never = redisValue;
      throw new Error(
        `Unhandled redis value variant: ${unexpectedRedisValueCase}`
      );
    }
  }
}

function mapRedisValueResponse(
  response: AdminGetRedisValueResponse
): RedisKeyValueResponse {
  return {
    key: response.key,
    type: response.type,
    ttl: toSafeNumber(response.ttl, 'ttl'),
    value: mapRedisValue(response)
  };
}

function mapRedisDbSizeResponse(response: AdminGetRedisDbSizeResponse): {
  count: number;
} {
  return {
    count: toSafeNumber(response.count, 'count')
  };
}

async function buildCallContext(
  dependencies: AdminV2RoutesDependencies
): Promise<{ client: AdminV2Client; callOptions: AdminV2CallOptions }> {
  const connectBaseUrl = await dependencies.normalizeConnectBaseUrl(
    dependencies.resolveApiBaseUrl()
  );
  const client = dependencies.createClient(connectBaseUrl);
  const headers = await dependencies.buildHeaders({
    bearerToken: dependencies.getAuthHeaderValue()
  });
  return {
    client,
    callOptions: toCallOptions(headers)
  };
}

async function runWithEvent<T>(
  dependencies: AdminV2RoutesDependencies,
  eventName: ApiEventSlug,
  operation: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  let success = false;

  try {
    const response = await operation();
    success = true;
    return response;
  } finally {
    await dependencies.logEvent(eventName, performance.now() - start, success);
  }
}

export function createDefaultAdminV2Client(
  connectBaseUrl: string
): AdminV2Client {
  const transport = createGrpcWebTransport({
    baseUrl: connectBaseUrl,
    useBinaryFormat: true
  });
  return createClient(AdminService, transport);
}

export function createAdminV2Routes(
  overrides: Partial<AdminV2RoutesDependencies> = {}
) {
  const dependencies = {
    ...createDefaultDependencies(),
    ...overrides
  };

  return {
    postgres: {
      getInfo: () =>
        runWithEvent(dependencies, 'api_get_admin_postgres_info', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getPostgresInfo(
            create(AdminGetPostgresInfoRequestSchema),
            callOptions
          );
          return mapPostgresInfoResponse(response);
        }),
      getTables: () =>
        runWithEvent(
          dependencies,
          'api_get_admin_postgres_tables',
          async () => {
            const { client, callOptions } =
              await buildCallContext(dependencies);
            const response = await client.getTables(
              create(AdminGetTablesRequestSchema),
              callOptions
            );
            return mapPostgresTablesResponse(response);
          }
        ),
      getColumns: (schema: string, table: string) =>
        runWithEvent(
          dependencies,
          'api_get_admin_postgres_columns',
          async () => {
            const { client, callOptions } =
              await buildCallContext(dependencies);
            const response = await client.getColumns(
              create(AdminGetColumnsRequestSchema, { schema, table }),
              callOptions
            );
            return mapPostgresColumnsResponse(response);
          }
        ),
      getRows: (schema: string, table: string, options?: AdminGetRowsOptions) =>
        runWithEvent(dependencies, 'api_get_admin_postgres_rows', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getRows(
            create(AdminGetRowsRequestSchema, {
              schema,
              table,
              limit: options?.limit ?? 50,
              offset: options?.offset ?? 0,
              ...(options?.sortColumn
                ? { sortColumn: options.sortColumn }
                : {}),
              ...(options?.sortDirection
                ? { sortDirection: options.sortDirection }
                : {})
            }),
            callOptions
          );
          return mapPostgresRowsResponse(response);
        })
    },
    redis: {
      getKeys: (cursor?: string, limit?: number) =>
        runWithEvent(dependencies, 'api_get_admin_redis_keys', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getRedisKeys(
            create(AdminGetRedisKeysRequestSchema, {
              cursor: cursor ?? '',
              limit: limit ?? 0
            }),
            callOptions
          );
          return mapRedisKeysResponse(response);
        }),
      getValue: (key: string) =>
        runWithEvent(dependencies, 'api_get_admin_redis_key', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getRedisValue(
            create(AdminGetRedisValueRequestSchema, { key }),
            callOptions
          );
          return mapRedisValueResponse(response);
        }),
      deleteKey: (key: string) =>
        runWithEvent(dependencies, 'api_delete_admin_redis_key', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          return client.deleteRedisKey(
            create(AdminDeleteRedisKeyRequestSchema, { key }),
            callOptions
          );
        }),
      getDbSize: () =>
        runWithEvent(dependencies, 'api_get_admin_redis_dbsize', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getRedisDbSize(
            create(AdminGetRedisDbSizeRequestSchema),
            callOptions
          );
          return mapRedisDbSizeResponse(response);
        })
    }
  };
}

export const adminV2Routes = createAdminV2Routes();
