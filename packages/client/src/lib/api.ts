import type {
  AddAiMessageRequest,
  AddAiMessageResponse,
  AdminUserResponse,
  AdminUsersResponse,
  AdminUserUpdatePayload,
  AdminUserUpdateResponse,
  AiConversationDetailResponse,
  AiConversationResponse,
  AiConversationsListResponse,
  AiUsageListResponse,
  AiUsageSummaryResponse,
  AuthResponse,
  CreateAiConversationRequest,
  CreateAiConversationResponse,
  CreateGroupRequest,
  CreateOrganizationRequest,
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  Group,
  GroupDetailResponse,
  GroupMembersResponse,
  GroupsListResponse,
  Organization,
  OrganizationGroupsResponse,
  OrganizationResponse,
  OrganizationsListResponse,
  OrganizationUsersResponse,
  PingData,
  PostgresAdminInfoResponse,
  PostgresColumnsResponse,
  PostgresRowsResponse,
  PostgresTablesResponse,
  RecordAiUsageRequest,
  RecordAiUsageResponse,
  RedisKeysResponse,
  RedisKeyValueResponse,
  SessionsResponse,
  ShareTargetSearchResponse,
  UpdateAiConversationRequest,
  UpdateGroupRequest,
  UpdateOrganizationRequest,
  UpdateVfsShareRequest,
  VfsKeySetupRequest,
  VfsOrgShare,
  VfsRegisterRequest,
  VfsRegisterResponse,
  VfsShare,
  VfsSharesResponse,
  VfsShareType,
  VfsUserKeysResponse
} from '@rapid/shared';
import type { AnalyticsEventSlug } from '@/db/analytics';
import { logApiEvent } from '@/db/analytics';
import {
  clearStoredAuth,
  getAuthHeaderValue,
  getStoredRefreshToken,
  setSessionExpiredError,
  updateStoredTokens
} from '@/lib/auth-storage';

export const API_BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

let refreshPromise: Promise<boolean> | null = null;

async function attemptTokenRefresh(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken || !API_BASE_URL) {
    return false;
  }

  const startTime = performance.now();
  let success = false;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as AuthResponse;
    updateStoredTokens(data.accessToken, data.refreshToken);
    success = true;
    return true;
  } catch (error) {
    console.error('Token refresh attempt failed:', error);
    return false;
  } finally {
    const durationMs = performance.now() - startTime;
    void logApiEvent('api_post_auth_refresh', durationMs, success);
  }
}

/**
 * Attempts to refresh the token. Returns true if successful.
 * Can be called from SSE or other contexts that don't go through the API wrapper.
 * Uses deduplication to prevent concurrent refresh attempts.
 */
export async function tryRefreshToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = attemptTokenRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  const refreshed = await refreshPromise;
  if (!refreshed) {
    setSessionExpiredError();
    clearStoredAuth();
  }
  return refreshed;
}

// API event slugs - subset of AnalyticsEventSlug for API calls
type ApiEventSlug = Extract<AnalyticsEventSlug, `api_${string}`>;

interface RequestParams {
  fetchOptions?: RequestInit;
  eventName: ApiEventSlug;
  /** Skip token refresh on 401 (e.g., for login requests where 401 means invalid credentials) */
  skipTokenRefresh?: boolean;
}

async function getErrorMessageFromResponse(
  response: Response,
  defaultMessage: string
): Promise<string> {
  try {
    const errorBody = (await response.json()) as { error?: string };
    return errorBody.error ?? defaultMessage;
  } catch {
    return defaultMessage;
  }
}

async function request<T>(endpoint: string, params: RequestParams): Promise<T> {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  const { fetchOptions, eventName, skipTokenRefresh } = params;
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

    if (response.status === 401) {
      // For login requests, 401 means invalid credentials - don't trigger session expired flow
      if (skipTokenRefresh) {
        throw new Error(
          await getErrorMessageFromResponse(response, 'API error: 401')
        );
      }

      if (!refreshPromise) {
        refreshPromise = attemptTokenRefresh().finally(() => {
          refreshPromise = null;
        });
      }

      const refreshed = await refreshPromise;
      if (refreshed) {
        const newAuthHeader = getAuthHeaderValue();
        if (newAuthHeader) {
          const retryHeaders = new Headers(requestInit.headers);
          retryHeaders.set('Authorization', newAuthHeader);
          const retryResponse = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...requestInit,
            headers: retryHeaders
          });

          if (retryResponse.ok) {
            const data = await retryResponse.json();
            success = true;
            return data;
          }
        }
      }

      setSessionExpiredError();
      clearStoredAuth();
      throw new Error('API error: 401');
    }

    if (!response.ok) {
      throw new Error(
        await getErrorMessageFromResponse(
          response,
          `API error: ${response.status}`
        )
      );
    }

    if (response.status === 204 || response.status === 205) {
      success = true;
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      success = true;
      return undefined as T;
    }

    const data = JSON.parse(text) as T;
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
        eventName: 'api_post_auth_login',
        skipTokenRefresh: true
      }),
    register: (email: string, password: string) =>
      request<AuthResponse>('/auth/register', {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        },
        eventName: 'api_post_auth_register',
        skipTokenRefresh: true
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
      ),
    logout: () =>
      request<{ loggedOut: boolean }>('/auth/logout', {
        fetchOptions: { method: 'POST' },
        eventName: 'api_post_auth_logout'
      })
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
        request<{ group: Group }>(`/admin/groups/${encodeURIComponent(id)}`, {
          fetchOptions: {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          },
          eventName: 'api_put_admin_group'
        }),
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
    },
    organizations: {
      list: () =>
        request<OrganizationsListResponse>('/admin/organizations', {
          eventName: 'api_get_admin_organizations'
        }),
      get: (id: string) =>
        request<OrganizationResponse>(
          `/admin/organizations/${encodeURIComponent(id)}`,
          { eventName: 'api_get_admin_organization' }
        ),
      getUsers: (id: string) =>
        request<OrganizationUsersResponse>(
          `/admin/organizations/${encodeURIComponent(id)}/users`,
          { eventName: 'api_get_admin_organization_users' }
        ),
      getGroups: (id: string) =>
        request<OrganizationGroupsResponse>(
          `/admin/organizations/${encodeURIComponent(id)}/groups`,
          { eventName: 'api_get_admin_organization_groups' }
        ),
      create: (data: CreateOrganizationRequest) =>
        request<{ organization: Organization }>('/admin/organizations', {
          fetchOptions: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          },
          eventName: 'api_post_admin_organization'
        }),
      update: (id: string, data: UpdateOrganizationRequest) =>
        request<{ organization: Organization }>(
          `/admin/organizations/${encodeURIComponent(id)}`,
          {
            fetchOptions: {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            },
            eventName: 'api_put_admin_organization'
          }
        ),
      delete: (id: string) =>
        request<{ deleted: boolean }>(
          `/admin/organizations/${encodeURIComponent(id)}`,
          {
            fetchOptions: { method: 'DELETE' },
            eventName: 'api_delete_admin_organization'
          }
        )
    },
    users: {
      list: () =>
        request<AdminUsersResponse>('/admin/users', {
          eventName: 'api_get_admin_users'
        }),
      get: (id: string) =>
        request<AdminUserResponse>(`/admin/users/${encodeURIComponent(id)}`, {
          eventName: 'api_get_admin_user'
        }),
      update: (id: string, data: AdminUserUpdatePayload) =>
        request<AdminUserUpdateResponse>(
          `/admin/users/${encodeURIComponent(id)}`,
          {
            fetchOptions: {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            },
            eventName: 'api_patch_admin_user'
          }
        )
    }
  },
  vfs: {
    getMyKeys: () =>
      request<VfsUserKeysResponse>('/vfs/keys/me', {
        eventName: 'api_get_vfs_keys'
      }),
    setupKeys: (data: VfsKeySetupRequest) =>
      request<{ created: boolean }>('/vfs/keys', {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_vfs_keys'
      }),
    register: (data: VfsRegisterRequest) =>
      request<VfsRegisterResponse>('/vfs/register', {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_vfs_register'
      }),
    getShares: (itemId: string) =>
      request<VfsSharesResponse>(
        `/vfs/items/${encodeURIComponent(itemId)}/shares`,
        { eventName: 'api_get_vfs_shares' }
      ),
    createShare: (data: CreateVfsShareRequest) =>
      request<{ share: VfsShare }>(
        `/vfs/items/${encodeURIComponent(data.itemId)}/shares`,
        {
          fetchOptions: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shareType: data.shareType,
              targetId: data.targetId,
              permissionLevel: data.permissionLevel,
              expiresAt: data.expiresAt
            })
          },
          eventName: 'api_post_vfs_share'
        }
      ).then((r) => r.share),
    updateShare: (shareId: string, data: UpdateVfsShareRequest) =>
      request<{ share: VfsShare }>(
        `/vfs/shares/${encodeURIComponent(shareId)}`,
        {
          fetchOptions: {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          },
          eventName: 'api_patch_vfs_share'
        }
      ).then((r) => r.share),
    deleteShare: (shareId: string) =>
      request<{ deleted: boolean }>(
        `/vfs/shares/${encodeURIComponent(shareId)}`,
        {
          fetchOptions: { method: 'DELETE' },
          eventName: 'api_delete_vfs_share'
        }
      ),
    createOrgShare: (data: CreateOrgShareRequest) =>
      request<{ orgShare: VfsOrgShare }>(
        `/vfs/items/${encodeURIComponent(data.itemId)}/org-shares`,
        {
          fetchOptions: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceOrgId: data.sourceOrgId,
              targetOrgId: data.targetOrgId,
              permissionLevel: data.permissionLevel,
              expiresAt: data.expiresAt
            })
          },
          eventName: 'api_post_vfs_org_share'
        }
      ).then((r) => r.orgShare),
    deleteOrgShare: (shareId: string) =>
      request<{ deleted: boolean }>(
        `/vfs/org-shares/${encodeURIComponent(shareId)}`,
        {
          fetchOptions: { method: 'DELETE' },
          eventName: 'api_delete_vfs_org_share'
        }
      ),
    searchShareTargets: (query: string, type?: VfsShareType) => {
      const params = new URLSearchParams({ q: query });
      if (type) params.set('type', type);
      return request<ShareTargetSearchResponse>(
        `/vfs/share-targets/search?${params.toString()}`,
        { eventName: 'api_get_vfs_share_targets' }
      );
    }
  },
  ai: {
    createConversation: (data: CreateAiConversationRequest) =>
      request<CreateAiConversationResponse>('/ai/conversations', {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_ai_conversation'
      }),
    listConversations: (options?: { cursor?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (options?.cursor) params.set('cursor', options.cursor);
      if (options?.limit) params.set('limit', String(options.limit));
      const query = params.toString();
      return request<AiConversationsListResponse>(
        `/ai/conversations${query ? `?${query}` : ''}`,
        { eventName: 'api_get_ai_conversations' }
      );
    },
    getConversation: (id: string) =>
      request<AiConversationDetailResponse>(
        `/ai/conversations/${encodeURIComponent(id)}`,
        { eventName: 'api_get_ai_conversation' }
      ),
    updateConversation: (id: string, data: UpdateAiConversationRequest) =>
      request<AiConversationResponse>(
        `/ai/conversations/${encodeURIComponent(id)}`,
        {
          fetchOptions: {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          },
          eventName: 'api_patch_ai_conversation'
        }
      ),
    deleteConversation: (id: string) =>
      request<void>(`/ai/conversations/${encodeURIComponent(id)}`, {
        fetchOptions: { method: 'DELETE' },
        eventName: 'api_delete_ai_conversation'
      }),
    addMessage: (conversationId: string, data: AddAiMessageRequest) =>
      request<AddAiMessageResponse>(
        `/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          fetchOptions: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          },
          eventName: 'api_post_ai_message'
        }
      ),
    recordUsage: (data: RecordAiUsageRequest) =>
      request<RecordAiUsageResponse>('/ai/usage', {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_ai_usage'
      }),
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
        `/ai/usage${query ? `?${query}` : ''}`,
        { eventName: 'api_get_ai_usage' }
      );
    },
    getUsageSummary: (options?: { startDate?: string; endDate?: string }) => {
      const params = new URLSearchParams();
      if (options?.startDate) params.set('startDate', options.startDate);
      if (options?.endDate) params.set('endDate', options.endDate);
      const query = params.toString();
      return request<AiUsageSummaryResponse>(
        `/ai/usage/summary${query ? `?${query}` : ''}`,
        { eventName: 'api_get_ai_usage_summary' }
      );
    }
  }
};
