import type {
  AdminAccessContextResponse,
  AdminUserResponse,
  AdminUsersResponse,
  AdminUserUpdatePayload,
  AdminUserUpdateResponse,
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
import { request } from '../apiCore';

export const adminRoutes = {
  getContext: () =>
    request<AdminAccessContextResponse>('/admin/context', {
      eventName: 'api_get_admin_organizations'
    }),
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
    list: (options?: { organizationId?: string }) => {
      const params = new URLSearchParams();
      if (options?.organizationId) {
        params.set('organizationId', options.organizationId);
      }
      const query = params.toString();
      return request<GroupsListResponse>(
        `/admin/groups${query ? `?${query}` : ''}`,
        {
          eventName: 'api_get_admin_groups'
        }
      );
    },
    get: (id: string) =>
      request<GroupDetailResponse>(`/admin/groups/${encodeURIComponent(id)}`, {
        eventName: 'api_get_admin_group'
      }),
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
      request<{ deleted: boolean }>(`/admin/groups/${encodeURIComponent(id)}`, {
        fetchOptions: { method: 'DELETE' },
        eventName: 'api_delete_admin_group'
      }),
    getMembers: (id: string) =>
      request<GroupMembersResponse>(
        `/admin/groups/${encodeURIComponent(id)}/members`,
        {
          eventName: 'api_get_admin_group_members'
        }
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
    list: (options?: { organizationId?: string }) => {
      const params = new URLSearchParams();
      if (options?.organizationId) {
        params.set('organizationId', options.organizationId);
      }
      const query = params.toString();
      return request<OrganizationsListResponse>(
        `/admin/organizations${query ? `?${query}` : ''}`,
        {
          eventName: 'api_get_admin_organizations'
        }
      );
    },
    get: (id: string) =>
      request<OrganizationResponse>(
        `/admin/organizations/${encodeURIComponent(id)}`,
        {
          eventName: 'api_get_admin_organization'
        }
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
    list: (options?: { organizationId?: string }) => {
      const params = new URLSearchParams();
      if (options?.organizationId) {
        params.set('organizationId', options.organizationId);
      }
      const query = params.toString();
      return request<AdminUsersResponse>(
        `/admin/users${query ? `?${query}` : ''}`,
        {
          eventName: 'api_get_admin_users'
        }
      );
    },
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
};
