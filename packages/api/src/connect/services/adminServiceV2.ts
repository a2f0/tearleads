import {
  type DescMessage,
  fromJsonString,
  type MessageShape
} from '@bufbuild/protobuf';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  AdminAddGroupMemberRequest,
  AdminCreateGroupRequest,
  AdminCreateOrganizationRequest,
  AdminDeleteGroupRequest,
  AdminDeleteOrganizationRequest,
  AdminDeleteRedisKeyRequest,
  AdminGetColumnsRequest,
  AdminGetContextRequest,
  AdminGetGroupMembersRequest,
  AdminGetGroupRequest,
  AdminGetOrganizationRequest,
  AdminGetOrgGroupsRequest,
  AdminGetOrgUsersRequest,
  AdminGetPostgresInfoRequest,
  AdminGetRedisDbSizeRequest,
  AdminGetRedisKeysRequest,
  AdminGetRedisValueRequest,
  AdminGetRowsRequest,
  AdminGetTablesRequest,
  AdminGetUserRequest,
  AdminListGroupsRequest,
  AdminListOrganizationsRequest,
  AdminListUsersRequest,
  AdminRemoveGroupMemberRequest,
  AdminUpdateGroupRequest,
  AdminUpdateOrganizationRequest,
  AdminUpdateUserRequest
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import {
  AdminAddGroupMemberResponseSchema,
  AdminCreateGroupResponseSchema,
  AdminCreateOrganizationResponseSchema,
  AdminDeleteGroupResponseSchema,
  AdminDeleteOrganizationResponseSchema,
  AdminDeleteRedisKeyResponseSchema,
  AdminGetColumnsResponseSchema,
  AdminGetContextResponseSchema,
  AdminGetGroupMembersResponseSchema,
  AdminGetGroupResponseSchema,
  AdminGetOrganizationResponseSchema,
  AdminGetOrgGroupsResponseSchema,
  AdminGetOrgUsersResponseSchema,
  AdminGetPostgresInfoResponseSchema,
  AdminGetRedisDbSizeResponseSchema,
  AdminGetRedisKeysResponseSchema,
  AdminGetRedisValueResponseSchema,
  AdminGetRowsResponseSchema,
  AdminGetTablesResponseSchema,
  AdminGetUserResponseSchema,
  AdminListGroupsResponseSchema,
  AdminListOrganizationsResponseSchema,
  AdminListUsersResponseSchema,
  AdminRemoveGroupMemberResponseSchema,
  AdminUpdateGroupResponseSchema,
  AdminUpdateOrganizationResponseSchema,
  AdminUpdateUserResponseSchema
} from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { getContextDirect } from './adminDirectContext.js';
import {
  addGroupMemberDirect,
  createGroupDirect,
  deleteGroupDirect,
  removeGroupMemberDirect,
  updateGroupDirect
} from './adminDirectGroupMutations.js';
import {
  getGroupDirect,
  getGroupMembersDirect,
  listGroupsDirect
} from './adminDirectGroups.js';
import {
  createOrganizationDirect,
  deleteOrganizationDirect,
  getOrganizationDirect,
  getOrganizationGroupsDirect,
  getOrganizationUsersDirect,
  listOrganizationsDirect,
  updateOrganizationDirect
} from './adminDirectOrganizations.js';
import {
  getColumnsDirect,
  getPostgresInfoDirect,
  getRowsDirect,
  getTablesDirect
} from './adminDirectPostgres.js';
import {
  deleteRedisKeyDirect,
  getRedisDbSizeDirect,
  getRedisKeysDirect,
  getRedisValueDirect
} from './adminDirectRedis.js';
import {
  getUserDirect,
  listUsersDirect,
  updateUserDirect
} from './adminDirectUsers.js';

type ConnectContext = { requestHeader: Headers };

function decodeAdminJson<Desc extends DescMessage>(
  schema: Desc,
  json: string
): MessageShape<Desc> {
  try {
    return fromJsonString(schema, json, {
      ignoreUnknownFields: true
    });
  } catch (error) {
    console.error('Failed to decode admin v2 response JSON', error);
    throw new ConnectError('Failed to decode admin response', Code.Internal);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every((entry) => typeof entry === 'string');
}

function normalizeRedisValueResponseJson(json: string): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch (error) {
    console.error('Failed to parse Redis response JSON', error);
    throw new ConnectError('Failed to decode admin response', Code.Internal);
  }

  if (!isRecord(parsed)) {
    throw new ConnectError('Failed to decode admin response', Code.Internal);
  }

  const normalized: Record<string, unknown> = {};

  const key = parsed['key'];
  if (typeof key === 'string') {
    normalized['key'] = key;
  }

  const type = parsed['type'];
  if (typeof type === 'string') {
    normalized['type'] = type;
  }

  const ttl = parsed['ttl'];
  if (typeof ttl === 'number' && Number.isFinite(ttl)) {
    normalized['ttl'] = ttl;
  }

  const value = parsed['value'];
  if (typeof value === 'string') {
    normalized['value'] = {
      stringValue: value
    };
  } else if (isStringArray(value)) {
    normalized['value'] = {
      listValue: {
        values: value
      }
    };
  } else if (isStringRecord(value)) {
    normalized['value'] = {
      mapValue: {
        entries: value
      }
    };
  }

  return JSON.stringify(normalized);
}

export const adminConnectServiceV2 = {
  async getContext(request: AdminGetContextRequest, context: ConnectContext) {
    const response = await getContextDirect(request, context);
    return decodeAdminJson(AdminGetContextResponseSchema, response.json);
  },
  async listGroups(request: AdminListGroupsRequest, context: ConnectContext) {
    const response = await listGroupsDirect(
      {
        organizationId: request.organizationId ?? ''
      },
      context
    );
    return decodeAdminJson(AdminListGroupsResponseSchema, response.json);
  },
  async getGroup(request: AdminGetGroupRequest, context: ConnectContext) {
    const response = await getGroupDirect(request, context);
    return decodeAdminJson(AdminGetGroupResponseSchema, response.json);
  },
  async createGroup(request: AdminCreateGroupRequest, context: ConnectContext) {
    const response = await createGroupDirect(
      {
        organizationId: request.organizationId,
        name: request.name,
        ...(request.description !== undefined
          ? { description: request.description }
          : {})
      },
      context
    );
    return decodeAdminJson(AdminCreateGroupResponseSchema, response.json);
  },
  async updateGroup(request: AdminUpdateGroupRequest, context: ConnectContext) {
    const response = await updateGroupDirect(
      {
        id: request.id,
        ...(request.organizationId !== undefined
          ? { organizationId: request.organizationId }
          : {}),
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.description !== undefined
          ? { description: request.description }
          : {})
      },
      context
    );
    return decodeAdminJson(AdminUpdateGroupResponseSchema, response.json);
  },
  async deleteGroup(request: AdminDeleteGroupRequest, context: ConnectContext) {
    const response = await deleteGroupDirect(request, context);
    return decodeAdminJson(AdminDeleteGroupResponseSchema, response.json);
  },
  async getGroupMembers(
    request: AdminGetGroupMembersRequest,
    context: ConnectContext
  ) {
    const response = await getGroupMembersDirect(request, context);
    return decodeAdminJson(AdminGetGroupMembersResponseSchema, response.json);
  },
  async addGroupMember(
    request: AdminAddGroupMemberRequest,
    context: ConnectContext
  ) {
    const response = await addGroupMemberDirect(
      {
        id: request.id,
        userId: request.userId
      },
      context
    );
    return decodeAdminJson(AdminAddGroupMemberResponseSchema, response.json);
  },
  async removeGroupMember(
    request: AdminRemoveGroupMemberRequest,
    context: ConnectContext
  ) {
    const response = await removeGroupMemberDirect(request, context);
    return decodeAdminJson(AdminRemoveGroupMemberResponseSchema, response.json);
  },
  async listOrganizations(
    request: AdminListOrganizationsRequest,
    context: ConnectContext
  ) {
    const response = await listOrganizationsDirect(
      {
        organizationId: request.organizationId ?? ''
      },
      context
    );
    return decodeAdminJson(AdminListOrganizationsResponseSchema, response.json);
  },
  async getOrganization(
    request: AdminGetOrganizationRequest,
    context: ConnectContext
  ) {
    const response = await getOrganizationDirect(request, context);
    return decodeAdminJson(AdminGetOrganizationResponseSchema, response.json);
  },
  async getOrgUsers(request: AdminGetOrgUsersRequest, context: ConnectContext) {
    const response = await getOrganizationUsersDirect(
      {
        id: request.id
      },
      context
    );
    return decodeAdminJson(AdminGetOrgUsersResponseSchema, response.json);
  },
  async getOrgGroups(
    request: AdminGetOrgGroupsRequest,
    context: ConnectContext
  ) {
    const response = await getOrganizationGroupsDirect(
      {
        id: request.id
      },
      context
    );
    return decodeAdminJson(AdminGetOrgGroupsResponseSchema, response.json);
  },
  async createOrganization(
    request: AdminCreateOrganizationRequest,
    context: ConnectContext
  ) {
    const response = await createOrganizationDirect(
      {
        json: JSON.stringify({
          name: request.name,
          ...(request.description !== undefined
            ? { description: request.description }
            : {})
        })
      },
      context
    );
    return decodeAdminJson(
      AdminCreateOrganizationResponseSchema,
      response.json
    );
  },
  async updateOrganization(
    request: AdminUpdateOrganizationRequest,
    context: ConnectContext
  ) {
    const response = await updateOrganizationDirect(
      {
        id: request.id,
        json: JSON.stringify({
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(request.description !== undefined
            ? { description: request.description }
            : {})
        })
      },
      context
    );
    return decodeAdminJson(
      AdminUpdateOrganizationResponseSchema,
      response.json
    );
  },
  async deleteOrganization(
    request: AdminDeleteOrganizationRequest,
    context: ConnectContext
  ) {
    const response = await deleteOrganizationDirect(request, context);
    return decodeAdminJson(
      AdminDeleteOrganizationResponseSchema,
      response.json
    );
  },
  async listUsers(request: AdminListUsersRequest, context: ConnectContext) {
    const response = await listUsersDirect(
      {
        organizationId: request.organizationId ?? ''
      },
      context
    );
    return decodeAdminJson(AdminListUsersResponseSchema, response.json);
  },
  async getUser(request: AdminGetUserRequest, context: ConnectContext) {
    const response = await getUserDirect(request, context);
    return decodeAdminJson(AdminGetUserResponseSchema, response.json);
  },
  async updateUser(request: AdminUpdateUserRequest, context: ConnectContext) {
    const response = await updateUserDirect(
      {
        id: request.id,
        json: JSON.stringify({
          ...(request.email !== undefined ? { email: request.email } : {}),
          ...(request.emailConfirmed !== undefined
            ? { emailConfirmed: request.emailConfirmed }
            : {}),
          ...(request.admin !== undefined ? { admin: request.admin } : {}),
          ...(request.organizationIds !== undefined
            ? { organizationIds: request.organizationIds.organizationIds }
            : {}),
          ...(request.disabled !== undefined
            ? { disabled: request.disabled }
            : {}),
          ...(request.markedForDeletion !== undefined
            ? { markedForDeletion: request.markedForDeletion }
            : {})
        })
      },
      context
    );
    return decodeAdminJson(AdminUpdateUserResponseSchema, response.json);
  },
  async getPostgresInfo(
    request: AdminGetPostgresInfoRequest,
    context: ConnectContext
  ) {
    const response = await getPostgresInfoDirect(request, context);
    return decodeAdminJson(AdminGetPostgresInfoResponseSchema, response.json);
  },
  async getTables(request: AdminGetTablesRequest, context: ConnectContext) {
    const response = await getTablesDirect(request, context);
    return decodeAdminJson(AdminGetTablesResponseSchema, response.json);
  },
  async getColumns(request: AdminGetColumnsRequest, context: ConnectContext) {
    const response = await getColumnsDirect(request, context);
    return decodeAdminJson(AdminGetColumnsResponseSchema, response.json);
  },
  async getRows(request: AdminGetRowsRequest, context: ConnectContext) {
    const response = await getRowsDirect(
      {
        schema: request.schema,
        table: request.table,
        limit: request.limit,
        offset: request.offset,
        sortColumn: request.sortColumn ?? '',
        sortDirection: request.sortDirection ?? ''
      },
      context
    );
    return decodeAdminJson(AdminGetRowsResponseSchema, response.json);
  },
  async getRedisKeys(
    request: AdminGetRedisKeysRequest,
    context: ConnectContext
  ) {
    const response = await getRedisKeysDirect(request, context);
    return decodeAdminJson(AdminGetRedisKeysResponseSchema, response.json);
  },
  async getRedisValue(
    request: AdminGetRedisValueRequest,
    context: ConnectContext
  ) {
    const response = await getRedisValueDirect(request, context);
    return decodeAdminJson(
      AdminGetRedisValueResponseSchema,
      normalizeRedisValueResponseJson(response.json)
    );
  },
  async deleteRedisKey(
    request: AdminDeleteRedisKeyRequest,
    context: ConnectContext
  ) {
    const response = await deleteRedisKeyDirect(request, context);
    return decodeAdminJson(AdminDeleteRedisKeyResponseSchema, response.json);
  },
  async getRedisDbSize(
    request: AdminGetRedisDbSizeRequest,
    context: ConnectContext
  ) {
    const response = await getRedisDbSizeDirect(request, context);
    return decodeAdminJson(AdminGetRedisDbSizeResponseSchema, response.json);
  }
};
