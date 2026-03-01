import type {
  AcknowledgeWelcomeRequest,
  GetGroupMessagesRequest,
  GroupIdJsonRequest,
  GroupIdRequest,
  MlsIdRequest,
  MlsRemoveGroupMemberRequest,
  UserIdRequest
} from '@tearleads/shared/gen/tearleads/v1/mls_pb';
import {
  callLegacyJsonRoute,
  setOptionalPositiveIntQueryParam,
  setOptionalStringQueryParam,
  toJsonBody
} from './legacyRouteProxy.js';

function encoded(value: string): string {
  return encodeURIComponent(value);
}

export const mlsConnectService = {
  uploadKeyPackages: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/mls/key-packages',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  getMyKeyPackages: async (
    _request: object,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/mls/key-packages/me'
    });
    return { json };
  },
  getUserKeyPackages: async (
    request: UserIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/mls/key-packages/${encoded(request.userId)}`
    });
    return { json };
  },
  deleteKeyPackage: async (
    request: MlsIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'DELETE',
      path: `/mls/key-packages/${encoded(request.id)}`
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
      path: '/mls/groups',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  listGroups: async (_request: object, context: { requestHeader: Headers }) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/mls/groups'
    });
    return { json };
  },
  getGroup: async (
    request: GroupIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/mls/groups/${encoded(request.groupId)}`
    });
    return { json };
  },
  updateGroup: async (
    request: GroupIdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'PATCH',
      path: `/mls/groups/${encoded(request.groupId)}`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  deleteGroup: async (
    request: GroupIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'DELETE',
      path: `/mls/groups/${encoded(request.groupId)}`
    });
    return { json };
  },
  addGroupMember: async (
    request: GroupIdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: `/mls/groups/${encoded(request.groupId)}/members`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  getGroupMembers: async (
    request: GroupIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/mls/groups/${encoded(request.groupId)}/members`
    });
    return { json };
  },
  removeGroupMember: async (
    request: MlsRemoveGroupMemberRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'DELETE',
      path: `/mls/groups/${encoded(request.groupId)}/members/${encoded(request.userId)}`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  sendGroupMessage: async (
    request: GroupIdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: `/mls/groups/${encoded(request.groupId)}/messages`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  getGroupMessages: async (
    request: GetGroupMessagesRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(query, 'cursor', request.cursor);
    setOptionalPositiveIntQueryParam(query, 'limit', request.limit);
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/mls/groups/${encoded(request.groupId)}/messages`,
      query
    });
    return { json };
  },
  getGroupState: async (
    request: GroupIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/mls/groups/${encoded(request.groupId)}/state`
    });
    return { json };
  },
  uploadGroupState: async (
    request: GroupIdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: `/mls/groups/${encoded(request.groupId)}/state`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  getWelcomeMessages: async (
    _request: object,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/mls/welcome-messages'
    });
    return { json };
  },
  acknowledgeWelcome: async (
    request: AcknowledgeWelcomeRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: `/mls/welcome-messages/${encoded(request.id)}/ack`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  }
};
