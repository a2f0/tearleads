import type {
  AdminAccessContextResponse,
  AdminUserResponse,
  AdminUsersResponse,
  AdminUserUpdatePayload,
  AdminUserUpdateResponse,
  AiUsageListResponse,
  CreateGroupRequest,
  CreateOrganizationRequest,
  Group,
  GroupDetailResponse,
  GroupMembersResponse,
  GroupsListResponse,
  Organization,
  OrganizationGroupsResponse,
  OrganizationResponse,
  OrganizationsListResponse,
  OrganizationUsersResponse,
  PostgresAdminInfoResponse,
  PostgresColumnsResponse,
  PostgresRowsResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse,
  UpdateGroupRequest,
  UpdateOrganizationRequest
} from '@tearleads/shared';
import {
  createConnectJsonPostInit,
  parseConnectJsonString
} from '@tearleads/shared';
import { mapContextResponse } from './adminV2ContextMapper';

const API_BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

const ADMIN_CONNECT_BASE_PATH = '/connect/tearleads.v1.AdminService';
const ADMIN_V2_CONNECT_BASE_PATH = '/connect/tearleads.v2.AdminService';
const AI_CONNECT_BASE_PATH = '/connect/tearleads.v1.AiService';

interface RequestParams {
  fetchOptions?: RequestInit;
}

interface ConnectJsonEnvelopeResponse {
  json: string;
}

async function request<T>(
  endpoint: string,
  params?: RequestParams
): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  const headers = new Headers(params?.fetchOptions?.headers ?? undefined);
  if (!headers.has('Authorization')) {
    const token = localStorage.getItem('auth_token');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...params?.fetchOptions,
    headers
  });

  if (!response.ok) {
    let message = `API error: ${response.status}`;
    const contentType = response.headers.get('content-type')?.toLowerCase();
    if (contentType?.includes('application/json')) {
      try {
        const body = (await response.json()) as {
          error?: string;
          message?: string;
        };
        if (body.error) {
          message = body.error;
        } else if (body.message) {
          message = body.message;
        }
      } catch {
        // ignore JSON parse failures
      }
    }
    throw new Error(message);
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

function requestAdminJson<T>(
  methodName: string,
  requestBody: Record<string, unknown>
): Promise<T> {
  return request<ConnectJsonEnvelopeResponse>(
    `${ADMIN_CONNECT_BASE_PATH}/${methodName}`,
    {
      fetchOptions: createConnectJsonPostInit(requestBody)
    }
  ).then((response) => parseConnectJsonString<T>(response?.json));
}

function requestAdminV2<T>(
  methodName: string,
  requestBody: Record<string, unknown>,
  mapResponse: (responseBody: unknown) => T
): Promise<T> {
  return request<unknown>(`${ADMIN_V2_CONNECT_BASE_PATH}/${methodName}`, {
    fetchOptions: createConnectJsonPostInit(requestBody)
  }).then((responseBody) => mapResponse(responseBody));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toSafeNumber(value: unknown, fallback = 0): number {
  const toNumber = (candidate: number) =>
    Number.isFinite(candidate) ? candidate : fallback;

  if (typeof value === 'number') {
    return toNumber(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return toNumber(Number(value));
  }

  if (typeof value === 'bigint') {
    return toNumber(Number(value));
  }

  return fallback;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === 'bigint') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function mapPostgresInfoResponse(
  responseBody: unknown
): PostgresAdminInfoResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const info = isRecord(response['info']) ? response['info'] : {};

  return {
    status: 'ok',
    info: {
      host: typeof info['host'] === 'string' ? info['host'] : null,
      port: toNullableNumber(info['port']),
      database: typeof info['database'] === 'string' ? info['database'] : null,
      user: typeof info['user'] === 'string' ? info['user'] : null
    },
    serverVersion:
      typeof response['serverVersion'] === 'string'
        ? response['serverVersion']
        : null
  };
}

function mapPostgresTablesResponse(
  responseBody: unknown
): PostgresTablesResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const tableRows = Array.isArray(response['tables']) ? response['tables'] : [];

  return {
    tables: tableRows
      .filter((tableRow) => isRecord(tableRow))
      .map((tableRow) => ({
        schema:
          typeof tableRow['schema'] === 'string' ? tableRow['schema'] : '',
        name: typeof tableRow['name'] === 'string' ? tableRow['name'] : '',
        rowCount: toSafeNumber(tableRow['rowCount']),
        totalBytes: toSafeNumber(tableRow['totalBytes']),
        tableBytes: toSafeNumber(tableRow['tableBytes']),
        indexBytes: toSafeNumber(tableRow['indexBytes'])
      }))
  };
}

function mapPostgresColumnsResponse(
  responseBody: unknown
): PostgresColumnsResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const columns = Array.isArray(response['columns']) ? response['columns'] : [];

  return {
    columns: columns
      .filter((column) => isRecord(column))
      .map((column) => ({
        name: typeof column['name'] === 'string' ? column['name'] : '',
        type: typeof column['type'] === 'string' ? column['type'] : '',
        nullable: Boolean(column['nullable']),
        defaultValue:
          typeof column['defaultValue'] === 'string'
            ? column['defaultValue']
            : null,
        ordinalPosition: toSafeNumber(column['ordinalPosition'])
      }))
  };
}

function mapPostgresRowsResponse(responseBody: unknown): PostgresRowsResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const rows = Array.isArray(response['rows']) ? response['rows'] : [];

  return {
    rows: rows.filter((row) => isRecord(row)),
    totalCount: toSafeNumber(response['totalCount']),
    limit: toSafeNumber(response['limit']),
    offset: toSafeNumber(response['offset'])
  };
}

function mapRedisKeysResponse(responseBody: unknown): RedisKeysResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const keys = Array.isArray(response['keys']) ? response['keys'] : [];

  return {
    keys: keys
      .filter((entry) => isRecord(entry))
      .map((entry) => ({
        key: typeof entry['key'] === 'string' ? entry['key'] : '',
        type: typeof entry['type'] === 'string' ? entry['type'] : '',
        ttl: toSafeNumber(entry['ttl'])
      })),
    cursor: typeof response['cursor'] === 'string' ? response['cursor'] : '',
    hasMore: Boolean(response['hasMore'])
  };
}

function mapRedisValueResponse(responseBody: unknown): RedisKeyValueResponse {
  const response = isRecord(responseBody) ? responseBody : {};
  const valueField = isRecord(response['value']) ? response['value'] : {};

  let value: RedisKeyValueResponse['value'] = null;
  if (typeof valueField['stringValue'] === 'string') {
    value = valueField['stringValue'];
  } else if (
    isRecord(valueField['listValue']) &&
    Array.isArray(valueField['listValue']['values'])
  ) {
    value = valueField['listValue']['values'].filter(
      (entry): entry is string => typeof entry === 'string'
    );
  } else if (
    isRecord(valueField['mapValue']) &&
    isRecord(valueField['mapValue']['entries'])
  ) {
    const entries = valueField['mapValue']['entries'];
    const mappedEntries: Record<string, string> = {};
    for (const [key, entryValue] of Object.entries(entries)) {
      if (typeof entryValue === 'string') {
        mappedEntries[key] = entryValue;
      }
    }
    value = mappedEntries;
  }

  return {
    key: typeof response['key'] === 'string' ? response['key'] : '',
    type: typeof response['type'] === 'string' ? response['type'] : '',
    ttl: toSafeNumber(response['ttl']),
    value
  };
}

function mapDeleteRedisKeyResponse(responseBody: unknown): {
  deleted: boolean;
} {
  const response = isRecord(responseBody) ? responseBody : {};
  if (typeof response['deleted'] === 'boolean') {
    return { deleted: response['deleted'] };
  }
  return { deleted: false };
}

function mapRedisDbSizeResponse(responseBody: unknown): { count: number } {
  const response = isRecord(responseBody) ? responseBody : {};
  if (
    typeof response['count'] === 'number' ||
    typeof response['count'] === 'string'
  ) {
    return { count: toSafeNumber(response['count']) };
  }
  return { count: 0 };
}

function requestAi<T>(
  methodName: string,
  requestBody: Record<string, unknown>
): Promise<T> {
  return request<T>(`${AI_CONNECT_BASE_PATH}/${methodName}`, {
    fetchOptions: createConnectJsonPostInit(requestBody)
  });
}

export const api = {
  admin: {
    getContext: () =>
      requestAdminV2<AdminAccessContextResponse>(
        'GetContext',
        {},
        mapContextResponse
      ),
    postgres: {
      getInfo: () =>
        requestAdminV2<PostgresAdminInfoResponse>(
          'GetPostgresInfo',
          {},
          mapPostgresInfoResponse
        ),
      getTables: () =>
        requestAdminV2<PostgresTablesResponse>(
          'GetTables',
          {},
          mapPostgresTablesResponse
        ),
      getColumns: (schema: string, table: string) =>
        requestAdminV2<PostgresColumnsResponse>(
          'GetColumns',
          {
            schema,
            table
          },
          mapPostgresColumnsResponse
        ),
      getRows: (
        schema: string,
        table: string,
        options?: {
          limit?: number;
          offset?: number;
          sortColumn?: string;
          sortDirection?: 'asc' | 'desc';
        }
      ) => {
        const requestBody: Record<string, unknown> = { schema, table };
        if (options?.limit) requestBody['limit'] = options.limit;
        if (options?.offset) requestBody['offset'] = options.offset;
        if (options?.sortColumn) requestBody['sortColumn'] = options.sortColumn;
        if (options?.sortDirection) {
          requestBody['sortDirection'] = options.sortDirection;
        }
        return requestAdminV2<PostgresRowsResponse>(
          'GetRows',
          requestBody,
          mapPostgresRowsResponse
        );
      }
    },
    redis: {
      getKeys: (cursor?: string, limit?: number) => {
        const requestBody: Record<string, unknown> = {};
        if (cursor) requestBody['cursor'] = cursor;
        if (limit) requestBody['limit'] = limit;
        return requestAdminV2<RedisKeysResponse>(
          'GetRedisKeys',
          requestBody,
          mapRedisKeysResponse
        );
      },
      getValue: (key: string) =>
        requestAdminV2<RedisKeyValueResponse>(
          'GetRedisValue',
          { key },
          mapRedisValueResponse
        ),
      deleteKey: (key: string) =>
        requestAdminV2<{ deleted: boolean }>(
          'DeleteRedisKey',
          { key },
          mapDeleteRedisKeyResponse
        ),
      getDbSize: () =>
        requestAdminV2<{ count: number }>(
          'GetRedisDbSize',
          {},
          mapRedisDbSizeResponse
        )
    },
    groups: {
      list: (options?: { organizationId?: string }) => {
        const requestBody: Record<string, unknown> = {};
        if (options?.organizationId) {
          requestBody['organizationId'] = options.organizationId;
        }
        return requestAdminJson<GroupsListResponse>('ListGroups', requestBody);
      },
      get: (id: string) =>
        requestAdminJson<GroupDetailResponse>('GetGroup', { id }),
      create: (data: CreateGroupRequest) =>
        requestAdminJson<{ group: Group }>('CreateGroup', {
          json: JSON.stringify(data)
        }),
      update: (id: string, data: UpdateGroupRequest) =>
        requestAdminJson<{ group: Group }>('UpdateGroup', {
          id,
          json: JSON.stringify(data)
        }),
      delete: (id: string) =>
        requestAdminJson<{ deleted: boolean }>('DeleteGroup', { id }),
      getMembers: (id: string) =>
        requestAdminJson<GroupMembersResponse>('GetGroupMembers', { id }),
      addMember: (groupId: string, userId: string) =>
        requestAdminJson<{ added: boolean }>('AddGroupMember', {
          id: groupId,
          json: JSON.stringify({ userId })
        }),
      removeMember: (groupId: string, userId: string) =>
        requestAdminJson<{ removed: boolean }>('RemoveGroupMember', {
          groupId,
          userId
        })
    },
    organizations: {
      list: (options?: { organizationId?: string }) => {
        const requestBody: Record<string, unknown> = {};
        if (options?.organizationId) {
          requestBody['organizationId'] = options.organizationId;
        }
        return requestAdminJson<OrganizationsListResponse>(
          'ListOrganizations',
          requestBody
        );
      },
      get: (id: string) =>
        requestAdminJson<OrganizationResponse>('GetOrganization', { id }),
      getUsers: (id: string) =>
        requestAdminJson<OrganizationUsersResponse>('GetOrgUsers', { id }),
      getGroups: (id: string) =>
        requestAdminJson<OrganizationGroupsResponse>('GetOrgGroups', { id }),
      create: (data: CreateOrganizationRequest) =>
        requestAdminJson<{ organization: Organization }>('CreateOrganization', {
          json: JSON.stringify(data)
        }),
      update: (id: string, data: UpdateOrganizationRequest) =>
        requestAdminJson<{ organization: Organization }>('UpdateOrganization', {
          id,
          json: JSON.stringify(data)
        }),
      delete: (id: string) =>
        requestAdminJson<{ deleted: boolean }>('DeleteOrganization', { id })
    },
    users: {
      list: (options?: { organizationId?: string }) => {
        const requestBody: Record<string, unknown> = {};
        if (options?.organizationId) {
          requestBody['organizationId'] = options.organizationId;
        }
        return requestAdminJson<AdminUsersResponse>('ListUsers', requestBody);
      },
      get: (id: string) =>
        requestAdminJson<AdminUserResponse>('GetUser', { id }),
      update: (id: string, data: AdminUserUpdatePayload) =>
        requestAdminJson<AdminUserUpdateResponse>('UpdateUser', {
          id,
          json: JSON.stringify(data)
        })
    }
  },
  ai: {
    getUsage: (options?: {
      startDate?: string;
      endDate?: string;
      cursor?: string;
      limit?: number;
    }) => requestAi<AiUsageListResponse>('GetUsage', options ?? {})
  }
};
