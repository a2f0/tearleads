import {
  addGroupMemberDirectTyped,
  getGroupMembersDirectTyped,
  removeGroupMemberDirectTyped
} from './mlsDirectGroupMembers.js';
import {
  createGroupDirectTyped,
  deleteGroupDirectTyped,
  getGroupDirectTyped,
  listGroupsDirectTyped,
  updateGroupDirectTyped
} from './mlsDirectGroups.js';
import {
  deleteKeyPackageDirectTyped,
  getMyKeyPackagesDirectTyped,
  getUserKeyPackagesDirectTyped,
  uploadKeyPackagesDirectTyped
} from './mlsDirectKeyPackages.js';
import {
  getGroupMessagesDirectTyped,
  sendGroupMessageDirectTyped
} from './mlsDirectMessages.js';
import {
  getGroupStateDirectTyped,
  uploadGroupStateDirectTyped
} from './mlsDirectState.js';
import {
  acknowledgeWelcomeDirectTyped,
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
  fromProtoCipherSuite,
  fromProtoMessageType,
  toProtoGroup,
  toProtoGroupState,
  toProtoKeyPackage,
  toProtoMember,
  toProtoMessage,
  toProtoWelcome
} from './mlsV2Converters.js';

type UserIdRequest = { userId: string };
type MlsIdRequest = { id: string };
type GroupIdRequest = { groupId: string };
type GetGroupMessagesRequest = {
  groupId: string;
  cursor: string;
  limit: number;
};
type HeaderContext = { requestHeader: Headers };

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
          keyPackageData: Uint8Array.from(kp.keyPackageData),
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
        commit: Uint8Array.from(request.commit),
        welcome: Uint8Array.from(request.welcome),
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
        commit: Uint8Array.from(request.commit),
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
      ciphertext: Uint8Array.from(request.ciphertext),
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
        encryptedState: Uint8Array.from(request.encryptedState),
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
