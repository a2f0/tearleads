import type {
  AdminUserUpdatePayload,
  AdminUserUpdateResponse,
  CreateGroupRequest,
  CreateOrganizationRequest,
  Organization,
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
    list: (options?: { organizationId?: string }) =>
      adminV2Routes.groups.list(options),
    get: (id: string) => adminV2Routes.groups.get(id),
    create: (data: CreateGroupRequest) => adminV2Routes.groups.create(data),
    update: (id: string, data: UpdateGroupRequest) =>
      adminV2Routes.groups.update(id, data),
    delete: (id: string) => adminV2Routes.groups.delete(id),
    getMembers: (id: string) => adminV2Routes.groups.getMembers(id),
    addMember: (groupId: string, userId: string) =>
      adminV2Routes.groups.addMember(groupId, userId),
    removeMember: (groupId: string, userId: string) =>
      adminV2Routes.groups.removeMember(groupId, userId)
  },
  organizations: {
    list: (options?: { organizationId?: string }) => {
      return adminV2Routes.organizations.list(options);
    },
    get: (id: string) => adminV2Routes.organizations.get(id),
    getUsers: (id: string) => adminV2Routes.organizations.getUsers(id),
    getGroups: (id: string) => adminV2Routes.organizations.getGroups(id),
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
      return adminV2Routes.users.list(options);
    },
    get: (id: string) => adminV2Routes.users.get(id),
    update: (id: string, data: AdminUserUpdatePayload) =>
      requestAdminJson<AdminUserUpdateResponse>(
        'UpdateUser',
        { id, json: JSON.stringify(data) },
        'api_patch_admin_user'
      )
  }
};
