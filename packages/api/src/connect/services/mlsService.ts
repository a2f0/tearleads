import {
  addGroupMemberDirect,
  getGroupMembersDirect,
  removeGroupMemberDirect
} from './mlsDirectGroupMembers.js';
import {
  createGroupDirect,
  deleteGroupDirect,
  getGroupDirect,
  listGroupsDirect,
  updateGroupDirect
} from './mlsDirectGroups.js';
import {
  deleteKeyPackageDirect,
  getMyKeyPackagesDirect,
  getUserKeyPackagesDirect,
  uploadKeyPackagesDirect
} from './mlsDirectKeyPackages.js';
import {
  getGroupMessagesDirect,
  sendGroupMessageDirect
} from './mlsDirectMessages.js';
import {
  getGroupStateDirect,
  uploadGroupStateDirect
} from './mlsDirectState.js';
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
  ) => createGroupDirect(request, context),
  listGroups: async (_request: object, context: { requestHeader: Headers }) =>
    listGroupsDirect({}, context),
  getGroup: async (
    request: GroupIdRequest,
    context: { requestHeader: Headers }
  ) => getGroupDirect(request, context),
  updateGroup: async (
    request: GroupIdJsonRequest,
    context: { requestHeader: Headers }
  ) => updateGroupDirect(request, context),
  deleteGroup: async (
    request: GroupIdRequest,
    context: { requestHeader: Headers }
  ) => deleteGroupDirect(request, context),
  addGroupMember: async (
    request: GroupIdJsonRequest,
    context: { requestHeader: Headers }
  ) => addGroupMemberDirect(request, context),
  getGroupMembers: async (
    request: GroupIdRequest,
    context: { requestHeader: Headers }
  ) => getGroupMembersDirect(request, context),
  removeGroupMember: async (
    request: MlsRemoveGroupMemberRequest,
    context: { requestHeader: Headers }
  ) => removeGroupMemberDirect(request, context),
  sendGroupMessage: async (
    request: GroupIdJsonRequest,
    context: { requestHeader: Headers }
  ) => sendGroupMessageDirect(request, context),
  getGroupMessages: async (
    request: GetGroupMessagesRequest,
    context: { requestHeader: Headers }
  ) => getGroupMessagesDirect(request, context),
  getGroupState: async (
    request: GroupIdRequest,
    context: { requestHeader: Headers }
  ) => getGroupStateDirect(request, context),
  uploadGroupState: async (
    request: GroupIdJsonRequest,
    context: { requestHeader: Headers }
  ) => uploadGroupStateDirect(request, context),
  getWelcomeMessages: async (
    _request: object,
    context: { requestHeader: Headers }
  ) => getWelcomeMessagesDirect({}, context),
  acknowledgeWelcome: async (
    request: AcknowledgeWelcomeRequest,
    context: { requestHeader: Headers }
  ) => acknowledgeWelcomeDirect(request, context)
};
