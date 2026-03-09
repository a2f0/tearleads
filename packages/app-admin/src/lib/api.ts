import {
  type DescMessage,
  fromJson,
  type JsonValue,
  type MessageShape
} from '@bufbuild/protobuf';
import type {
  AdminUserUpdatePayload,
  AiUsageListResponse,
  CreateGroupRequest,
  CreateOrganizationRequest,
  UpdateGroupRequest,
  UpdateOrganizationRequest
} from '@tearleads/shared';
import { createConnectJsonPostInit } from '@tearleads/shared';
import {
  type AdminAddGroupMemberResponse,
  AdminAddGroupMemberResponseSchema,
  type AdminCreateGroupResponse,
  AdminCreateGroupResponseSchema,
  type AdminCreateOrganizationResponse,
  AdminCreateOrganizationResponseSchema,
  type AdminDeleteGroupResponse,
  AdminDeleteGroupResponseSchema,
  type AdminDeleteOrganizationResponse,
  AdminDeleteOrganizationResponseSchema,
  AdminDeleteRedisKeyResponseSchema,
  AdminGetColumnsResponseSchema,
  AdminGetContextResponseSchema,
  type AdminGetGroupMembersResponse,
  AdminGetGroupMembersResponseSchema,
  type AdminGetGroupResponse,
  AdminGetGroupResponseSchema,
  type AdminGetOrganizationResponse,
  AdminGetOrganizationResponseSchema,
  type AdminGetOrgGroupsResponse,
  AdminGetOrgGroupsResponseSchema,
  type AdminGetOrgUsersResponse,
  AdminGetOrgUsersResponseSchema,
  AdminGetPostgresInfoResponseSchema,
  AdminGetRedisDbSizeResponseSchema,
  AdminGetRedisKeysResponseSchema,
  AdminGetRedisValueResponseSchema,
  AdminGetRowsResponseSchema,
  AdminGetTablesResponseSchema,
  type AdminGetUserResponse,
  AdminGetUserResponseSchema,
  type AdminListGroupsResponse,
  AdminListGroupsResponseSchema,
  type AdminListOrganizationsResponse,
  AdminListOrganizationsResponseSchema,
  type AdminListUsersResponse,
  AdminListUsersResponseSchema,
  type AdminRemoveGroupMemberResponse,
  AdminRemoveGroupMemberResponseSchema,
  type AdminUpdateGroupResponse,
  AdminUpdateGroupResponseSchema,
  type AdminUpdateOrganizationResponse,
  AdminUpdateOrganizationResponseSchema,
  type AdminUpdateUserResponse,
  AdminUpdateUserResponseSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';

const API_BASE_URL: string | undefined = import.meta.env.VITE_API_URL;

const ADMIN_V2_CONNECT_BASE_PATH = '/connect/tearleads.v2.AdminService';
const AI_CONNECT_BASE_PATH = '/connect/tearleads.v1.AiService';

interface RequestParams {
  fetchOptions?: RequestInit;
}

interface AdminUsersApi {
  list(options?: { organizationId?: string }): Promise<AdminListUsersResponse>;
  get(id: string): Promise<AdminGetUserResponse>;
  update(
    id: string,
    data: AdminUserUpdatePayload
  ): Promise<AdminUpdateUserResponse>;
}

interface AdminGroupsApi {
  list(options?: { organizationId?: string }): Promise<AdminListGroupsResponse>;
  get(id: string): Promise<AdminGetGroupResponse>;
  create(data: CreateGroupRequest): Promise<AdminCreateGroupResponse>;
  update(
    id: string,
    data: UpdateGroupRequest
  ): Promise<AdminUpdateGroupResponse>;
  delete(id: string): Promise<AdminDeleteGroupResponse>;
  getMembers(id: string): Promise<AdminGetGroupMembersResponse>;
  addMember(
    groupId: string,
    userId: string
  ): Promise<AdminAddGroupMemberResponse>;
  removeMember(
    groupId: string,
    userId: string
  ): Promise<AdminRemoveGroupMemberResponse>;
}

interface AdminOrganizationsApi {
  list(options?: {
    organizationId?: string;
  }): Promise<AdminListOrganizationsResponse>;
  get(id: string): Promise<AdminGetOrganizationResponse>;
  getUsers(id: string): Promise<AdminGetOrgUsersResponse>;
  getGroups(id: string): Promise<AdminGetOrgGroupsResponse>;
  create(
    data: CreateOrganizationRequest
  ): Promise<AdminCreateOrganizationResponse>;
  update(
    id: string,
    data: UpdateOrganizationRequest
  ): Promise<AdminUpdateOrganizationResponse>;
  delete(id: string): Promise<AdminDeleteOrganizationResponse>;
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

function requestAdminV2Proto<Desc extends DescMessage>(
  methodName: string,
  requestBody: Record<string, unknown>,
  schema: Desc
): Promise<MessageShape<Desc>> {
  return request<JsonValue>(`${ADMIN_V2_CONNECT_BASE_PATH}/${methodName}`, {
    fetchOptions: createConnectJsonPostInit(requestBody)
  }).then((responseBody) => {
    try {
      return fromJson(schema, responseBody ?? {}, {
        ignoreUnknownFields: true
      });
    } catch (error) {
      console.error('Failed to decode admin v2 response', error);
      throw new Error('Invalid admin response');
    }
  });
}

function requestAi<T>(
  methodName: string,
  requestBody: Record<string, unknown>
): Promise<T> {
  return request<T>(`${AI_CONNECT_BASE_PATH}/${methodName}`, {
    fetchOptions: createConnectJsonPostInit(requestBody)
  });
}

const adminV2UsersApi: AdminUsersApi = {
  list: (options?: {
    organizationId?: string;
  }): Promise<AdminListUsersResponse> => {
    const requestBody: Record<string, unknown> = {};
    if (options?.organizationId) {
      requestBody['organizationId'] = options.organizationId;
    }
    return requestAdminV2Proto(
      'ListUsers',
      requestBody,
      AdminListUsersResponseSchema
    );
  },
  get: (id: string): Promise<AdminGetUserResponse> =>
    requestAdminV2Proto('GetUser', { id }, AdminGetUserResponseSchema),
  update: (
    id: string,
    data: AdminUserUpdatePayload
  ): Promise<AdminUpdateUserResponse> =>
    requestAdminV2Proto(
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
      AdminUpdateUserResponseSchema
    )
};

const adminV2GroupsApi: AdminGroupsApi = {
  list: (options?: { organizationId?: string }) => {
    const requestBody: Record<string, unknown> = {};
    if (options?.organizationId) {
      requestBody['organizationId'] = options.organizationId;
    }
    return requestAdminV2Proto(
      'ListGroups',
      requestBody,
      AdminListGroupsResponseSchema
    );
  },
  get: (id: string) =>
    requestAdminV2Proto('GetGroup', { id }, AdminGetGroupResponseSchema),
  create: (data: CreateGroupRequest) =>
    requestAdminV2Proto(
      'CreateGroup',
      {
        organizationId: data.organizationId,
        name: data.name,
        ...(data.description !== undefined
          ? { description: data.description }
          : {})
      },
      AdminCreateGroupResponseSchema
    ),
  update: (id: string, data: UpdateGroupRequest) =>
    requestAdminV2Proto(
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
      AdminUpdateGroupResponseSchema
    ),
  delete: (id: string) =>
    requestAdminV2Proto('DeleteGroup', { id }, AdminDeleteGroupResponseSchema),
  getMembers: (id: string) =>
    requestAdminV2Proto(
      'GetGroupMembers',
      { id },
      AdminGetGroupMembersResponseSchema
    ),
  addMember: (groupId: string, userId: string) =>
    requestAdminV2Proto(
      'AddGroupMember',
      {
        id: groupId,
        userId
      },
      AdminAddGroupMemberResponseSchema
    ),
  removeMember: (groupId: string, userId: string) =>
    requestAdminV2Proto(
      'RemoveGroupMember',
      {
        groupId,
        userId
      },
      AdminRemoveGroupMemberResponseSchema
    )
};

const adminV2OrganizationsApi: AdminOrganizationsApi = {
  list: (options?: { organizationId?: string }) => {
    const requestBody: Record<string, unknown> = {};
    if (options?.organizationId) {
      requestBody['organizationId'] = options.organizationId;
    }
    return requestAdminV2Proto(
      'ListOrganizations',
      requestBody,
      AdminListOrganizationsResponseSchema
    );
  },
  get: (id: string) =>
    requestAdminV2Proto(
      'GetOrganization',
      { id },
      AdminGetOrganizationResponseSchema
    ),
  getUsers: (id: string) =>
    requestAdminV2Proto('GetOrgUsers', { id }, AdminGetOrgUsersResponseSchema),
  getGroups: (id: string) =>
    requestAdminV2Proto(
      'GetOrgGroups',
      { id },
      AdminGetOrgGroupsResponseSchema
    ),
  create: (data: CreateOrganizationRequest) =>
    requestAdminV2Proto(
      'CreateOrganization',
      {
        name: data.name,
        ...(data.description !== undefined
          ? { description: data.description }
          : {})
      },
      AdminCreateOrganizationResponseSchema
    ),
  update: (id: string, data: UpdateOrganizationRequest) =>
    requestAdminV2Proto(
      'UpdateOrganization',
      {
        id,
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {})
      },
      AdminUpdateOrganizationResponseSchema
    ),
  delete: (id: string) =>
    requestAdminV2Proto(
      'DeleteOrganization',
      { id },
      AdminDeleteOrganizationResponseSchema
    )
};

export const api = {
  adminV2: {
    getContext: () =>
      requestAdminV2Proto('GetContext', {}, AdminGetContextResponseSchema),
    postgres: {
      getInfo: () =>
        requestAdminV2Proto(
          'GetPostgresInfo',
          {},
          AdminGetPostgresInfoResponseSchema
        ),
      getTables: () =>
        requestAdminV2Proto('GetTables', {}, AdminGetTablesResponseSchema),
      getColumns: (schema: string, table: string) =>
        requestAdminV2Proto(
          'GetColumns',
          {
            schema,
            table
          },
          AdminGetColumnsResponseSchema
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
        return requestAdminV2Proto(
          'GetRows',
          requestBody,
          AdminGetRowsResponseSchema
        );
      }
    },
    redis: {
      getKeys: (cursor?: string, limit?: number) => {
        const requestBody: Record<string, unknown> = {};
        if (cursor) requestBody['cursor'] = cursor;
        if (limit) requestBody['limit'] = limit;
        return requestAdminV2Proto(
          'GetRedisKeys',
          requestBody,
          AdminGetRedisKeysResponseSchema
        );
      },
      getValue: (key: string) =>
        requestAdminV2Proto(
          'GetRedisValue',
          { key },
          AdminGetRedisValueResponseSchema
        ),
      deleteKey: (key: string) =>
        requestAdminV2Proto(
          'DeleteRedisKey',
          { key },
          AdminDeleteRedisKeyResponseSchema
        ),
      getDbSize: () =>
        requestAdminV2Proto(
          'GetRedisDbSize',
          {},
          AdminGetRedisDbSizeResponseSchema
        )
    },
    groups: adminV2GroupsApi,
    organizations: adminV2OrganizationsApi,
    users: adminV2UsersApi
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
