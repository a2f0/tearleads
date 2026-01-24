import type {
  AdminUserResponse,
  AdminUsersResponse,
  AdminUserUpdatePayload,
  AdminUserUpdateResponse,
  AuthResponse,
  CreateGroupRequest,
  Group,
  GroupDetailResponse,
  GroupMembersResponse,
  GroupsListResponse,
  PingData,
  PostgresAdminInfoResponse,
  PostgresColumnsResponse,
  PostgresRowsResponse,
  PostgresTablesResponse,
  RedisKeysResponse,
  RedisKeyValueResponse,
  SessionsResponse,
  UpdateGroupRequest
} from '@rapid/shared';
import type { AnalyticsEventSlug } from '@/db/analytics';
import { logApiEvent } from '@/db/analytics';
import {
  clearStoredAuth,
  getAuthHeaderValue,
  setSessionExpiredError
} from '@/lib/auth-storage';

export const API_BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

// API event slugs - subset of AnalyticsEventSlug for API calls
type ApiEventSlug = Extract<AnalyticsEventSlug, `api_${string}`>;

interface RequestParams {
  fetchOptions?: RequestInit;
  eventName: ApiEventSlug;
}

async function request<T>(endpoint: string, params: RequestParams): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  const { fetchOptions, eventName } = params;
  const startTime = performance.now();
  let success = false;
  const authHeader = getAuthHeaderValue();
  const requestInit: RequestInit = { ...fetchOptions };
  if (authHeader) {
    const headers = new Headers(requestInit.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', authHeader);
      requestInit.headers = headers;
    }
  }

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, requestInit);

    if (!response.ok) {
      if (response.status === 401) {
        setSessionExpiredError();
        clearStoredAuth();
      }
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    success = true;
    return data;
  } finally {
    const durationMs = performance.now() - startTime;
    void logApiEvent(eventName, durationMs, success);
  }
}

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<AuthResponse>('/auth/login', {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        },
        eventName: 'api_post_auth_login'
      }),
    getSessions: () =>
      request<SessionsResponse>('/auth/sessions', {
        eventName: 'api_get_auth_sessions'
      }),
    deleteSession: (sessionId: string) =>
      request<{ deleted: boolean }>(
        `/auth/sessions/${encodeURIComponent(sessionId)}`,
        {
          fetchOptions: { method: 'DELETE' },
          eventName: 'api_delete_auth_session'
        }
      )
  },
  ping: {
    get: () => request<PingData>('/ping', { eventName: 'api_get_ping' })
  },
  admin: {
    postgres: {
      getInfo: () =>
        request<PostgresAdminInfoResponse>('/admin/postgres/info', {
          eventName: 'api_get_admin_postgres_info'
        }),
      getTables: () =>
        request<PostgresTablesResponse>('/admin/postgres/tables', {
          eventName: 'api_get_admin_postgres_tables'
        }),
      getColumns: (schema: string, table: string) =>
        request<PostgresColumnsResponse>(
          `/admin/postgres/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/columns`,
          { eventName: 'api_get_admin_postgres_columns' }
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
          `/admin/postgres/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows${query ? `?${query}` : ''}`,
          { eventName: 'api_get_admin_postgres_rows' }
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
          `/admin/redis/keys${query ? `?${query}` : ''}`,
          { eventName: 'api_get_admin_redis_keys' }
        );
      },
      getValue: (key: string) =>
        request<RedisKeyValueResponse>(
          `/admin/redis/keys/${encodeURIComponent(key)}`,
          { eventName: 'api_get_admin_redis_key' }
        ),
      deleteKey: (key: string) =>
        request<{ deleted: boolean }>(
          `/admin/redis/keys/${encodeURIComponent(key)}`,
          {
            fetchOptions: { method: 'DELETE' },
            eventName: 'api_delete_admin_redis_key'
          }
        ),
      getDbSize: () =>
        request<{ count: number }>('/admin/redis/dbsize', {
          eventName: 'api_get_admin_redis_dbsize'
        })
    },
    groups: {
      list: () =>
        request<GroupsListResponse>('/admin/groups', {
          eventName: 'api_get_admin_groups'
        }),
      get: (id: string) =>
        request<GroupDetailResponse>(
          `/admin/groups/${encodeURIComponent(id)}`,
          { eventName: 'api_get_admin_group' }
        ),
      create: (data: CreateGroupRequest) =>
        request<{ group: Group }>('/admin/groups', {
          fetchOptions: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          },
          eventName: 'api_post_admin_group'
        }),
      update: (id: string, data: UpdateGroupRequest) =>
        request<{ group: Group }>(
          `/admin/groups/${encodeURIComponent(id)}`,
          {
            fetchOptions: {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            },
            eventName: 'api_put_admin_group'
          }
        ),
      delete: (id: string) =>
        request<{ deleted: boolean }>(
          `/admin/groups/${encodeURIComponent(id)}`,
          {
            fetchOptions: { method: 'DELETE' },
            eventName: 'api_delete_admin_group'
          }
        ),
      getMembers: (id: string) =>
        request<GroupMembersResponse>(
          `/admin/groups/${encodeURIComponent(id)}/members`,
          { eventName: 'api_get_admin_group_members' }
        ),
      addMember: (groupId: string, userId: string) =>
        request<{ added: boolean }>(
          `/admin/groups/${encodeURIComponent(groupId)}/members`,
          {
            fetchOptions: {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userId })
            },
            eventName: 'api_post_admin_group_member'
          }
        ),
      removeMember: (groupId: string, userId: string) =>
        request<{ removed: boolean }>(
          `/admin/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
          {
            fetchOptions: { method: 'DELETE' },
            eventName: 'api_delete_admin_group_member'
          }
        )
    }
  }
};
