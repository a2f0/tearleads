import { create } from '@bufbuild/protobuf';
import {
  type CallOptions,
  type Client,
  createClient
} from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import {
  AdminDeleteRedisKeyRequestSchema,
  AdminGetColumnsRequestSchema,
  AdminGetContextRequestSchema,
  AdminGetGroupMembersRequestSchema,
  AdminGetGroupRequestSchema,
  AdminGetOrganizationRequestSchema,
  AdminGetOrgGroupsRequestSchema,
  AdminGetPostgresInfoRequestSchema,
  AdminGetRedisDbSizeRequestSchema,
  AdminGetRedisKeysRequestSchema,
  AdminGetRedisValueRequestSchema,
  AdminGetRowsRequestSchema,
  AdminGetTablesRequestSchema,
  AdminGetUserRequestSchema,
  AdminListGroupsRequestSchema,
  AdminListOrganizationsRequestSchema,
  AdminListUsersRequestSchema,
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
import {
  mapContextResponse,
  mapGroupDetailResponse,
  mapGroupMembersResponse,
  mapGroupsListResponse,
  mapOrganizationGroupsResponse,
  mapOrganizationResponse,
  mapOrganizationsResponse,
  mapPostgresColumnsResponse,
  mapPostgresInfoResponse,
  mapPostgresRowsResponse,
  mapPostgresTablesResponse,
  mapRedisDbSizeResponse,
  mapRedisKeysResponse,
  mapRedisValueResponse,
  mapUserResponse,
  mapUsersResponse
} from './adminV2Mappers';

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
    getContext: () =>
      runWithEvent(dependencies, 'api_get_admin_organizations', async () => {
        const { client, callOptions } = await buildCallContext(dependencies);
        const response = await client.getContext(
          create(AdminGetContextRequestSchema),
          callOptions
        );
        return mapContextResponse(response);
      }),
    groups: {
      list: (options?: { organizationId?: string }) =>
        runWithEvent(dependencies, 'api_get_admin_groups', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.listGroups(
            create(AdminListGroupsRequestSchema, {
              organizationId: options?.organizationId || undefined
            }),
            callOptions
          );
          return mapGroupsListResponse(response);
        }),
      get: (id: string) =>
        runWithEvent(dependencies, 'api_get_admin_group', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getGroup(
            create(AdminGetGroupRequestSchema, { id }),
            callOptions
          );
          return mapGroupDetailResponse(response);
        }),
      getMembers: (id: string) =>
        runWithEvent(dependencies, 'api_get_admin_group_members', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getGroupMembers(
            create(AdminGetGroupMembersRequestSchema, { id }),
            callOptions
          );
          return mapGroupMembersResponse(response);
        })
    },
    organizations: {
      list: (options?: { organizationId?: string }) =>
        runWithEvent(dependencies, 'api_get_admin_organizations', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.listOrganizations(
            create(AdminListOrganizationsRequestSchema, {
              ...(options?.organizationId
                ? { organizationId: options.organizationId }
                : {})
            }),
            callOptions
          );
          return mapOrganizationsResponse(response);
        }),
      get: (id: string) =>
        runWithEvent(dependencies, 'api_get_admin_organization', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getOrganization(
            create(AdminGetOrganizationRequestSchema, { id }),
            callOptions
          );
          return mapOrganizationResponse(response);
        }),
      getGroups: (id: string) =>
        runWithEvent(
          dependencies,
          'api_get_admin_organization_groups',
          async () => {
            const { client, callOptions } =
              await buildCallContext(dependencies);
            const response = await client.getOrgGroups(
              create(AdminGetOrgGroupsRequestSchema, { id }),
              callOptions
            );
            return mapOrganizationGroupsResponse(response);
          }
        )
    },
    users: {
      list: (options?: { organizationId?: string }) =>
        runWithEvent(dependencies, 'api_get_admin_users', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.listUsers(
            create(AdminListUsersRequestSchema, {
              ...(options?.organizationId
                ? { organizationId: options.organizationId }
                : {})
            }),
            callOptions
          );
          return mapUsersResponse(response);
        }),
      get: (id: string) =>
        runWithEvent(dependencies, 'api_get_admin_user', async () => {
          const { client, callOptions } = await buildCallContext(dependencies);
          const response = await client.getUser(
            create(AdminGetUserRequestSchema, { id }),
            callOptions
          );
          return mapUserResponse(response);
        })
    },
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
