import type {
  MlsCipherSuite,
  MlsGroup,
  MlsGroupMember,
  MlsGroupRole,
  MlsMessage,
  MlsMessageType
} from './mlsTypes.js';

export type MlsBinaryGroup = MlsGroup;
export type MlsBinaryGroupMember = MlsGroupMember;
export type MlsBinaryGroupRole = MlsGroupRole;
export type MlsBinaryMessageType = MlsMessageType;

export interface MlsBinaryKeyPackage {
  id: string;
  userId: string;
  keyPackageData: Uint8Array;
  keyPackageRef: string;
  cipherSuite: MlsCipherSuite;
  createdAt: string;
  consumed: boolean;
}

export interface UploadMlsKeyPackagesBinaryRequest {
  keyPackages: Array<{
    keyPackageData: Uint8Array;
    keyPackageRef: string;
    cipherSuite: MlsCipherSuite;
  }>;
}

export interface UploadMlsKeyPackagesBinaryResponse {
  keyPackages: MlsBinaryKeyPackage[];
}

export interface MlsBinaryKeyPackagesResponse {
  keyPackages: MlsBinaryKeyPackage[];
}

export interface AddMlsMemberBinaryRequest {
  userId: string;
  commit: Uint8Array;
  welcome: Uint8Array;
  keyPackageRef: string;
  newEpoch: number;
}

export interface AddMlsMemberBinaryResponse {
  member: MlsBinaryGroupMember;
}

export interface MlsBinaryGroupMembersResponse {
  members: MlsBinaryGroupMember[];
}

export interface RemoveMlsMemberBinaryRequest {
  commit: Uint8Array;
  newEpoch: number;
}

export interface MlsBinaryMessage {
  id: string;
  groupId: string;
  senderUserId: string | null;
  senderEmail?: string;
  epoch: number;
  ciphertext: Uint8Array;
  messageType: MlsBinaryMessageType;
  contentType: string;
  sequenceNumber: number;
  sentAt: string;
  createdAt: string;
}

export interface SendMlsMessageBinaryRequest {
  ciphertext: Uint8Array;
  epoch: number;
  messageType: MlsBinaryMessageType;
  contentType?: string;
}

export interface SendMlsMessageBinaryResponse {
  message: MlsBinaryMessage;
}

export interface MlsBinaryMessagesResponse {
  messages: MlsBinaryMessage[];
  hasMore: boolean;
  cursor?: string;
}

export interface MlsBinaryWelcomeMessage {
  id: string;
  groupId: string;
  groupName: string;
  welcome: Uint8Array;
  keyPackageRef: string;
  epoch: number;
  createdAt: string;
}

export interface MlsBinaryWelcomeMessagesResponse {
  welcomes: MlsBinaryWelcomeMessage[];
}

export interface MlsBinaryGroupState {
  id: string;
  groupId: string;
  epoch: number;
  encryptedState: Uint8Array;
  stateHash: string;
  createdAt: string;
}

export interface UploadMlsStateBinaryRequest {
  epoch: number;
  encryptedState: Uint8Array;
  stateHash: string;
}

export interface UploadMlsStateBinaryResponse {
  state: MlsBinaryGroupState;
}

export interface MlsBinaryGroupStateResponse {
  state: MlsBinaryGroupState | null;
}

export function toTransportMessage(
  message: MlsBinaryMessage,
  encodeBytes: (value: Uint8Array) => string
): MlsMessage {
  const transportMessage: MlsMessage = {
    id: message.id,
    groupId: message.groupId,
    senderUserId: message.senderUserId,
    epoch: message.epoch,
    ciphertext: encodeBytes(message.ciphertext),
    messageType: message.messageType,
    contentType: message.contentType,
    sequenceNumber: message.sequenceNumber,
    sentAt: message.sentAt,
    createdAt: message.createdAt
  };

  if (message.senderEmail) {
    transportMessage.senderEmail = message.senderEmail;
  }

  return transportMessage;
}
