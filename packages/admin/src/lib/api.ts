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

const API_BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

const ADMIN_CONNECT_BASE_PATH = '/connect/tearleads.v1.AdminService';
const AI_CONNECT_BASE_PATH = '/connect/tearleads.v1.AiService';

interface RequestParams {
  fetchOptions?: RequestInit;
}

interface ConnectJsonEnvelopeResponse {
  json: string;
}

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
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

function parseConnectJson<T>(json: unknown): T {
  if (typeof json !== 'string') {
    return JSON.parse('{}');
  }
  const trimmed = json.trim();
  if (trimmed.length === 0) {
    return JSON.parse('{}');
  }
  return JSON.parse(trimmed);
}

function requestAdminJson<T>(
  methodName: string,
  requestBody: Record<string, unknown>
): Promise<T> {
  return request<ConnectJsonEnvelopeResponse>(
    `${ADMIN_CONNECT_BASE_PATH}/${methodName}`,
    {
      fetchOptions: jsonPost(requestBody)
    }
  ).then((response) => parseConnectJson<T>(response?.json));
}

function requestAi<T>(
  methodName: string,
  requestBody: Record<string, unknown>
): Promise<T> {
  return request<T>(`${AI_CONNECT_BASE_PATH}/${methodName}`, {
    fetchOptions: jsonPost(requestBody)
  });
}

export const api = {
  admin: {
    getContext: () =>
      requestAdminJson<AdminAccessContextResponse>('GetContext', {}),
    postgres: {
      getInfo: () =>
        requestAdminJson<PostgresAdminInfoResponse>('GetPostgresInfo', {}),
      getTables: () =>
        requestAdminJson<PostgresTablesResponse>('GetTables', {}),
      getColumns: (schema: string, table: string) =>
        requestAdminJson<PostgresColumnsResponse>('GetColumns', {
          schema,
          table
        }),
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
        return requestAdminJson<PostgresRowsResponse>('GetRows', requestBody);
      }
    },
    redis: {
      getKeys: (cursor?: string, limit?: number) => {
        const requestBody: Record<string, unknown> = {};
        if (cursor) requestBody['cursor'] = cursor;
        if (limit) requestBody['limit'] = limit;
        return requestAdminJson<RedisKeysResponse>('GetRedisKeys', requestBody);
      },
      getValue: (key: string) =>
        requestAdminJson<RedisKeyValueResponse>('GetRedisValue', { key }),
      deleteKey: (key: string) =>
        requestAdminJson<{ deleted: boolean }>('DeleteRedisKey', { key }),
      getDbSize: () => requestAdminJson<{ count: number }>('GetRedisDbSize', {})
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
