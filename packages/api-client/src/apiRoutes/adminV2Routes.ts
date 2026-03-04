import { type CallOptions, createClient } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import type {
  PostgresAdminInfoResponse,
  PostgresColumnsResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse
} from '@tearleads/shared';
import { AdminService } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
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

interface AdminV2PostgresInfoResponseLike {
  info?: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
  };
  serverVersion?: string;
}

interface AdminV2TableLike {
  schema: string;
  name: string;
  rowCount: bigint;
  totalBytes: bigint;
  tableBytes: bigint;
  indexBytes: bigint;
}

interface AdminV2TablesResponseLike {
  tables: AdminV2TableLike[];
}

interface AdminV2ColumnLike {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  ordinalPosition: number;
}

interface AdminV2ColumnsResponseLike {
  columns: AdminV2ColumnLike[];
}

interface AdminV2RedisKeyLike {
  key: string;
  type: string;
  ttl: bigint;
}

interface AdminV2RedisKeysResponseLike {
  keys: AdminV2RedisKeyLike[];
  cursor: string;
  hasMore: boolean;
}

interface AdminV2RedisStringValueLike {
  case: 'stringValue';
  value: string;
}

interface AdminV2RedisListValueLike {
  case: 'listValue';
  value: {
    values: string[];
  };
}

interface AdminV2RedisMapValueLike {
  case: 'mapValue';
  value: {
    entries: Record<string, string>;
  };
}

interface AdminV2RedisEmptyValueLike {
  case: undefined;
  value?: undefined;
}

type AdminV2RedisValueLike =
  | AdminV2RedisStringValueLike
  | AdminV2RedisListValueLike
  | AdminV2RedisMapValueLike
  | AdminV2RedisEmptyValueLike;

interface AdminV2RedisValueResponseLike {
  key: string;
  type: string;
  ttl: bigint;
  value?: {
    value: AdminV2RedisValueLike;
  };
}

export interface AdminV2Client {
  getPostgresInfo(
    request: Record<string, never>,
    options?: AdminV2CallOptions
  ): Promise<AdminV2PostgresInfoResponseLike>;
  getTables(
    request: Record<string, never>,
    options?: AdminV2CallOptions
  ): Promise<AdminV2TablesResponseLike>;
  getColumns(
    request: { schema: string; table: string },
    options?: AdminV2CallOptions
  ): Promise<AdminV2ColumnsResponseLike>;
  getRedisKeys(
    request: { cursor: string; limit: number },
    options?: AdminV2CallOptions
  ): Promise<AdminV2RedisKeysResponseLike>;
  getRedisValue(
    request: { key: string },
    options?: AdminV2CallOptions
  ): Promise<AdminV2RedisValueResponseLike>;
}

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

function createAdminGetPostgresInfoRequest(): Record<string, never> {
  return {};
}

function createAdminGetTablesRequest(): Record<string, never> {
  return {};
}

function createAdminGetColumnsRequest(schema: string, table: string) {
  return { schema, table };
}

function createAdminGetRedisKeysRequest(cursor?: string, limit?: number) {
  return {
    cursor: cursor ?? '',
    limit: limit ?? 0
  };
}

function createAdminGetRedisValueRequest(key: string) {
  return { key };
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
  response: AdminV2PostgresInfoResponseLike
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
  response: AdminV2TablesResponseLike
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
  response: AdminV2ColumnsResponseLike
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

function mapRedisKeysResponse(
  response: AdminV2RedisKeysResponseLike
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
  response: AdminV2RedisValueResponseLike
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
  response: AdminV2RedisValueResponseLike
): RedisKeyValueResponse {
  return {
    key: response.key,
    type: response.type,
    ttl: toSafeNumber(response.ttl, 'ttl'),
    value: mapRedisValue(response)
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
            createAdminGetPostgresInfoRequest(),
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
              createAdminGetTablesRequest(),
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
              createAdminGetColumnsRequest(schema, table),
              callOptions
            );
            return mapPostgresColumnsResponse(response);
          }
        )
    },
    redis: {
      getKeys: (cursor?: string, limit?: number) =>
        runWithEvent(dependencies, 'api_get_admin_redis_keys', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getRedisKeys(
            createAdminGetRedisKeysRequest(cursor, limit),
            callOptions
          );
          return mapRedisKeysResponse(response);
        }),
      getValue: (key: string) =>
        runWithEvent(dependencies, 'api_get_admin_redis_key', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getRedisValue(
            createAdminGetRedisValueRequest(key),
            callOptions
          );
          return mapRedisValueResponse(response);
        })
    }
  };
}

export const adminV2Routes = createAdminV2Routes();
