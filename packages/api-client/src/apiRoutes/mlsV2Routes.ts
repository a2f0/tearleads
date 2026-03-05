import { create } from '@bufbuild/protobuf';
import type {
  AckMlsWelcomeRequest,
  AddMlsMemberRequest,
  AddMlsMemberResponse,
  CreateMlsGroupRequest,
  CreateMlsGroupResponse,
  MlsGroupMembersResponse,
  MlsGroupResponse,
  MlsGroupStateResponse,
  MlsGroupsResponse,
  MlsKeyPackagesResponse,
  MlsMessagesResponse,
  MlsWelcomeMessagesResponse,
  RemoveMlsMemberRequest,
  SendMlsMessageRequest,
  SendMlsMessageResponse,
  UpdateMlsGroupRequest,
  UploadMlsKeyPackagesRequest,
  UploadMlsKeyPackagesResponse,
  UploadMlsStateRequest,
  UploadMlsStateResponse
} from '@tearleads/shared';
import {
  MlsAcknowledgeWelcomeRequestSchema,
  MlsAddGroupMemberRequestSchema,
  MlsCreateGroupRequestSchema,
  MlsDeleteGroupRequestSchema,
  MlsDeleteKeyPackageRequestSchema,
  MlsGetGroupMembersRequestSchema,
  MlsGetGroupMessagesRequestSchema,
  MlsGetGroupRequestSchema,
  MlsGetGroupStateRequestSchema,
  MlsGetMyKeyPackagesRequestSchema,
  MlsGetUserKeyPackagesRequestSchema,
  MlsGetWelcomeMessagesRequestSchema,
  MlsListGroupsRequestSchema,
  MlsRemoveGroupMemberRequestSchema,
  MlsSendGroupMessageRequestSchema,
  MlsUpdateGroupRequestSchema,
  MlsUploadGroupStateRequestSchema,
  MlsUploadKeyPackageInputSchema,
  MlsUploadKeyPackagesRequestSchema
} from '@tearleads/shared/gen/tearleads/v2/mls_pb';
import { stringToProtoBytes } from './mlsV2Binary';
import {
  buildCallContext,
  createClientResolver,
  createDefaultDependencies,
  type MlsV2RoutesDependencies,
  runWithEvent
} from './mlsV2Client';

export type { MlsV2Client } from './mlsV2Client';
export { createDefaultMlsV2Client } from './mlsV2Client';

import {
  mapGroupInfoToMlsGroup,
  mapGroupStateInfoToMlsGroupState,
  mapKeyPackageEntryToMlsKeyPackage,
  mapMemberInfoToGroupMember,
  mapMessageInfoToMlsMessage,
  mapWelcomeInfoToMlsWelcomeMessage,
  toProtoCipherSuite,
  toProtoMessageType
} from './mlsV2Mappers';

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createMlsV2Routes(
  overrides: Partial<MlsV2RoutesDependencies> = {}
) {
  const dependencies = {
    ...createDefaultDependencies(),
    ...overrides
  };
  const getClient = createClientResolver(dependencies);

  return {
    listGroups: (): Promise<MlsGroupsResponse> =>
      runWithEvent(dependencies, 'api_get_mls_groups', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.listGroups(
          create(MlsListGroupsRequestSchema),
          callOptions
        );
        return { groups: response.groups.map(mapGroupInfoToMlsGroup) };
      }),

    getGroup: (groupId: string): Promise<MlsGroupResponse> =>
      runWithEvent(dependencies, 'api_get_mls_group', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getGroup(
          create(MlsGetGroupRequestSchema, { groupId }),
          callOptions
        );
        return {
          group: response.group
            ? mapGroupInfoToMlsGroup(response.group)
            : {
                id: '',
                groupIdMls: '',
                name: '',
                description: null,
                creatorUserId: '',
                currentEpoch: 0,
                cipherSuite: 1,
                createdAt: '',
                updatedAt: ''
              },
          members: response.members.map(mapMemberInfoToGroupMember)
        };
      }),

    createGroup: (
      data: CreateMlsGroupRequest
    ): Promise<CreateMlsGroupResponse> =>
      runWithEvent(dependencies, 'api_post_mls_group', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.createGroup(
          create(MlsCreateGroupRequestSchema, {
            name: data.name,
            description: data.description ?? '',
            groupIdMls: data.groupIdMls,
            cipherSuite: toProtoCipherSuite(data.cipherSuite)
          }),
          callOptions
        );
        return {
          group: response.group
            ? mapGroupInfoToMlsGroup(response.group)
            : {
                id: '',
                groupIdMls: '',
                name: data.name,
                description: null,
                creatorUserId: '',
                currentEpoch: 0,
                cipherSuite: data.cipherSuite,
                createdAt: '',
                updatedAt: ''
              }
        };
      }),

    updateGroup: (
      groupId: string,
      data: UpdateMlsGroupRequest
    ): Promise<CreateMlsGroupResponse> =>
      runWithEvent(dependencies, 'api_patch_mls_group', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.updateGroup(
          create(MlsUpdateGroupRequestSchema, {
            groupId,
            name: data.name ?? '',
            description: data.description ?? ''
          }),
          callOptions
        );
        return {
          group: response.group
            ? mapGroupInfoToMlsGroup(response.group)
            : {
                id: groupId,
                groupIdMls: '',
                name: '',
                description: null,
                creatorUserId: '',
                currentEpoch: 0,
                cipherSuite: 1,
                createdAt: '',
                updatedAt: ''
              }
        };
      }),

    leaveGroup: (groupId: string): Promise<void> =>
      runWithEvent(dependencies, 'api_delete_mls_group', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        await client.deleteGroup(
          create(MlsDeleteGroupRequestSchema, { groupId }),
          callOptions
        );
      }),

    getGroupMembers: (groupId: string): Promise<MlsGroupMembersResponse> =>
      runWithEvent(dependencies, 'api_get_mls_group_members', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getGroupMembers(
          create(MlsGetGroupMembersRequestSchema, { groupId }),
          callOptions
        );
        return {
          members: response.members.map(mapMemberInfoToGroupMember)
        };
      }),

    addGroupMember: (
      groupId: string,
      data: AddMlsMemberRequest
    ): Promise<AddMlsMemberResponse> =>
      runWithEvent(dependencies, 'api_post_mls_group_member', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.addGroupMember(
          create(MlsAddGroupMemberRequestSchema, {
            groupId,
            userId: data.userId,
            commit: stringToProtoBytes(data.commit),
            welcome: stringToProtoBytes(data.welcome),
            keyPackageRef: data.keyPackageRef,
            newEpoch: BigInt(data.newEpoch)
          }),
          callOptions
        );
        return {
          member: response.member
            ? mapMemberInfoToGroupMember(response.member)
            : {
                userId: data.userId,
                email: '',
                leafIndex: null,
                role: 'member',
                joinedAt: '',
                joinedAtEpoch: 0
              }
        };
      }),

    removeGroupMember: (
      groupId: string,
      userId: string,
      data: RemoveMlsMemberRequest
    ): Promise<void> =>
      runWithEvent(dependencies, 'api_delete_mls_group_member', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        await client.removeGroupMember(
          create(MlsRemoveGroupMemberRequestSchema, {
            groupId,
            userId,
            commit: stringToProtoBytes(data.commit),
            newEpoch: BigInt(data.newEpoch)
          }),
          callOptions
        );
      }),

    getGroupMessages: (
      groupId: string,
      options?: { cursor?: string; limit?: number }
    ): Promise<MlsMessagesResponse> =>
      runWithEvent(dependencies, 'api_get_mls_group_messages', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getGroupMessages(
          create(MlsGetGroupMessagesRequestSchema, {
            groupId,
            cursor: options?.cursor ?? '',
            limit: options?.limit ?? 0
          }),
          callOptions
        );
        const messagesResult: MlsMessagesResponse = {
          messages: response.messages.map(mapMessageInfoToMlsMessage),
          hasMore: response.hasMore
        };
        if (response.cursor) {
          messagesResult.cursor = response.cursor;
        }
        return messagesResult;
      }),

    sendGroupMessage: (
      groupId: string,
      data: SendMlsMessageRequest
    ): Promise<SendMlsMessageResponse> =>
      runWithEvent(dependencies, 'api_post_mls_group_message', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.sendGroupMessage(
          create(MlsSendGroupMessageRequestSchema, {
            groupId,
            ciphertext: stringToProtoBytes(data.ciphertext),
            epoch: BigInt(data.epoch),
            messageType: toProtoMessageType(data.messageType),
            contentType: data.contentType ?? ''
          }),
          callOptions
        );
        return {
          message: response.message
            ? mapMessageInfoToMlsMessage(response.message)
            : {
                id: '',
                groupId,
                senderUserId: null,
                epoch: data.epoch,
                ciphertext: data.ciphertext,
                messageType: data.messageType,
                contentType: data.contentType ?? 'text/plain',
                sequenceNumber: 0,
                sentAt: '',
                createdAt: ''
              }
        };
      }),

    getGroupState: (groupId: string): Promise<MlsGroupStateResponse> =>
      runWithEvent(dependencies, 'api_get_mls_group_state', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getGroupState(
          create(MlsGetGroupStateRequestSchema, { groupId }),
          callOptions
        );
        return {
          state: response.state
            ? mapGroupStateInfoToMlsGroupState(response.state)
            : null
        };
      }),

    uploadGroupState: (
      groupId: string,
      data: UploadMlsStateRequest
    ): Promise<UploadMlsStateResponse> =>
      runWithEvent(dependencies, 'api_post_mls_group_state', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.uploadGroupState(
          create(MlsUploadGroupStateRequestSchema, {
            groupId,
            epoch: BigInt(data.epoch),
            encryptedState: stringToProtoBytes(data.encryptedState),
            stateHash: data.stateHash
          }),
          callOptions
        );
        return {
          state: response.state
            ? mapGroupStateInfoToMlsGroupState(response.state)
            : {
                id: '',
                groupId,
                epoch: data.epoch,
                encryptedState: data.encryptedState,
                stateHash: data.stateHash,
                createdAt: ''
              }
        };
      }),

    getMyKeyPackages: (): Promise<MlsKeyPackagesResponse> =>
      runWithEvent(dependencies, 'api_get_mls_key_packages_me', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getMyKeyPackages(
          create(MlsGetMyKeyPackagesRequestSchema),
          callOptions
        );
        return {
          keyPackages: response.keyPackages.map(
            mapKeyPackageEntryToMlsKeyPackage
          )
        };
      }),

    getUserKeyPackages: (userId: string): Promise<MlsKeyPackagesResponse> =>
      runWithEvent(dependencies, 'api_get_mls_key_packages_user', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getUserKeyPackages(
          create(MlsGetUserKeyPackagesRequestSchema, { userId }),
          callOptions
        );
        return {
          keyPackages: response.keyPackages.map(
            mapKeyPackageEntryToMlsKeyPackage
          )
        };
      }),

    uploadKeyPackages: (
      data: UploadMlsKeyPackagesRequest
    ): Promise<UploadMlsKeyPackagesResponse> =>
      runWithEvent(dependencies, 'api_post_mls_key_packages', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.uploadKeyPackages(
          create(MlsUploadKeyPackagesRequestSchema, {
            keyPackages: data.keyPackages.map((kp) =>
              create(MlsUploadKeyPackageInputSchema, {
                keyPackageData: kp.keyPackageData,
                keyPackageRef: kp.keyPackageRef,
                cipherSuite: toProtoCipherSuite(kp.cipherSuite)
              })
            )
          }),
          callOptions
        );
        return {
          keyPackages: response.keyPackages.map(
            mapKeyPackageEntryToMlsKeyPackage
          )
        };
      }),

    deleteKeyPackage: (id: string): Promise<void> =>
      runWithEvent(dependencies, 'api_delete_mls_key_package', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        await client.deleteKeyPackage(
          create(MlsDeleteKeyPackageRequestSchema, { id }),
          callOptions
        );
      }),

    getWelcomeMessages: (): Promise<MlsWelcomeMessagesResponse> =>
      runWithEvent(dependencies, 'api_get_mls_welcome_messages', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        const response = await client.getWelcomeMessages(
          create(MlsGetWelcomeMessagesRequestSchema),
          callOptions
        );
        return {
          welcomes: response.welcomes.map(mapWelcomeInfoToMlsWelcomeMessage)
        };
      }),

    acknowledgeWelcome: (
      id: string,
      data: AckMlsWelcomeRequest
    ): Promise<{ acknowledged: boolean }> =>
      runWithEvent(dependencies, 'api_post_mls_welcome_ack', async () => {
        const { client, callOptions } = await buildCallContext(
          dependencies,
          getClient
        );
        await client.acknowledgeWelcome(
          create(MlsAcknowledgeWelcomeRequestSchema, {
            id,
            groupId: data.groupId
          }),
          callOptions
        );
        return { acknowledged: true };
      })
  };
}

export type MlsV2Routes = ReturnType<typeof createMlsV2Routes>;

export const mlsV2Routes = createMlsV2Routes();
