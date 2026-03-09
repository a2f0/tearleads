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
  AdminGetOrganizationResponseSchema,
  AdminGetOrgGroupsResponseSchema,
  AdminGetOrgUsersResponseSchema,
  AdminGetUserResponseSchema,
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

export const adminConnectServiceV2 = {
  async getContext(request: AdminGetContextRequest, context: ConnectContext) {
    return getContextDirect(request, context);
  },
  async listGroups(request: AdminListGroupsRequest, context: ConnectContext) {
    return listGroupsDirect(
      {
        organizationId: request.organizationId ?? ''
      },
      context
    );
  },
  async getGroup(request: AdminGetGroupRequest, context: ConnectContext) {
    return getGroupDirect(request, context);
  },
  async createGroup(request: AdminCreateGroupRequest, context: ConnectContext) {
    const response = await createGroupDirect(
      {
        organizationId: request.organizationId,
        name: request.name,
        description: request.description
      },
      context
    );
    return decodeAdminJson(AdminCreateGroupResponseSchema, response.json);
  },
  async updateGroup(request: AdminUpdateGroupRequest, context: ConnectContext) {
    const response = await updateGroupDirect(
      {
        id: request.id,
        organizationId: request.organizationId,
        name: request.name,
        description: request.description
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
    return getGroupMembersDirect(request, context);
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
        name: request.name,
        description: request.description
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
        name: request.name,
        description: request.description
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
      },
      context
    );
    return decodeAdminJson(AdminUpdateUserResponseSchema, response.json);
  },
  async getPostgresInfo(
    request: AdminGetPostgresInfoRequest,
    context: ConnectContext
  ) {
    return getPostgresInfoDirect(request, context);
  },
  async getTables(request: AdminGetTablesRequest, context: ConnectContext) {
    return getTablesDirect(request, context);
  },
  async getColumns(request: AdminGetColumnsRequest, context: ConnectContext) {
    return getColumnsDirect(request, context);
  },
  async getRows(request: AdminGetRowsRequest, context: ConnectContext) {
    return getRowsDirect(
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
  },
  async getRedisKeys(
    request: AdminGetRedisKeysRequest,
    context: ConnectContext
  ) {
    return getRedisKeysDirect(request, context);
  },
  async getRedisValue(
    request: AdminGetRedisValueRequest,
    context: ConnectContext
  ) {
    return getRedisValueDirect(request, context);
  },
  async deleteRedisKey(
    request: AdminDeleteRedisKeyRequest,
    context: ConnectContext
  ) {
    return deleteRedisKeyDirect(request, context);
  },
  async getRedisDbSize(
    request: AdminGetRedisDbSizeRequest,
    context: ConnectContext
  ) {
    return getRedisDbSizeDirect(request, context);
  }
};
