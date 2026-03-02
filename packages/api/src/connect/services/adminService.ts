import { getContextDirect } from './adminDirectContext.js';
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
  callRouteJsonHandler,
  encoded,
  setOptionalStringQueryParam,
  toJsonBody
} from './legacyRouteProxy.js';

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
type RemoveGroupMemberRequest = { groupId: string; userId: string };
type ListGroupsRequest = { organizationId: string };
type ListOrganizationsRequest = { organizationId: string };
type ListUsersRequest = { organizationId: string };

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
  listGroups: async (
    request: ListGroupsRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(
      query,
      'organizationId',
      request.organizationId
    );
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: '/admin/groups',
      query
    });
    return { json };
  },
  getGroup: async (request: IdRequest, context: { requestHeader: Headers }) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: `/admin/groups/${encoded(request.id)}`
    });
    return { json };
  },
  createGroup: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: '/admin/groups',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  updateGroup: async (
    request: IdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'PUT',
      path: `/admin/groups/${encoded(request.id)}`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  deleteGroup: async (
    request: IdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'DELETE',
      path: `/admin/groups/${encoded(request.id)}`
    });
    return { json };
  },
  getGroupMembers: async (
    request: IdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: `/admin/groups/${encoded(request.id)}/members`
    });
    return { json };
  },
  addGroupMember: async (
    request: IdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: `/admin/groups/${encoded(request.id)}/members`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  removeGroupMember: async (
    request: RemoveGroupMemberRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'DELETE',
      path: `/admin/groups/${encoded(request.groupId)}/members/${encoded(request.userId)}`
    });
    return { json };
  },
  listOrganizations: async (
    request: ListOrganizationsRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(
      query,
      'organizationId',
      request.organizationId
    );
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: '/admin/organizations',
      query
    });
    return { json };
  },
  getOrganization: async (
    request: IdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: `/admin/organizations/${encoded(request.id)}`
    });
    return { json };
  },
  createOrganization: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: '/admin/organizations',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  updateOrganization: async (
    request: IdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'PUT',
      path: `/admin/organizations/${encoded(request.id)}`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  deleteOrganization: async (
    request: IdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'DELETE',
      path: `/admin/organizations/${encoded(request.id)}`
    });
    return { json };
  },
  getOrgUsers: async (
    request: IdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: `/admin/organizations/${encoded(request.id)}/users`
    });
    return { json };
  },
  getOrgGroups: async (
    request: IdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: `/admin/organizations/${encoded(request.id)}/groups`
    });
    return { json };
  },
  listUsers: async (
    request: ListUsersRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(
      query,
      'organizationId',
      request.organizationId
    );
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: '/admin/users',
      query
    });
    return { json };
  },
  getUser: async (request: IdRequest, context: { requestHeader: Headers }) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: `/admin/users/${encoded(request.id)}`
    });
    return { json };
  },
  updateUser: async (
    request: IdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'PATCH',
      path: `/admin/users/${encoded(request.id)}`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  }
};
