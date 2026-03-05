import {
  addGroupMemberDirect,
  addGroupMemberDirectTyped,
  getGroupMembersDirect,
  getGroupMembersDirectTyped,
  removeGroupMemberDirect,
  removeGroupMemberDirectTyped
} from './mlsDirectGroupMembers.js';
import {
  createGroupDirect,
  createGroupDirectTyped,
  deleteGroupDirect,
  deleteGroupDirectTyped,
  getGroupDirect,
  getGroupDirectTyped,
  listGroupsDirect,
  listGroupsDirectTyped,
  updateGroupDirect,
  updateGroupDirectTyped
} from './mlsDirectGroups.js';
import {
  deleteKeyPackageDirect,
  deleteKeyPackageDirectTyped,
  getMyKeyPackagesDirect,
  getMyKeyPackagesDirectTyped,
  getUserKeyPackagesDirect,
  getUserKeyPackagesDirectTyped,
  uploadKeyPackagesDirect,
  uploadKeyPackagesDirectTyped
} from './mlsDirectKeyPackages.js';
import {
  getGroupMessagesDirect,
  getGroupMessagesDirectTyped,
  sendGroupMessageDirect,
  sendGroupMessageDirectTyped
} from './mlsDirectMessages.js';
import {
  getGroupStateDirect,
  getGroupStateDirectTyped,
  uploadGroupStateDirect,
  uploadGroupStateDirectTyped
} from './mlsDirectState.js';
import {
  acknowledgeWelcomeDirect,
  acknowledgeWelcomeDirectTyped,
  getWelcomeMessagesDirect,
  getWelcomeMessagesDirectTyped
} from './mlsDirectWelcomeMessages.js';
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
import {
  encodeProtoBytes,
  fromProtoCipherSuite,
  fromProtoMessageType,
  toProtoGroup,
  toProtoGroupState,
  toProtoKeyPackage,
  toProtoMember,
  toProtoMessage,
  toProtoWelcome
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
    const data = await uploadKeyPackagesDirectTyped(
      {
        keyPackages: request.keyPackages.map((kp) => ({
          keyPackageData: kp.keyPackageData,
          keyPackageRef: kp.keyPackageRef,
          cipherSuite: fromProtoCipherSuite(kp.cipherSuite)
        }))
      },
      context
    );
    return { keyPackages: data.keyPackages.map(toProtoKeyPackage) };
  },

  getMyKeyPackages: async (_request: object, context: HeaderContext) => {
    const data = await getMyKeyPackagesDirectTyped({}, context);
    return { keyPackages: data.keyPackages.map(toProtoKeyPackage) };
  },

  getUserKeyPackages: async (
    request: UserIdRequest,
    context: HeaderContext
  ) => {
    const data = await getUserKeyPackagesDirectTyped(request, context);
    return { keyPackages: data.keyPackages.map(toProtoKeyPackage) };
  },

  deleteKeyPackage: async (request: MlsIdRequest, context: HeaderContext) => {
    await deleteKeyPackageDirectTyped(request, context);
    return {};
  },

  createGroup: async (
    request: V2CreateGroupRequest,
    context: HeaderContext
  ) => {
    const directRequest = {
      name: request.name,
      ...(request.description ? { description: request.description } : {}),
      groupIdMls: request.groupIdMls,
      cipherSuite: fromProtoCipherSuite(request.cipherSuite)
    };
    const data = await createGroupDirectTyped(directRequest, context);
    return { group: toProtoGroup(data.group) };
  },

  listGroups: async (_request: object, context: HeaderContext) => {
    const data = await listGroupsDirectTyped({}, context);
    return { groups: data.groups.map(toProtoGroup) };
  },

  getGroup: async (request: GroupIdRequest, context: HeaderContext) => {
    const data = await getGroupDirectTyped(request, context);
    return {
      group: toProtoGroup(data.group),
      members: data.members.map(toProtoMember)
    };
  },

  updateGroup: async (
    request: V2UpdateGroupRequest,
    context: HeaderContext
  ) => {
    const directRequest = {
      groupId: request.groupId,
      ...(request.name ? { name: request.name } : {}),
      ...(request.description ? { description: request.description } : {})
    };
    const data = await updateGroupDirectTyped(directRequest, context);
    return { group: toProtoGroup(data.group) };
  },

  deleteGroup: async (request: GroupIdRequest, context: HeaderContext) => {
    await deleteGroupDirectTyped(request, context);
    return {};
  },

  addGroupMember: async (
    request: V2AddGroupMemberRequest,
    context: HeaderContext
  ) => {
    const data = await addGroupMemberDirectTyped(
      {
        groupId: request.groupId,
        userId: request.userId,
        commit: encodeProtoBytes(request.commit),
        welcome: encodeProtoBytes(request.welcome),
        keyPackageRef: request.keyPackageRef,
        newEpoch: Number(request.newEpoch)
      },
      context
    );
    return { member: toProtoMember(data.member) };
  },

  getGroupMembers: async (request: GroupIdRequest, context: HeaderContext) => {
    const data = await getGroupMembersDirectTyped(request, context);
    return { members: data.members.map(toProtoMember) };
  },

  removeGroupMember: async (
    request: V2RemoveGroupMemberRequest,
    context: HeaderContext
  ) => {
    await removeGroupMemberDirectTyped(
      {
        groupId: request.groupId,
        userId: request.userId,
        commit: encodeProtoBytes(request.commit),
        newEpoch: Number(request.newEpoch)
      },
      context
    );
    return {};
  },

  sendGroupMessage: async (
    request: V2SendGroupMessageRequest,
    context: HeaderContext
  ) => {
    const directRequest = {
      groupId: request.groupId,
      ciphertext: encodeProtoBytes(request.ciphertext),
      epoch: Number(request.epoch),
      messageType: fromProtoMessageType(request.messageType),
      ...(request.contentType ? { contentType: request.contentType } : {})
    };
    const data = await sendGroupMessageDirectTyped(directRequest, context);
    return { message: toProtoMessage(data.message) };
  },

  getGroupMessages: async (
    request: GetGroupMessagesRequest,
    context: HeaderContext
  ) => {
    const data = await getGroupMessagesDirectTyped(request, context);
    return {
      messages: data.messages.map(toProtoMessage),
      hasMore: data.hasMore,
      cursor: data.cursor ?? ''
    };
  },

  getGroupState: async (request: GroupIdRequest, context: HeaderContext) => {
    const data = await getGroupStateDirectTyped(request, context);
    if (!data.state) {
      return {};
    }
    return { state: toProtoGroupState(data.state) };
  },

  uploadGroupState: async (
    request: V2UploadGroupStateRequest,
    context: HeaderContext
  ) => {
    const data = await uploadGroupStateDirectTyped(
      {
        groupId: request.groupId,
        epoch: Number(request.epoch),
        encryptedState: encodeProtoBytes(request.encryptedState),
        stateHash: request.stateHash
      },
      context
    );
    return { state: toProtoGroupState(data.state) };
  },

  getWelcomeMessages: async (_request: object, context: HeaderContext) => {
    const data = await getWelcomeMessagesDirectTyped({}, context);
    return { welcomes: data.welcomes.map(toProtoWelcome) };
  },

  acknowledgeWelcome: async (
    request: V2AcknowledgeWelcomeRequest,
    context: HeaderContext
  ) => {
    await acknowledgeWelcomeDirectTyped(
      {
        id: request.id,
        groupId: request.groupId
      },
      context
    );
    return {};
  }
};
