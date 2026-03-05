import type {
  MlsGroup,
  MlsGroupMember,
  MlsGroupState,
  MlsGroupStateResponse,
  MlsKeyPackage,
  MlsMessage,
  MlsWelcomeMessage
} from '@tearleads/shared';
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
import {
  fromProtoCipherSuite,
  fromProtoMessageType,
  parseDirectJson,
  toProtoGroup,
  toProtoGroupState,
  toProtoKeyPackage,
  toProtoMember,
  toProtoMessage,
  toProtoWelcome
} from './mlsV2Converters.js';
import type {
  V2AcknowledgeWelcomeRequest,
  V2AddGroupMemberRequest,
  V2CreateGroupRequest,
  V2RemoveGroupMemberRequest,
  V2SendGroupMessageRequest,
  V2UpdateGroupRequest,
  V2UploadGroupStateRequest,
  V2UploadKeyPackagesRequest
} from './mlsV2Converters.js';

// ---------------------------------------------------------------------------
// V1 handler types (unchanged)
// ---------------------------------------------------------------------------

type UserIdRequest = { userId: string };
type MlsIdRequest = { id: string };
type GroupIdRequest = { groupId: string };
type GroupIdJsonRequest = { groupId: string; json: string };
type V1RemoveGroupMemberRequest = {
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
type HeaderContext = { requestHeader: Headers };

// ---------------------------------------------------------------------------
// V1 service (unchanged — talks to Direct handlers with { json: string })
// ---------------------------------------------------------------------------

export const mlsConnectServiceV1 = {
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
    request: V1RemoveGroupMemberRequest,
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

// ---------------------------------------------------------------------------
// V2 service (typed proto fields — bridges to Direct handlers)
// ---------------------------------------------------------------------------

export const mlsConnectServiceV2 = {
  uploadKeyPackages: async (
    request: V2UploadKeyPackagesRequest,
    context: HeaderContext
  ) => {
    const directResult = await uploadKeyPackagesDirect(
      {
        json: JSON.stringify({
          keyPackages: request.keyPackages.map((kp) => ({
            keyPackageData: kp.keyPackageData,
            keyPackageRef: kp.keyPackageRef,
            cipherSuite: fromProtoCipherSuite(kp.cipherSuite)
          }))
        })
      },
      context
    );
    const data = parseDirectJson<{ keyPackages: MlsKeyPackage[] }>(directResult);
    return { keyPackages: data.keyPackages.map(toProtoKeyPackage) };
  },

  getMyKeyPackages: async (_request: object, context: HeaderContext) => {
    const directResult = await getMyKeyPackagesDirect({}, context);
    const data = parseDirectJson<{ keyPackages: MlsKeyPackage[] }>(directResult);
    return { keyPackages: data.keyPackages.map(toProtoKeyPackage) };
  },

  getUserKeyPackages: async (
    request: UserIdRequest,
    context: HeaderContext
  ) => {
    const directResult = await getUserKeyPackagesDirect(request, context);
    const data = parseDirectJson<{ keyPackages: MlsKeyPackage[] }>(directResult);
    return { keyPackages: data.keyPackages.map(toProtoKeyPackage) };
  },

  deleteKeyPackage: async (request: MlsIdRequest, context: HeaderContext) => {
    await deleteKeyPackageDirect(request, context);
    return {};
  },

  createGroup: async (
    request: V2CreateGroupRequest,
    context: HeaderContext
  ) => {
    const directResult = await createGroupDirect(
      {
        json: JSON.stringify({
          name: request.name,
          description: request.description || undefined,
          groupIdMls: request.groupIdMls,
          cipherSuite: fromProtoCipherSuite(request.cipherSuite)
        })
      },
      context
    );
    const data = parseDirectJson<{ group: MlsGroup }>(directResult);
    return { group: toProtoGroup(data.group) };
  },

  listGroups: async (_request: object, context: HeaderContext) => {
    const directResult = await listGroupsDirect({}, context);
    const data = parseDirectJson<{ groups: MlsGroup[] }>(directResult);
    return { groups: data.groups.map(toProtoGroup) };
  },

  getGroup: async (request: GroupIdRequest, context: HeaderContext) => {
    const directResult = await getGroupDirect(request, context);
    const data = parseDirectJson<{
      group: MlsGroup;
      members: MlsGroupMember[];
    }>(directResult);
    return {
      group: toProtoGroup(data.group),
      members: data.members.map(toProtoMember)
    };
  },

  updateGroup: async (
    request: V2UpdateGroupRequest,
    context: HeaderContext
  ) => {
    const directResult = await updateGroupDirect(
      {
        groupId: request.groupId,
        json: JSON.stringify({
          name: request.name || undefined,
          description: request.description || undefined
        })
      },
      context
    );
    const data = parseDirectJson<{ group: MlsGroup }>(directResult);
    return { group: toProtoGroup(data.group) };
  },

  deleteGroup: async (request: GroupIdRequest, context: HeaderContext) => {
    await deleteGroupDirect(request, context);
    return {};
  },

  addGroupMember: async (
    request: V2AddGroupMemberRequest,
    context: HeaderContext
  ) => {
    const directResult = await addGroupMemberDirect(
      {
        groupId: request.groupId,
        json: JSON.stringify({
          userId: request.userId,
          commit: request.commit,
          welcome: request.welcome,
          keyPackageRef: request.keyPackageRef,
          newEpoch: Number(request.newEpoch)
        })
      },
      context
    );
    const data = parseDirectJson<{ member: MlsGroupMember }>(directResult);
    return { member: toProtoMember(data.member) };
  },

  getGroupMembers: async (
    request: GroupIdRequest,
    context: HeaderContext
  ) => {
    const directResult = await getGroupMembersDirect(request, context);
    const data = parseDirectJson<{ members: MlsGroupMember[] }>(directResult);
    return { members: data.members.map(toProtoMember) };
  },

  removeGroupMember: async (
    request: V2RemoveGroupMemberRequest,
    context: HeaderContext
  ) => {
    await removeGroupMemberDirect(
      {
        groupId: request.groupId,
        userId: request.userId,
        json: JSON.stringify({
          commit: request.commit,
          newEpoch: Number(request.newEpoch)
        })
      },
      context
    );
    return {};
  },

  sendGroupMessage: async (
    request: V2SendGroupMessageRequest,
    context: HeaderContext
  ) => {
    const directResult = await sendGroupMessageDirect(
      {
        groupId: request.groupId,
        json: JSON.stringify({
          ciphertext: request.ciphertext,
          epoch: Number(request.epoch),
          messageType: fromProtoMessageType(request.messageType),
          contentType: request.contentType || undefined
        })
      },
      context
    );
    const data = parseDirectJson<{ message: MlsMessage }>(directResult);
    return { message: toProtoMessage(data.message) };
  },

  getGroupMessages: async (
    request: GetGroupMessagesRequest,
    context: HeaderContext
  ) => {
    const directResult = await getGroupMessagesDirect(request, context);
    const data = parseDirectJson<{
      messages: MlsMessage[];
      hasMore: boolean;
      cursor?: string;
    }>(directResult);
    return {
      messages: data.messages.map(toProtoMessage),
      hasMore: data.hasMore,
      cursor: data.cursor ?? ''
    };
  },

  getGroupState: async (request: GroupIdRequest, context: HeaderContext) => {
    const directResult = await getGroupStateDirect(request, context);
    const data = parseDirectJson<MlsGroupStateResponse>(directResult);
    if (!data.state) {
      return {};
    }
    return { state: toProtoGroupState(data.state) };
  },

  uploadGroupState: async (
    request: V2UploadGroupStateRequest,
    context: HeaderContext
  ) => {
    const directResult = await uploadGroupStateDirect(
      {
        groupId: request.groupId,
        json: JSON.stringify({
          epoch: Number(request.epoch),
          encryptedState: request.encryptedState,
          stateHash: request.stateHash
        })
      },
      context
    );
    const data = parseDirectJson<{ state: MlsGroupState }>(directResult);
    return { state: toProtoGroupState(data.state) };
  },

  getWelcomeMessages: async (_request: object, context: HeaderContext) => {
    const directResult = await getWelcomeMessagesDirect({}, context);
    const data = parseDirectJson<{
      welcomes: MlsWelcomeMessage[];
    }>(directResult);
    return { welcomes: data.welcomes.map(toProtoWelcome) };
  },

  acknowledgeWelcome: async (
    request: V2AcknowledgeWelcomeRequest,
    context: HeaderContext
  ) => {
    await acknowledgeWelcomeDirect(
      {
        id: request.id,
        json: JSON.stringify({ groupId: request.groupId })
      },
      context
    );
    return {};
  }
};
