import type {
  AckMlsWelcomeRequest,
  AddMlsMemberRequest,
  AddMlsMemberResponse,
  CreateMlsGroupRequest,
  CreateMlsGroupResponse,
  MlsGroup,
  MlsGroupMembersResponse,
  MlsGroupResponse,
  MlsGroupState,
  MlsGroupStateResponse,
  MlsGroupsResponse,
  MlsKeyPackage,
  MlsMessage,
  MlsMessagesResponse,
  MlsWelcomeMessage,
  MlsWelcomeMessagesResponse,
  RemoveMlsMemberRequest,
  SendMlsMessageRequest,
  SendMlsMessageResponse,
  UpdateMlsGroupRequest,
  UploadMlsKeyPackagesRequest,
  UploadMlsStateRequest,
  UploadMlsStateResponse
} from '@tearleads/shared';
import { bytesToBase64, decodeRequiredTransportBytes } from './mlsV2Binary';
import { createMlsV2Routes as createWireMlsV2Routes } from './mlsV2Routes';

type MlsBinaryKeyPackage = Omit<MlsKeyPackage, 'keyPackageData'> & {
  keyPackageData: Uint8Array;
};

type MlsBinaryMessage = Omit<MlsMessage, 'ciphertext'> & {
  ciphertext: Uint8Array;
};

type MlsBinaryWelcomeMessage = Omit<MlsWelcomeMessage, 'welcome'> & {
  welcome: Uint8Array;
};

type MlsBinaryGroupState = Omit<MlsGroupState, 'encryptedState'> & {
  encryptedState: Uint8Array;
};

export type UploadMlsKeyPackagesBinaryRequest = {
  keyPackages: Array<
    Omit<
      UploadMlsKeyPackagesRequest['keyPackages'][number],
      'keyPackageData'
    > & {
      keyPackageData: Uint8Array;
    }
  >;
};

export type UploadMlsKeyPackagesBinaryResponse = {
  keyPackages: MlsBinaryKeyPackage[];
};

export type MlsBinaryKeyPackagesResponse = {
  keyPackages: MlsBinaryKeyPackage[];
};

export type AddMlsMemberBinaryRequest = Omit<
  AddMlsMemberRequest,
  'commit' | 'welcome'
> & {
  commit: Uint8Array;
  welcome: Uint8Array;
};

export type RemoveMlsMemberBinaryRequest = Omit<
  RemoveMlsMemberRequest,
  'commit'
> & {
  commit: Uint8Array;
};

export type SendMlsMessageBinaryRequest = Omit<
  SendMlsMessageRequest,
  'ciphertext'
> & {
  ciphertext: Uint8Array;
};

export type SendMlsMessageBinaryResponse = Omit<
  SendMlsMessageResponse,
  'message'
> & {
  message: MlsBinaryMessage;
};

export type MlsBinaryMessagesResponse = Omit<
  MlsMessagesResponse,
  'messages'
> & {
  messages: MlsBinaryMessage[];
};

export type MlsBinaryWelcomeMessagesResponse = Omit<
  MlsWelcomeMessagesResponse,
  'welcomes'
> & {
  welcomes: MlsBinaryWelcomeMessage[];
};

export type UploadMlsStateBinaryRequest = Omit<
  UploadMlsStateRequest,
  'encryptedState'
> & {
  encryptedState: Uint8Array;
};

export type UploadMlsStateBinaryResponse = Omit<
  UploadMlsStateResponse,
  'state'
> & {
  state: MlsBinaryGroupState;
};

export type MlsBinaryGroupStateResponse = Omit<
  MlsGroupStateResponse,
  'state'
> & {
  state: MlsBinaryGroupState | null;
};

function toBinaryKeyPackage(keyPackage: MlsKeyPackage): MlsBinaryKeyPackage {
  return {
    ...keyPackage,
    keyPackageData: decodeRequiredTransportBytes(
      keyPackage.keyPackageData,
      'keyPackageData'
    )
  };
}

function toBinaryMessage(message: MlsMessage): MlsBinaryMessage {
  return {
    ...message,
    ciphertext: decodeRequiredTransportBytes(message.ciphertext, 'ciphertext')
  };
}

function toBinaryGroupState(state: MlsGroupState): MlsBinaryGroupState {
  return {
    ...state,
    encryptedState: decodeRequiredTransportBytes(
      state.encryptedState,
      'encryptedState'
    )
  };
}

function toBinaryWelcome(welcome: MlsWelcomeMessage): MlsBinaryWelcomeMessage {
  return {
    ...welcome,
    welcome: decodeRequiredTransportBytes(welcome.welcome, 'welcome')
  };
}

export interface MlsV2Routes {
  listGroups: () => Promise<MlsGroupsResponse>;
  getGroup: (groupId: string) => Promise<MlsGroupResponse>;
  createGroup: (data: CreateMlsGroupRequest) => Promise<CreateMlsGroupResponse>;
  updateGroup: (
    groupId: string,
    data: UpdateMlsGroupRequest
  ) => Promise<CreateMlsGroupResponse>;
  leaveGroup: (groupId: string) => Promise<void>;
  getGroupMembers: (groupId: string) => Promise<MlsGroupMembersResponse>;
  addGroupMember: (
    groupId: string,
    data: AddMlsMemberBinaryRequest
  ) => Promise<AddMlsMemberResponse>;
  removeGroupMember: (
    groupId: string,
    userId: string,
    data: RemoveMlsMemberBinaryRequest
  ) => Promise<void>;
  getGroupMessages: (
    groupId: string,
    options?: { cursor?: string; limit?: number }
  ) => Promise<MlsBinaryMessagesResponse>;
  sendGroupMessage: (
    groupId: string,
    data: SendMlsMessageBinaryRequest
  ) => Promise<SendMlsMessageBinaryResponse>;
  getGroupState: (groupId: string) => Promise<MlsBinaryGroupStateResponse>;
  uploadGroupState: (
    groupId: string,
    data: UploadMlsStateBinaryRequest
  ) => Promise<UploadMlsStateBinaryResponse>;
  getMyKeyPackages: () => Promise<MlsBinaryKeyPackagesResponse>;
  getUserKeyPackages: (userId: string) => Promise<MlsBinaryKeyPackagesResponse>;
  uploadKeyPackages: (
    data: UploadMlsKeyPackagesBinaryRequest
  ) => Promise<UploadMlsKeyPackagesBinaryResponse>;
  deleteKeyPackage: (id: string) => Promise<void>;
  getWelcomeMessages: () => Promise<MlsBinaryWelcomeMessagesResponse>;
  acknowledgeWelcome: (
    id: string,
    data: AckMlsWelcomeRequest
  ) => Promise<{ acknowledged: boolean }>;
}

type RouteOverrides = Parameters<typeof createWireMlsV2Routes>[0];

export function createMlsV2Routes(overrides: RouteOverrides = {}): MlsV2Routes {
  const wireRoutes = createWireMlsV2Routes(overrides);

  return {
    listGroups: () => wireRoutes.listGroups(),

    getGroup: async (groupId: string): Promise<MlsGroupResponse> => {
      const response = await wireRoutes.getGroup(groupId);
      const group: MlsGroup = response.group;
      return { ...response, group };
    },

    createGroup: (data: CreateMlsGroupRequest) => wireRoutes.createGroup(data),

    updateGroup: (groupId: string, data: UpdateMlsGroupRequest) =>
      wireRoutes.updateGroup(groupId, data),

    leaveGroup: (groupId: string) => wireRoutes.leaveGroup(groupId),

    getGroupMembers: (groupId: string) => wireRoutes.getGroupMembers(groupId),

    addGroupMember: (groupId: string, data: AddMlsMemberBinaryRequest) =>
      wireRoutes.addGroupMember(groupId, {
        ...data,
        commit: bytesToBase64(data.commit),
        welcome: bytesToBase64(data.welcome)
      }),

    removeGroupMember: (
      groupId: string,
      userId: string,
      data: RemoveMlsMemberBinaryRequest
    ) =>
      wireRoutes.removeGroupMember(groupId, userId, {
        ...data,
        commit: bytesToBase64(data.commit)
      }),

    getGroupMessages: async (
      groupId: string,
      options?: { cursor?: string; limit?: number }
    ): Promise<MlsBinaryMessagesResponse> => {
      const response = await wireRoutes.getGroupMessages(groupId, options);
      return {
        ...response,
        messages: response.messages.map(toBinaryMessage)
      };
    },

    sendGroupMessage: async (
      groupId: string,
      data: SendMlsMessageBinaryRequest
    ): Promise<SendMlsMessageBinaryResponse> => {
      const response = await wireRoutes.sendGroupMessage(groupId, {
        ...data,
        ciphertext: bytesToBase64(data.ciphertext)
      });

      return {
        ...response,
        message: toBinaryMessage(response.message)
      };
    },

    getGroupState: async (
      groupId: string
    ): Promise<MlsBinaryGroupStateResponse> => {
      const response = await wireRoutes.getGroupState(groupId);
      return {
        ...response,
        state: response.state ? toBinaryGroupState(response.state) : null
      };
    },

    uploadGroupState: async (
      groupId: string,
      data: UploadMlsStateBinaryRequest
    ): Promise<UploadMlsStateBinaryResponse> => {
      const response = await wireRoutes.uploadGroupState(groupId, {
        ...data,
        encryptedState: bytesToBase64(data.encryptedState)
      });

      return {
        ...response,
        state: toBinaryGroupState(response.state)
      };
    },

    getMyKeyPackages: async (): Promise<MlsBinaryKeyPackagesResponse> => {
      const response = await wireRoutes.getMyKeyPackages();
      return {
        ...response,
        keyPackages: response.keyPackages.map(toBinaryKeyPackage)
      };
    },

    getUserKeyPackages: async (
      userId: string
    ): Promise<MlsBinaryKeyPackagesResponse> => {
      const response = await wireRoutes.getUserKeyPackages(userId);
      return {
        ...response,
        keyPackages: response.keyPackages.map(toBinaryKeyPackage)
      };
    },

    uploadKeyPackages: async (
      data: UploadMlsKeyPackagesBinaryRequest
    ): Promise<UploadMlsKeyPackagesBinaryResponse> => {
      const response = await wireRoutes.uploadKeyPackages({
        keyPackages: data.keyPackages.map((keyPackage) => ({
          ...keyPackage,
          keyPackageData: bytesToBase64(keyPackage.keyPackageData)
        }))
      });

      return {
        ...response,
        keyPackages: response.keyPackages.map(toBinaryKeyPackage)
      };
    },

    deleteKeyPackage: (id: string) => wireRoutes.deleteKeyPackage(id),

    getWelcomeMessages: async (): Promise<MlsBinaryWelcomeMessagesResponse> => {
      const response = await wireRoutes.getWelcomeMessages();
      return {
        ...response,
        welcomes: response.welcomes.map(toBinaryWelcome)
      };
    },

    acknowledgeWelcome: (id: string, data: AckMlsWelcomeRequest) =>
      wireRoutes.acknowledgeWelcome(id, data)
  };
}
