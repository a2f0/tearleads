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

type GetColumnsRequest = { schema: string; table: string };
type GetRowsRequest = {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  sortColumn: string;
  sortDirection: string;
};
type GetRedisKeysRequest = { cursor: string; limit: number };
type KeyRequest = { key: string };
type IdRequest = { id: string };
type IdJsonRequest = { id: string; json: string };
type OrganizationListRequest = { organizationId: string };
type UserListRequest = { organizationId: string };

export const adminConnectService = {
  getContext: (request: object, context: { requestHeader: Headers }) =>
    getContextDirect(request, context),
  getPostgresInfo: (request: object, context: { requestHeader: Headers }) =>
    getPostgresInfoDirect(request, context),
  getTables: (request: object, context: { requestHeader: Headers }) =>
    getTablesDirect(request, context),
  getColumns: (
    request: GetColumnsRequest,
    context: { requestHeader: Headers }
  ) => getColumnsDirect(request, context),
  getRows: (request: GetRowsRequest, context: { requestHeader: Headers }) =>
    getRowsDirect(request, context),
  getRedisKeys: (
    request: GetRedisKeysRequest,
    context: { requestHeader: Headers }
  ) => getRedisKeysDirect(request, context),
  getRedisValue: (request: KeyRequest, context: { requestHeader: Headers }) =>
    getRedisValueDirect(request, context),
  deleteRedisKey: (request: KeyRequest, context: { requestHeader: Headers }) =>
    deleteRedisKeyDirect(request, context),
  getRedisDbSize: (request: object, context: { requestHeader: Headers }) =>
    getRedisDbSizeDirect(request, context),
  listGroups: listGroupsDirect,
  getGroup: getGroupDirect,
  createGroup: createGroupDirect,
  updateGroup: updateGroupDirect,
  deleteGroup: deleteGroupDirect,
  getGroupMembers: getGroupMembersDirect,
  addGroupMember: addGroupMemberDirect,
  removeGroupMember: removeGroupMemberDirect,
  listOrganizations: (
    request: OrganizationListRequest,
    context: { requestHeader: Headers }
  ) => listOrganizationsDirect(request, context),
  getOrganization: (request: IdRequest, context: { requestHeader: Headers }) =>
    getOrganizationDirect(request, context),
  createOrganization: (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => createOrganizationDirect(request, context),
  updateOrganization: (
    request: IdJsonRequest,
    context: { requestHeader: Headers }
  ) => updateOrganizationDirect(request, context),
  deleteOrganization: (
    request: IdRequest,
    context: { requestHeader: Headers }
  ) => deleteOrganizationDirect(request, context),
  getOrgUsers: (request: IdRequest, context: { requestHeader: Headers }) =>
    getOrganizationUsersDirect(request, context),
  getOrgGroups: (request: IdRequest, context: { requestHeader: Headers }) =>
    getOrganizationGroupsDirect(request, context),
  listUsers: (request: UserListRequest, context: { requestHeader: Headers }) =>
    listUsersDirect(request, context),
  getUser: (request: IdRequest, context: { requestHeader: Headers }) =>
    getUserDirect(request, context),
  updateUser: (request: IdJsonRequest, context: { requestHeader: Headers }) =>
    updateUserDirect(request, context)
};
