import {
  callRouteJsonHandler,
  encoded,
  setOptionalPositiveIntQueryParam,
  setOptionalStringQueryParam,
  toJsonBody
} from './legacyRouteProxy.js';
import {
  deleteKeyPackageDirect,
  getMyKeyPackagesDirect,
  getUserKeyPackagesDirect,
  uploadKeyPackagesDirect
} from './mlsDirectKeyPackages.js';
import {
  acknowledgeWelcomeDirect,
  getWelcomeMessagesDirect
} from './mlsDirectWelcomeMessages.js';

type UserIdRequest = { userId: string };
type MlsIdRequest = { id: string };
type GroupIdRequest = { groupId: string };
type GroupIdJsonRequest = { groupId: string; json: string };
type MlsRemoveGroupMemberRequest = {
  groupId: string;
  userId: string;
  json: string;
};
type GetGroupMessagesRequest = {
  groupId: string;
  cursor: string;
  limit: number;
};
type AcknowledgeWelcomeRequest = { id: string; json: string };

export const mlsConnectService = {
  uploadKeyPackages: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => uploadKeyPackagesDirect(request, context),
  getMyKeyPackages: async (
    _request: object,
    context: { requestHeader: Headers }
  ) => getMyKeyPackagesDirect({}, context),
  getUserKeyPackages: async (
    request: UserIdRequest,
    context: { requestHeader: Headers }
  ) => getUserKeyPackagesDirect(request, context),
  deleteKeyPackage: async (
    request: MlsIdRequest,
    context: { requestHeader: Headers }
  ) => deleteKeyPackageDirect(request, context),
  createGroup: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: '/mls/groups',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  listGroups: async (_request: object, context: { requestHeader: Headers }) => {
    const json = await callRouteJsonHandler({
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
    const json = await callRouteJsonHandler({
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
    const json = await callRouteJsonHandler({
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
    const json = await callRouteJsonHandler({
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
    const json = await callRouteJsonHandler({
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
    const json = await callRouteJsonHandler({
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
    const json = await callRouteJsonHandler({
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
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: `/vfs/mls/groups/${encoded(request.groupId)}/messages`,
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
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: `/vfs/mls/groups/${encoded(request.groupId)}/messages`,
      query
    });
    return { json };
  },
  getGroupState: async (
    request: GroupIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
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
    const json = await callRouteJsonHandler({
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
  ) => getWelcomeMessagesDirect({}, context),
  acknowledgeWelcome: async (
    request: AcknowledgeWelcomeRequest,
    context: { requestHeader: Headers }
  ) => acknowledgeWelcomeDirect(request, context)
};
