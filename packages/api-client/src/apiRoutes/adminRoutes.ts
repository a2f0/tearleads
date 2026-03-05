import type {
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
  UpdateGroupRequest,
  UpdateOrganizationRequest
} from '@tearleads/shared';
import {
  createConnectJsonPostInit,
  parseConnectJsonString
} from '@tearleads/shared';
import { request } from '../apiCore';
import { adminV2Routes } from './adminV2Routes';

const ADMIN_CONNECT_BASE_PATH = '/connect/tearleads.v1.AdminService';

interface ConnectJsonEnvelopeResponse {
  json: string;
}

type RequestEventName = Parameters<typeof request>[1]['eventName'];

function requestAdminJson<TResponse>(
  methodName: string,
  requestBody: Record<string, unknown>,
  eventName: RequestEventName
): Promise<TResponse> {
  return request<ConnectJsonEnvelopeResponse>(
    `${ADMIN_CONNECT_BASE_PATH}/${methodName}`,
    {
      fetchOptions: createConnectJsonPostInit(requestBody),
      eventName
    }
  ).then((response) => parseConnectJsonString<TResponse>(response?.json));
}

export const adminRoutes = {
  getContext: () => adminV2Routes.getContext(),
  postgres: {
    getInfo: () => adminV2Routes.postgres.getInfo(),
    getTables: () => adminV2Routes.postgres.getTables(),
    getColumns: (schema: string, table: string) =>
      adminV2Routes.postgres.getColumns(schema, table),
    getRows: (
      schema: string,
      table: string,
      options?: {
        limit?: number;
        offset?: number;
        sortColumn?: string;
        sortDirection?: 'asc' | 'desc';
      }
    ) => adminV2Routes.postgres.getRows(schema, table, options)
  },
  redis: {
    getKeys: (cursor?: string, limit?: number) =>
      adminV2Routes.redis.getKeys(cursor, limit),
    getValue: (key: string) => adminV2Routes.redis.getValue(key),
    deleteKey: (key: string) => adminV2Routes.redis.deleteKey(key),
    getDbSize: () => adminV2Routes.redis.getDbSize()
  },
  groups: {
    list: (options?: { organizationId?: string }) => {
      const requestBody: Record<string, unknown> = {};
      if (options?.organizationId) {
        requestBody['organizationId'] = options.organizationId;
      }
      return requestAdminJson<GroupsListResponse>(
        'ListGroups',
        requestBody,
        'api_get_admin_groups'
      );
    },
    get: (id: string) =>
      requestAdminJson<GroupDetailResponse>(
        'GetGroup',
        { id },
        'api_get_admin_group'
      ),
    create: (data: CreateGroupRequest) =>
      requestAdminJson<{ group: Group }>(
        'CreateGroup',
        { json: JSON.stringify(data) },
        'api_post_admin_group'
      ),
    update: (id: string, data: UpdateGroupRequest) =>
      requestAdminJson<{ group: Group }>(
        'UpdateGroup',
        { id, json: JSON.stringify(data) },
        'api_put_admin_group'
      ),
    delete: (id: string) =>
      requestAdminJson<{ deleted: boolean }>(
        'DeleteGroup',
        { id },
        'api_delete_admin_group'
      ),
    getMembers: (id: string) =>
      requestAdminJson<GroupMembersResponse>(
        'GetGroupMembers',
        { id },
        'api_get_admin_group_members'
      ),
    addMember: (groupId: string, userId: string) =>
      requestAdminJson<{ added: boolean }>(
        'AddGroupMember',
        { id: groupId, json: JSON.stringify({ userId }) },
        'api_post_admin_group_member'
      ),
    removeMember: (groupId: string, userId: string) =>
      requestAdminJson<{ removed: boolean }>(
        'RemoveGroupMember',
        { groupId, userId },
        'api_delete_admin_group_member'
      )
  },
  organizations: {
    list: (options?: { organizationId?: string }) => {
      const requestBody: Record<string, unknown> = {};
      if (options?.organizationId) {
        requestBody['organizationId'] = options.organizationId;
      }
      return requestAdminJson<OrganizationsListResponse>(
        'ListOrganizations',
        requestBody,
        'api_get_admin_organizations'
      );
    },
    get: (id: string) =>
      requestAdminJson<OrganizationResponse>(
        'GetOrganization',
        { id },
        'api_get_admin_organization'
      ),
    getUsers: (id: string) =>
      requestAdminJson<OrganizationUsersResponse>(
        'GetOrgUsers',
        { id },
        'api_get_admin_organization_users'
      ),
    getGroups: (id: string) =>
      requestAdminJson<OrganizationGroupsResponse>(
        'GetOrgGroups',
        { id },
        'api_get_admin_organization_groups'
      ),
    create: (data: CreateOrganizationRequest) =>
      requestAdminJson<{ organization: Organization }>(
        'CreateOrganization',
        { json: JSON.stringify(data) },
        'api_post_admin_organization'
      ),
    update: (id: string, data: UpdateOrganizationRequest) =>
      requestAdminJson<{ organization: Organization }>(
        'UpdateOrganization',
        { id, json: JSON.stringify(data) },
        'api_put_admin_organization'
      ),
    delete: (id: string) =>
      requestAdminJson<{ deleted: boolean }>(
        'DeleteOrganization',
        { id },
        'api_delete_admin_organization'
      )
  },
  users: {
    list: (options?: { organizationId?: string }) => {
      const requestBody: Record<string, unknown> = {};
      if (options?.organizationId) {
        requestBody['organizationId'] = options.organizationId;
      }
      return requestAdminJson<AdminUsersResponse>(
        'ListUsers',
        requestBody,
        'api_get_admin_users'
      );
    },
    get: (id: string) =>
      requestAdminJson<AdminUserResponse>(
        'GetUser',
        { id },
        'api_get_admin_user'
      ),
    update: (id: string, data: AdminUserUpdatePayload) =>
      requestAdminJson<AdminUserUpdateResponse>(
        'UpdateUser',
        { id, json: JSON.stringify(data) },
        'api_patch_admin_user'
      )
  }
};
