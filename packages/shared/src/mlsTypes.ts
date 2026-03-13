import type {
  AddMlsMemberRequestShape,
  AddMlsMemberResponseShape,
  MlsCipherSuite,
  MlsGroup,
  MlsGroupMember,
  MlsGroupMembersResponseShape,
  MlsGroupStateResponseShape,
  MlsGroupStateShape,
  MlsKeyPackageShape,
  MlsKeyPackagesResponseShape,
  MlsMessageShape,
  MlsMessagesResponseShape,
  MlsWelcomeMessageShape,
  MlsWelcomeMessagesResponseShape,
  RemoveMlsMemberRequestShape,
  SendMlsMessageRequestShape,
  SendMlsMessageResponseShape,
  UploadMlsKeyPackagesRequestShape,
  UploadMlsKeyPackagesResponseShape,
  UploadMlsStateRequestShape,
  UploadMlsStateResponseShape
} from './mlsCoreTypes.js';

export {
  MLS_CIPHERSUITES,
  type MlsCipherSuite,
  type MlsGroup,
  type MlsGroupMember,
  type MlsGroupMembersResponseShape,
  type MlsGroupRole,
  type MlsMessageType
} from './mlsCoreTypes.js';

/** MLS key package stored on server */
export type MlsKeyPackage = MlsKeyPackageShape<string>;

/** MLS encrypted message (server only stores ciphertext) */
export type MlsMessage = MlsMessageShape<string>;

/** MLS welcome message for joining a group */
export type MlsWelcomeMessage = MlsWelcomeMessageShape<string>;

/** MLS group state snapshot for multi-device sync */
export type MlsGroupState = MlsGroupStateShape<string>;

// MLS API Request/Response types

export type UploadMlsKeyPackagesRequest =
  UploadMlsKeyPackagesRequestShape<string>;

export type UploadMlsKeyPackagesResponse =
  UploadMlsKeyPackagesResponseShape<string>;

export type MlsKeyPackagesResponse = MlsKeyPackagesResponseShape<string>;

export interface CreateMlsGroupRequest {
  name: string;
  description?: string;
  groupIdMls: string;
  cipherSuite: MlsCipherSuite;
}

export interface CreateMlsGroupResponse {
  group: MlsGroup;
}

export interface MlsGroupsResponse {
  groups: MlsGroup[];
}

export interface MlsGroupResponse {
  group: MlsGroup;
  members: MlsGroupMember[];
}

export interface UpdateMlsGroupRequest {
  name?: string;
  description?: string;
}

export type AddMlsMemberRequest = AddMlsMemberRequestShape<string>;

export type AddMlsMemberResponse = AddMlsMemberResponseShape;

export interface MlsGroupMembersResponse extends MlsGroupMembersResponseShape {}

export type RemoveMlsMemberRequest = RemoveMlsMemberRequestShape<string>;

export type SendMlsMessageRequest = SendMlsMessageRequestShape<string>;

export type SendMlsMessageResponse = SendMlsMessageResponseShape<string>;

export type MlsMessagesResponse = MlsMessagesResponseShape<string>;

export type MlsWelcomeMessagesResponse =
  MlsWelcomeMessagesResponseShape<string>;

export interface AckMlsWelcomeRequest {
  groupId: string;
}

export type UploadMlsStateRequest = UploadMlsStateRequestShape<string>;

export type UploadMlsStateResponse = UploadMlsStateResponseShape<string>;

export type MlsGroupStateResponse = MlsGroupStateResponseShape<string>;
