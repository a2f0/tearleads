import {
  callLegacyJsonRoute,
  encoded,
  setOptionalPositiveIntQueryParam,
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
  getContext: async (_request: object, context: { requestHeader: Headers }) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/admin/context'
    });
    return { json };
  },
  getPostgresInfo: async (
    _request: object,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/admin/postgres/info'
    });
    return { json };
  },
  getTables: async (_request: object, context: { requestHeader: Headers }) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/admin/postgres/tables'
    });
    return { json };
  },
  getColumns: async (
    request: GetColumnsRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/admin/postgres/tables/${encoded(request.schema)}/${encoded(request.table)}/columns`
    });
    return { json };
  },
  getRows: async (
    request: GetRowsRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalPositiveIntQueryParam(query, 'limit', request.limit);
    if (Number.isFinite(request.offset) && request.offset >= 0) {
      query.set('offset', String(Math.floor(request.offset)));
    }
    setOptionalStringQueryParam(query, 'sortColumn', request.sortColumn);
    setOptionalStringQueryParam(query, 'sortDirection', request.sortDirection);

    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/admin/postgres/tables/${encoded(request.schema)}/${encoded(request.table)}/rows`,
      query
    });
    return { json };
  },
  getRedisKeys: async (
    request: GetRedisKeysRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(query, 'cursor', request.cursor);
    setOptionalPositiveIntQueryParam(query, 'limit', request.limit);
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/admin/redis/keys',
      query
    });
    return { json };
  },
  getRedisValue: async (
    request: KeyRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/admin/redis/keys/${encoded(request.key)}`
    });
    return { json };
  },
  deleteRedisKey: async (
    request: KeyRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'DELETE',
      path: `/admin/redis/keys/${encoded(request.key)}`
    });
    return { json };
  },
  getRedisDbSize: async (
    _request: object,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/admin/redis/dbsize'
    });
    return { json };
  },
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
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/admin/groups',
      query
    });
    return { json };
  },
  getGroup: async (request: IdRequest, context: { requestHeader: Headers }) => {
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/admin/users',
      query
    });
    return { json };
  },
  getUser: async (request: IdRequest, context: { requestHeader: Headers }) => {
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
      context,
      method: 'PATCH',
      path: `/admin/users/${encoded(request.id)}`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  }
};
