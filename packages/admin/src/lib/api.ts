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

interface RequestParams {
  fetchOptions?: RequestInit;
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
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        message = body.error;
      }
    } catch (e) {
      // ignore json parse failures, but log for debugging
      console.warn('Failed to parse API error response as JSON:', e);
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

export const api = {
  admin: {
    getContext: () => request<AdminAccessContextResponse>('/admin/context'),
    postgres: {
      getInfo: () => request<PostgresAdminInfoResponse>('/admin/postgres/info'),
      getTables: () =>
        request<PostgresTablesResponse>('/admin/postgres/tables'),
      getColumns: (schema: string, table: string) =>
        request<PostgresColumnsResponse>(
          `/admin/postgres/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/columns`
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
        const params = new URLSearchParams();
        if (options?.limit) params.set('limit', String(options.limit));
        if (options?.offset) params.set('offset', String(options.offset));
        if (options?.sortColumn) params.set('sortColumn', options.sortColumn);
        if (options?.sortDirection)
          params.set('sortDirection', options.sortDirection);
        const query = params.toString();
        return request<PostgresRowsResponse>(
          `/admin/postgres/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows${query ? `?${query}` : ''}`
        );
      }
    },
    redis: {
      getKeys: (cursor?: string, limit?: number) => {
        const params = new URLSearchParams();
        if (cursor) params.set('cursor', cursor);
        if (limit) params.set('limit', String(limit));
        const query = params.toString();
        return request<RedisKeysResponse>(
          `/admin/redis/keys${query ? `?${query}` : ''}`
        );
      },
      getValue: (key: string) =>
        request<RedisKeyValueResponse>(
          `/admin/redis/keys/${encodeURIComponent(key)}`
        ),
      deleteKey: (key: string) =>
        request<{ deleted: boolean }>(
          `/admin/redis/keys/${encodeURIComponent(key)}`,
          {
            fetchOptions: { method: 'DELETE' }
          }
        ),
      getDbSize: () => request<{ count: number }>('/admin/redis/dbsize')
    },
    groups: {
      list: (options?: { organizationId?: string }) => {
        const params = new URLSearchParams();
        if (options?.organizationId)
          params.set('organizationId', options.organizationId);
        const query = params.toString();
        return request<GroupsListResponse>(
          `/admin/groups${query ? `?${query}` : ''}`
        );
      },
      get: (id: string) =>
        request<GroupDetailResponse>(`/admin/groups/${encodeURIComponent(id)}`),
      create: (data: CreateGroupRequest) =>
        request<{ group: Group }>('/admin/groups', {
          fetchOptions: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          }
        }),
      update: (id: string, data: UpdateGroupRequest) =>
        request<{ group: Group }>(`/admin/groups/${encodeURIComponent(id)}`, {
          fetchOptions: {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          }
        }),
      delete: (id: string) =>
        request<{ deleted: boolean }>(
          `/admin/groups/${encodeURIComponent(id)}`,
          {
            fetchOptions: { method: 'DELETE' }
          }
        ),
      getMembers: (id: string) =>
        request<GroupMembersResponse>(
          `/admin/groups/${encodeURIComponent(id)}/members`
        ),
      addMember: (groupId: string, userId: string) =>
        request<{ added: boolean }>(
          `/admin/groups/${encodeURIComponent(groupId)}/members`,
          {
            fetchOptions: {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId })
            }
          }
        ),
      removeMember: (groupId: string, userId: string) =>
        request<{ removed: boolean }>(
          `/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
          { fetchOptions: { method: 'DELETE' } }
        )
    },
    organizations: {
      list: (options?: { organizationId?: string }) => {
        const params = new URLSearchParams();
        if (options?.organizationId)
          params.set('organizationId', options.organizationId);
        const query = params.toString();
        return request<OrganizationsListResponse>(
          `/admin/organizations${query ? `?${query}` : ''}`
        );
      },
      get: (id: string) =>
        request<OrganizationResponse>(
          `/admin/organizations/${encodeURIComponent(id)}`
        ),
      getUsers: (id: string) =>
        request<OrganizationUsersResponse>(
          `/admin/organizations/${encodeURIComponent(id)}/users`
        ),
      getGroups: (id: string) =>
        request<OrganizationGroupsResponse>(
          `/admin/organizations/${encodeURIComponent(id)}/groups`
        ),
      create: (data: CreateOrganizationRequest) =>
        request<{ organization: Organization }>('/admin/organizations', {
          fetchOptions: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          }
        }),
      update: (id: string, data: UpdateOrganizationRequest) =>
        request<{ organization: Organization }>(
          `/admin/organizations/${encodeURIComponent(id)}`,
          {
            fetchOptions: {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            }
          }
        ),
      delete: (id: string) =>
        request<{ deleted: boolean }>(
          `/admin/organizations/${encodeURIComponent(id)}`,
          {
            fetchOptions: { method: 'DELETE' }
          }
        )
    },
    users: {
      list: (options?: { organizationId?: string }) => {
        const params = new URLSearchParams();
        if (options?.organizationId)
          params.set('organizationId', options.organizationId);
        const query = params.toString();
        return request<AdminUsersResponse>(
          `/admin/users${query ? `?${query}` : ''}`
        );
      },
      get: (id: string) =>
        request<AdminUserResponse>(`/admin/users/${encodeURIComponent(id)}`),
      update: (id: string, data: AdminUserUpdatePayload) =>
        request<AdminUserUpdateResponse>(
          `/admin/users/${encodeURIComponent(id)}`,
          {
            fetchOptions: {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            }
          }
        )
    }
  },
  ai: {
    getUsage: (options?: {
      startDate?: string;
      endDate?: string;
      cursor?: string;
      limit?: number;
    }) => {
      const params = new URLSearchParams();
      if (options?.startDate) params.set('startDate', options.startDate);
      if (options?.endDate) params.set('endDate', options.endDate);
      if (options?.cursor) params.set('cursor', options.cursor);
      if (options?.limit) params.set('limit', String(options.limit));
      const query = params.toString();
      return request<AiUsageListResponse>(
        `/ai/usage${query ? `?${query}` : ''}`
      );
    }
  }
};
