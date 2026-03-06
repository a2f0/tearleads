import type {
  AdminAccessContextResponse,
  AdminUserResponse,
  AdminUsersResponse,
  AdminUserUpdatePayload,
  AdminUserUpdateResponse,
  AiUsageListResponse,
  CreateGroupRequest,
  CreateOrganizationRequest,
  GroupDetailResponse,
  GroupMembersResponse,
  GroupsListResponse,
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
import { createConnectJsonPostInit } from '@tearleads/shared';
import {
  mapAddGroupMemberResponse,
  mapDeleteGroupResponse,
  mapDeleteOrganizationResponse,
  mapDeleteRedisKeyResponse,
  mapPostgresColumnsResponse,
  mapPostgresInfoResponse,
  mapPostgresRowsResponse,
  mapPostgresTablesResponse,
  mapRedisDbSizeResponse,
  mapRedisKeysResponse,
  mapRedisValueResponse,
  mapRemoveGroupMemberResponse
} from './adminV2ApiMappers';
import { mapContextResponse } from './adminV2ContextMapper';
import { mapGroupsListResponse } from './adminV2GroupsMapper';
import {
  mapGroupDetailResponse,
  mapGroupMembersResponse,
  mapGroupResponse,
  mapOrganizationGroupsResponse,
  mapOrganizationResponse,
  mapOrganizationsListResponse,
  mapOrganizationUsersResponse,
  mapUserResponse,
  mapUsersListResponse
} from './adminV2ReadMappers';

const API_BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

const ADMIN_V2_CONNECT_BASE_PATH = '/connect/tearleads.v2.AdminService';
const AI_CONNECT_BASE_PATH = '/connect/tearleads.v1.AiService';

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

function requestAdminV2<T>(
  methodName: string,
  requestBody: Record<string, unknown>,
  mapResponse: (responseBody: unknown) => T
): Promise<T> {
  return request<unknown>(`${ADMIN_V2_CONNECT_BASE_PATH}/${methodName}`, {
    fetchOptions: createConnectJsonPostInit(requestBody)
  }).then((responseBody) => mapResponse(responseBody));
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
  adminV2: {
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
        return requestAdminV2<GroupsListResponse>(
          'ListGroups',
          requestBody,
          mapGroupsListResponse
        );
      },
      get: (id: string) =>
        requestAdminV2<GroupDetailResponse>(
          'GetGroup',
          { id },
          mapGroupDetailResponse
        ),
      create: (data: CreateGroupRequest) =>
        requestAdminV2(
          'CreateGroup',
          {
            organizationId: data.organizationId,
            name: data.name,
            ...(data.description !== undefined
              ? { description: data.description }
              : {})
          },
          mapGroupResponse
        ),
      update: (id: string, data: UpdateGroupRequest) =>
        requestAdminV2(
          'UpdateGroup',
          {
            id,
            ...(data.organizationId !== undefined
              ? { organizationId: data.organizationId }
              : {}),
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined
              ? { description: data.description }
              : {})
          },
          mapGroupResponse
        ),
      delete: (id: string) =>
        requestAdminV2('DeleteGroup', { id }, mapDeleteGroupResponse),
      getMembers: (id: string) =>
        requestAdminV2<GroupMembersResponse>(
          'GetGroupMembers',
          { id },
          mapGroupMembersResponse
        ),
      addMember: (groupId: string, userId: string) =>
        requestAdminV2(
          'AddGroupMember',
          {
            id: groupId,
            userId
          },
          mapAddGroupMemberResponse
        ),
      removeMember: (groupId: string, userId: string) =>
        requestAdminV2(
          'RemoveGroupMember',
          {
            groupId,
            userId
          },
          mapRemoveGroupMemberResponse
        )
    },
    organizations: {
      list: (options?: { organizationId?: string }) => {
        const requestBody: Record<string, unknown> = {};
        if (options?.organizationId) {
          requestBody['organizationId'] = options.organizationId;
        }
        return requestAdminV2<OrganizationsListResponse>(
          'ListOrganizations',
          requestBody,
          mapOrganizationsListResponse
        );
      },
      get: (id: string) =>
        requestAdminV2<OrganizationResponse>(
          'GetOrganization',
          { id },
          mapOrganizationResponse
        ),
      getUsers: (id: string) =>
        requestAdminV2<OrganizationUsersResponse>(
          'GetOrgUsers',
          { id },
          mapOrganizationUsersResponse
        ),
      getGroups: (id: string) =>
        requestAdminV2<OrganizationGroupsResponse>(
          'GetOrgGroups',
          { id },
          mapOrganizationGroupsResponse
        ),
      create: (data: CreateOrganizationRequest) =>
        requestAdminV2(
          'CreateOrganization',
          {
            name: data.name,
            ...(data.description !== undefined
              ? { description: data.description }
              : {})
          },
          mapOrganizationResponse
        ),
      update: (id: string, data: UpdateOrganizationRequest) =>
        requestAdminV2(
          'UpdateOrganization',
          {
            id,
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined
              ? { description: data.description }
              : {})
          },
          mapOrganizationResponse
        ),
      delete: (id: string) =>
        requestAdminV2(
          'DeleteOrganization',
          { id },
          mapDeleteOrganizationResponse
        )
    },
    users: {
      list: (options?: { organizationId?: string }) => {
        const requestBody: Record<string, unknown> = {};
        if (options?.organizationId) {
          requestBody['organizationId'] = options.organizationId;
        }
        return requestAdminV2<AdminUsersResponse>(
          'ListUsers',
          requestBody,
          mapUsersListResponse
        );
      },
      get: (id: string) =>
        requestAdminV2<AdminUserResponse>('GetUser', { id }, mapUserResponse),
      update: (id: string, data: AdminUserUpdatePayload) =>
        requestAdminV2<AdminUserUpdateResponse>(
          'UpdateUser',
          {
            id,
            ...(data.email !== undefined ? { email: data.email } : {}),
            ...(data.emailConfirmed !== undefined
              ? { emailConfirmed: data.emailConfirmed }
              : {}),
            ...(data.admin !== undefined ? { admin: data.admin } : {}),
            ...(data.organizationIds !== undefined
              ? {
                  organizationIds: {
                    organizationIds: data.organizationIds
                  }
                }
              : {}),
            ...(data.disabled !== undefined ? { disabled: data.disabled } : {}),
            ...(data.markedForDeletion !== undefined
              ? { markedForDeletion: data.markedForDeletion }
              : {})
          },
          mapUserResponse
        )
    }
  },
  get admin() {
    return this.adminV2;
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
